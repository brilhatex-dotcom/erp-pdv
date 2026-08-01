import { appendFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

import { comoTexto, previsualizar } from "@erp/printing";

/**
 * Uma impressora térmica de mentira, na porta 9100.
 *
 * ### Para que serve
 *
 * O PDV conecta nela sem saber que não é real. Isso exercita o caminho inteiro
 * — tela, ponte do Electron, socket, bytes — que de outro modo só seria testado
 * com equipamento na mesa.
 *
 * Serve para desenvolver sem impressora e serve no suporte: apontar a estação
 * do cliente para uma impressora virtual mostra exatamente o que ela está
 * mandando, quando o cupom sai errado e ninguém sabe por quê.
 *
 * ### O que ela não prova
 *
 * Que o papel corta, que a gaveta daquele modelo abre, que a margem física
 * bate. Ela confirma que **o fluxo de bytes chegou e está correto** — o resto
 * exige a impressora, e isso está dito assim de propósito: ferramenta que se
 * apresenta como equivalente ao teste real cria confiança onde não há
 * cobertura.
 */

export interface CupomRecebido {
  readonly recebidoEm: Date;
  readonly bytes: Uint8Array;
  /** O cupom já decodificado, pronto para conferência a olho. */
  readonly texto: string;
  readonly abriuGaveta: boolean;
  readonly cortouPapel: boolean;
}

export interface OpcoesImpressoraVirtual {
  readonly porta?: number;
  readonly colunas?: number;
  /** Caminho para registrar cada cupom recebido, se desejado. */
  readonly registroEm?: string;
  readonly aoReceber?: (cupom: CupomRecebido) => void;
}

const PORTA_ESCPOS = 9100;
/**
 * Silêncio que marca o fim de um cupom.
 *
 * O protocolo não tem terminador: a impressora imprime o que chega. Uma pausa
 * curta é o suficiente para separar um cupom do seguinte, e não há caso real em
 * que dois cupons saiam com menos de 150 ms entre eles.
 */
const PAUSA_FIM_DE_CUPOM_MS = 150;

export class ImpressoraVirtual {
  readonly #recebidos: CupomRecebido[] = [];
  readonly #conexoes = new Set<Socket>();
  readonly #opcoes: OpcoesImpressoraVirtual;
  #servidor: Server | undefined;

  constructor(opcoes: OpcoesImpressoraVirtual = {}) {
    this.#opcoes = opcoes;
  }

  get recebidos(): readonly CupomRecebido[] {
    return this.#recebidos;
  }

  get ultimo(): CupomRecebido | undefined {
    return this.#recebidos.at(-1);
  }

  /** Devolve a porta em que ficou escutando — útil com porta 0 no teste. */
  async ligar(): Promise<number> {
    const servidor = createServer((socket) => {
      this.#conexoes.add(socket);
      this.#atender(socket);
    });

    this.#servidor = servidor;

    await new Promise<void>((pronto, falhou) => {
      servidor.once("error", falhou);
      servidor.listen(this.#opcoes.porta ?? PORTA_ESCPOS, "0.0.0.0", () => {
        pronto();
      });
    });

    const endereco = servidor.address();

    /* v8 ignore next -- só ocorreria com socket de domínio unix */
    if (endereco === null || typeof endereco === "string") return 0;

    return endereco.port;
  }

  async desligar(): Promise<void> {
    for (const socket of this.#conexoes) socket.destroy();
    this.#conexoes.clear();

    const servidor = this.#servidor;
    if (servidor === undefined) return;

    await new Promise<void>((pronto) => {
      servidor.close(() => {
        pronto();
      });
    });

    this.#servidor = undefined;
  }

  #atender(socket: Socket): void {
    let acumulado: Buffer[] = [];
    let temporizador: NodeJS.Timeout | undefined;

    const fechar = (): void => {
      if (acumulado.length === 0) return;

      this.#registrar(Buffer.concat(acumulado));
      acumulado = [];
    };

    socket.on("data", (pedaco) => {
      acumulado.push(pedaco);

      if (temporizador !== undefined) clearTimeout(temporizador);
      temporizador = setTimeout(fechar, PAUSA_FIM_DE_CUPOM_MS);

      // Não segura o processo vivo só por causa deste temporizador. O tipo diz
      // que `unref` sempre existe, mas o temporizador do navegador não o tem, e
      // este módulo também roda sob um ambiente de teste que emula o navegador
      // — onde chamá-lo direto derruba o manipulador em silêncio, e os cupons
      // deixam de ser registrados sem erro nenhum aparecer.
      const comUnref = temporizador as { unref?: () => void };
      comUnref.unref?.();
    });

    socket.on("close", () => {
      if (temporizador !== undefined) clearTimeout(temporizador);
      fechar();
      this.#conexoes.delete(socket);
    });

    socket.on("error", () => {
      this.#conexoes.delete(socket);
    });
  }

  #registrar(buffer: Buffer): void {
    const bytes = new Uint8Array(buffer);
    const previsto = previsualizar(bytes);

    const cupom: CupomRecebido = {
      recebidoEm: new Date(),
      bytes,
      texto: comoTexto(bytes, this.#opcoes.colunas),
      abriuGaveta: previsto.abriuGaveta,
      cortouPapel: previsto.cortouPapel,
    };

    this.#recebidos.push(cupom);

    if (this.#opcoes.registroEm !== undefined) {
      appendFileSync(
        this.#opcoes.registroEm,
        `\n===== ${cupom.recebidoEm.toISOString()} =====\n${cupom.texto}\n`,
        "utf8",
      );
    }

    this.#opcoes.aoReceber?.(cupom);
  }
}
