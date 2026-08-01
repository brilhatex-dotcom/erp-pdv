import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

/**
 * Fila de vendas pendentes de sincronização.
 *
 * **É o arquivo mais importante do produto.** Enquanto o servidor está fora do
 * ar, ele é o único lugar do mundo onde a venda existe. Tudo aqui é desenhado
 * em torno disso.
 *
 * ### Append-only, como o estoque e o caixa
 *
 * Uma venda gravada é fato (princípio 5). Sincronizar não apaga nem reescreve a
 * linha: acrescenta outra dizendo "esta foi confirmada". Reescrever o arquivo a
 * cada confirmação abriria a janela em que uma queda de energia deixaria o
 * arquivo pela metade — justamente com as vendas ainda não enviadas dentro.
 *
 * ### Gravação síncrona, com `fsync`
 *
 * `appendFileSync` num descritor aberto com `rs+` força o sistema operacional a
 * escrever no disco antes de retornar. É mais lento que gravar em memória e é
 * exatamente o que se quer: o operador só ouve "pronto" depois de o disco ter
 * confirmado. Uma venda perdida por queda de energia não volta.
 *
 * ### Linha quebrada não contamina o arquivo
 *
 * Falta de luz no meio de uma escrita pode deixar a última linha incompleta. Na
 * leitura, uma linha ilegível é **descartada e contada**, e o resto do arquivo
 * segue válido. É a vantagem concreta do formato de linha sobre um banco: o
 * estrago fica do tamanho de uma venda, não do arquivo inteiro (ADR-0021).
 */

/** Uma venda esperando para ser enviada. */
export interface VendaPendente {
  /**
   * Identificador gerado na estação, **antes** de qualquer ida ao servidor.
   *
   * É ele que torna o reenvio seguro: o servidor reconhece o mesmo
   * identificador e não cria a venda duas vezes. Sem isso, uma resposta perdida
   * na rede viraria venda duplicada — e o fechamento de caixa acusaria dinheiro
   * que não existe.
   */
  readonly id: string;
  readonly estacaoId: string;
  readonly operadorId: string;
  readonly registradaEm: string;
  readonly itens: readonly {
    readonly codigo: string;
    readonly quantidade?: { readonly milesimos: string; readonly unidade: string };
  }[];
  readonly pagamentos: readonly {
    readonly forma: string;
    readonly valor: string;
  }[];
  readonly total: string;
}

type Registro =
  | { readonly tipo: "VENDA"; readonly venda: VendaPendente }
  | { readonly tipo: "CONFIRMADA"; readonly id: string; readonly em: string };

export interface EstadoDaFila {
  readonly pendentes: readonly VendaPendente[];
  /** Linhas ilegíveis descartadas na leitura — sintoma de queda de energia. */
  readonly linhasCorrompidas: number;
}

export class FilaDeVendas {
  constructor(private readonly caminho: string) {}

  /**
   * Grava a venda e só então retorna.
   *
   * Quem chama pode dizer "venda concluída" ao operador com segurança: quando
   * esta função retorna, o disco já confirmou.
   */
  enfileirar(venda: VendaPendente): void {
    this.#acrescentar({ tipo: "VENDA", venda });
  }

  /** Marca a venda como aceita pelo servidor. Não apaga nada. */
  confirmar(id: string, em: Date): void {
    this.#acrescentar({ tipo: "CONFIRMADA", id, em: em.toISOString() });
  }

  /**
   * O que ainda falta enviar, na ordem em que foi vendido.
   *
   * A ordem importa: as vendas entram no servidor na sequência em que
   * aconteceram, e é assim que o relatório do dia bate com a fita do caixa.
   */
  ler(): EstadoDaFila {
    if (!existsSync(this.caminho)) {
      return { pendentes: [], linhasCorrompidas: 0 };
    }

    const linhas = readFileSync(this.caminho, "utf8").split("\n");
    const pendentes = new Map<string, VendaPendente>();
    const confirmadas = new Set<string>();
    let linhasCorrompidas = 0;

    for (const linha of linhas) {
      if (linha.trim() === "") continue;

      const registro = interpretar(linha);

      if (registro === undefined) {
        linhasCorrompidas += 1;
        continue;
      }

      if (registro.tipo === "VENDA") {
        pendentes.set(registro.venda.id, registro.venda);
      } else {
        confirmadas.add(registro.id);
      }
    }

    for (const id of confirmadas) pendentes.delete(id);

    return { pendentes: [...pendentes.values()], linhasCorrompidas };
  }

  quantidadePendente(): number {
    return this.ler().pendentes.length;
  }

  /**
   * Reescreve o arquivo sem o que já foi confirmado.
   *
   * Só deve rodar com a fila **vazia de pendentes** — na abertura do caixa, por
   * exemplo. Compactar com venda pendente dentro trocaria um arquivo que só
   * cresce por uma janela em que uma queda de energia leva tudo.
   *
   * Devolve quantas linhas foram descartadas.
   */
  compactar(): number {
    const { pendentes } = this.ler();

    if (pendentes.length > 0) return 0;
    if (!existsSync(this.caminho)) return 0;

    const antes = readFileSync(this.caminho, "utf8")
      .split("\n")
      .filter((linha) => linha.trim() !== "").length;

    writeFileSync(this.caminho, "", "utf8");

    return antes;
  }

  #acrescentar(registro: Registro): void {
    // A linha e a quebra vão numa escrita só: duas escritas deixariam a janela
    // em que a queda de energia separa o conteúdo do terminador.
    const linha = `${JSON.stringify(registro)}\n`;

    const descritor = openSync(this.caminho, "a");

    try {
      appendFileSync(descritor, linha, "utf8");
    } finally {
      // `closeSync` descarrega o buffer do sistema para o disco.
      closeSync(descritor);
    }
  }
}

/** `undefined` para linha ilegível — a última de um arquivo truncado. */
function interpretar(linha: string): Registro | undefined {
  let bruto: unknown;

  try {
    bruto = JSON.parse(linha);
  } catch {
    return undefined;
  }

  if (typeof bruto !== "object" || bruto === null) return undefined;

  const registro = bruto as Partial<Registro>;

  if (registro.tipo === "CONFIRMADA") {
    return typeof registro.id === "string" && typeof registro.em === "string"
      ? { tipo: "CONFIRMADA", id: registro.id, em: registro.em }
      : undefined;
  }

  if (registro.tipo === "VENDA") {
    const venda = (registro as { venda?: unknown }).venda;

    // Só o identificador é conferido: é o que a fila precisa para não duplicar.
    // Validar a venda inteira aqui faria uma mudança de campo no futuro
    // descartar vendas antigas que estavam perfeitamente boas.
    return typeof venda === "object" &&
      venda !== null &&
      typeof (venda as { id?: unknown }).id === "string"
      ? { tipo: "VENDA", venda: venda as VendaPendente }
      : undefined;
  }

  return undefined;
}
