import type { DadosCupom } from "@erp/printing";

import { CABECALHO_SEGREDO, ENDERECO_AGENTE, ROTAS } from "./rotas.js";
import type {
  EstadoConexaoNoAgente,
  ResultadoFinalizacaoNoAgente,
  ResultadoItemNoAgente,
  ResultadoPagamentoNoAgente,
  ResumoSincronizacaoNoAgente,
  VendaNoAgente,
} from "./tipos.js";

/**
 * A tela falando com o Agente Local.
 *
 * ### Nada aqui pode lançar por falta de Agente
 *
 * A estação pode estar sem Agente: em desenvolvimento, num tablet, ou porque o
 * serviço não subiu. Isso **não é erro** — é ausência de contingência e de
 * impressora, e a tela precisa continuar vendendo contra o servidor da loja.
 *
 * Por isso `disponivel()` existe e as chamadas de impressão nunca rejeitam. As
 * de venda offline rejeitam, porque quem as chama já sabe que precisa do Agente.
 *
 * ### O tempo é curto de propósito
 *
 * O Agente está na mesma máquina: se não respondeu em um segundo, não vai
 * responder. Esperar mais congelaria a tela no meio da bipada — e o operador
 * está com fila.
 */

const TEMPO_LIMITE_MS = 1000;

export interface AvisoDeImpressao {
  readonly tipo: "IMPRESSO" | "NAO_IMPRESSO";
  readonly mensagem?: string;
}

export interface OpcoesClienteAgente {
  /** Segredo gravado na instalação, compartilhado com o Agente. */
  readonly segredo: string;
  readonly endereco?: string;
  /** Injetado no teste; em produção é o `fetch` do navegador. */
  readonly buscar?: typeof fetch;
}

export class AgenteIndisponivel extends Error {
  constructor(mensagem = "O agente desta estação não respondeu.") {
    super(mensagem);
    this.name = "AgenteIndisponivel";
  }
}

export class ClienteAgente {
  readonly #endereco: string;
  readonly #segredo: string;
  readonly #buscar: typeof fetch;

  constructor(opcoes: OpcoesClienteAgente) {
    this.#endereco = opcoes.endereco ?? ENDERECO_AGENTE;
    this.#segredo = opcoes.segredo;
    this.#buscar = opcoes.buscar ?? globalThis.fetch.bind(globalThis);
  }

  /** Verdadeiro quando há Agente nesta estação. Nunca lança. */
  async disponivel(): Promise<boolean> {
    try {
      const resposta = await this.#chamar(ROTAS.saude, undefined, "GET");
      return resposta.ok;
    } catch {
      return false;
    }
  }

  async estado(): Promise<EstadoConexaoNoAgente> {
    return this.#json<EstadoConexaoNoAgente>(ROTAS.estado, undefined, "GET");
  }

  async iniciarVenda(dados: {
    readonly estacaoId: string;
    readonly operadorId: string;
  }): Promise<VendaNoAgente> {
    return this.#json<VendaNoAgente>(ROTAS.iniciarVenda, dados);
  }

  async adicionarItem(codigo: string): Promise<ResultadoItemNoAgente> {
    return this.#json<ResultadoItemNoAgente>(ROTAS.item, { codigo });
  }

  async registrarPagamento(
    forma: string,
    valor: string,
  ): Promise<ResultadoPagamentoNoAgente> {
    return this.#json<ResultadoPagamentoNoAgente>(ROTAS.pagamento, { forma, valor });
  }

  async finalizar(): Promise<ResultadoFinalizacaoNoAgente> {
    return this.#json<ResultadoFinalizacaoNoAgente>(ROTAS.finalizar, {});
  }

  async cancelar(): Promise<void> {
    await this.#json(ROTAS.cancelar, {});
  }

  async sincronizar(): Promise<ResumoSincronizacaoNoAgente> {
    return this.#json<ResumoSincronizacaoNoAgente>(ROTAS.sincronizar, {});
  }

  /**
   * Imprime o cupom **sem nunca lançar**.
   *
   * Chamada depois de a venda estar gravada. Devolve `undefined` quando não há
   * o que avisar — impresso, ou estação sem Agente, que não é erro: avisar
   * "sem impressora" a cada venda ensina o operador a ignorar avisos.
   */
  async imprimirCupom(dados: {
    readonly cupom: DadosCupom;
    readonly houveDinheiro: boolean;
  }): Promise<string | undefined> {
    try {
      const aviso = await this.#json<AvisoDeImpressao>(ROTAS.imprimirCupom, dados);

      return aviso.tipo === "IMPRESSO" ? undefined : aviso.mensagem;
    } catch {
      // A venda já está gravada. O operador precisa saber do cupom, não de um
      // erro de rede local.
      return "Cupom não impresso. A venda foi registrada normalmente.";
    }
  }

  /** Abre a gaveta. Falha vira aviso, nunca exceção. */
  async abrirGaveta(): Promise<string | undefined> {
    try {
      const aviso = await this.#json<AvisoDeImpressao>(ROTAS.abrirGaveta, {});

      return aviso.tipo === "IMPRESSO" ? undefined : aviso.mensagem;
    } catch {
      return "Gaveta não abriu.";
    }
  }

  async #json<T>(caminho: string, corpo?: unknown, metodo = "POST"): Promise<T> {
    const resposta = await this.#chamar(caminho, corpo, metodo);

    if (!resposta.ok) throw new AgenteIndisponivel();

    return (await resposta.json()) as T;
  }

  async #chamar(caminho: string, corpo: unknown, metodo: string): Promise<Response> {
    const cancelamento = AbortSignal.timeout(TEMPO_LIMITE_MS);

    try {
      return await this.#buscar(`${this.#endereco}${caminho}`, {
        method: metodo,
        headers: {
          [CABECALHO_SEGREDO]: this.#segredo,
          ...(corpo === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
        signal: cancelamento,
      });
    } catch (causa) {
      // `fetch` rejeita por rede, por CORS e por tempo esgotado. Para quem
      // chama, os três significam a mesma coisa: não há Agente respondendo.
      throw new AgenteIndisponivel(String(causa));
    }
  }
}
