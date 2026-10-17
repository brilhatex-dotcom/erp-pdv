import type { Manutencao } from "@erp/application";

/**
 * O servidor fechado para a loja enquanto o banco é trocado por uma cópia.
 *
 * Uma restauração no meio de uma venda gravaria a venda num banco que está
 * sendo apagado. Com a manutenção ligada, a API responde "em manutenção" — e o
 * caixa, que trata isso como servidor fora do ar, continua vendendo pela fila
 * da estação (ADR-0023) e entrega tudo quando o servidor volta.
 */
export class ManutencaoDoServidor implements Manutencao {
  #ativa = false;

  get ativa(): boolean {
    return this.#ativa;
  }

  async durante<T>(acao: () => Promise<T>): Promise<T> {
    this.#ativa = true;

    try {
      return await acao();
    } finally {
      this.#ativa = false;
    }
  }
}
