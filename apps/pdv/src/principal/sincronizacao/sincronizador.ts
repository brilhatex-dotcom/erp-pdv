import type { FilaDeVendas, VendaPendente } from "../armazenamento-local/filaDeVendas.js";

/**
 * Envia ao servidor as vendas que ficaram na fila.
 *
 * ### Reenviar tem que ser seguro
 *
 * A resposta do servidor pode se perder depois de ele ter gravado a venda. Se o
 * reenvio criasse uma segunda venda, o fechamento de caixa acusaria dinheiro
 * que não existe — e ninguém conseguiria explicar de onde veio. Por isso a
 * venda leva um identificador gerado na estação: o servidor reconhece o repetido
 * e responde "já tenho essa" em vez de criar outra.
 *
 * ### Uma de cada vez, na ordem
 *
 * Enviar em paralelo seria mais rápido e produziria vendas fora de ordem no
 * relatório do dia. A fila de uma estação tem dezenas de itens; a ordem vale
 * mais que os milissegundos.
 *
 * ### Falha não é motivo para desistir
 *
 * O servidor voltar leva o tempo que leva. O recuo exponencial evita que a
 * estação martele a rede da loja — que é a mesma rede pela qual o outro caixa
 * está tentando vender.
 */

export type ResultadoEnvio =
  | { readonly tipo: "ACEITA" }
  /** O servidor já tinha esta venda. Vale como aceita. */
  | { readonly tipo: "JA_EXISTIA" }
  /** O servidor recusou por regra de negócio: reenviar não vai resolver. */
  | { readonly tipo: "RECUSADA"; readonly motivo: string }
  /** Rede, servidor fora do ar, tempo esgotado: tentar de novo depois. */
  | { readonly tipo: "INDISPONIVEL"; readonly motivo: string };

export interface EnvioDeVendas {
  enviar(venda: VendaPendente): Promise<ResultadoEnvio>;
}

export type EstadoConexao =
  | { readonly tipo: "CONECTADO" }
  | { readonly tipo: "OFFLINE"; readonly pendentes: number }
  /** Offline há tempo demais: o gerente precisa saber. */
  | {
      readonly tipo: "OFFLINE_CRITICO";
      readonly pendentes: number;
      readonly desdeMs: number;
    };

/** Depois disto, o problema deixou de ser do caixa e passa a ser do gerente. */
export const LIMITE_CRITICO_MS = 4 * 60 * 60 * 1000;

const RECUO_INICIAL_MS = 1000;
const RECUO_MAXIMO_MS = 60_000;

export interface OpcoesSincronizador {
  readonly fila: FilaDeVendas;
  readonly envio: EnvioDeVendas;
  readonly agora?: () => Date;
  readonly registrar?: (mensagem: string) => void;
}

export interface ResumoSincronizacao {
  readonly enviadas: number;
  readonly recusadas: number;
  /** Verdadeiro quando parou por indisponibilidade — há mais a enviar. */
  readonly interrompida: boolean;
}

export class Sincronizador {
  readonly #fila: FilaDeVendas;
  readonly #envio: EnvioDeVendas;
  readonly #agora: () => Date;
  readonly #registrar: (mensagem: string) => void;

  #recuoMs = RECUO_INICIAL_MS;
  #offlineDesde: Date | undefined;

  constructor(opcoes: OpcoesSincronizador) {
    this.#fila = opcoes.fila;
    this.#envio = opcoes.envio;
    this.#agora = opcoes.agora ?? (() => new Date());
    this.#registrar = opcoes.registrar ?? ((): void => undefined);
  }

  /** Quanto esperar antes da próxima tentativa. */
  get proximaTentativaEmMs(): number {
    return this.#recuoMs;
  }

  /**
   * Tenta esvaziar a fila.
   *
   * **Para na primeira indisponibilidade.** Insistir nas seguintes gastaria a
   * rede para colher o mesmo erro, e furaria a ordem das vendas — a próxima
   * chegaria antes de uma que falhou.
   */
  async sincronizar(): Promise<ResumoSincronizacao> {
    const { pendentes } = this.#fila.ler();

    let enviadas = 0;
    let recusadas = 0;

    for (const venda of pendentes) {
      const resultado = await this.#envio.enviar(venda);

      if (resultado.tipo === "INDISPONIVEL") {
        this.#aoFalhar(resultado.motivo);
        return { enviadas, recusadas, interrompida: true };
      }

      if (resultado.tipo === "RECUSADA") {
        // Recusa por regra de negócio não melhora com o tempo. Sai da fila e
        // vira registro para o gerente resolver: mantê-la faria a estação
        // tentar para sempre e a fila nunca esvaziar.
        this.#registrar(`Venda ${venda.id} recusada pelo servidor: ${resultado.motivo}`);
        this.#fila.confirmar(venda.id, this.#agora());
        recusadas += 1;
        continue;
      }

      this.#fila.confirmar(venda.id, this.#agora());
      enviadas += 1;
    }

    this.#aoConseguir();

    return { enviadas, recusadas, interrompida: false };
  }

  /** O que o indicador da tela mostra. */
  estado(): EstadoConexao {
    const pendentes = this.#fila.quantidadePendente();

    if (this.#offlineDesde === undefined) return { tipo: "CONECTADO" };

    const desdeMs = this.#agora().getTime() - this.#offlineDesde.getTime();

    return desdeMs >= LIMITE_CRITICO_MS
      ? { tipo: "OFFLINE_CRITICO", pendentes, desdeMs }
      : { tipo: "OFFLINE", pendentes };
  }

  #aoFalhar(motivo: string): void {
    this.#offlineDesde ??= this.#agora();
    this.#recuoMs = Math.min(this.#recuoMs * 2, RECUO_MAXIMO_MS);
    this.#registrar(`Sincronização adiada: ${motivo}`);
  }

  #aoConseguir(): void {
    this.#offlineDesde = undefined;
    this.#recuoMs = RECUO_INICIAL_MS;
  }
}
