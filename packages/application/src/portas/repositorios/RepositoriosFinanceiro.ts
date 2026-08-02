import type { Identificador, TipoTitulo, Titulo } from "@erp/domain";

/**
 * Porta do financeiro.
 *
 * Os métodos falam de negócio, não de SQL: `emAbertoDaContraparte` existe
 * porque é a pergunta que o balcão faz — "quanto o seu José está devendo?" —
 * e é a que decide se a próxima venda a prazo pode sair.
 */

export interface FiltroTitulos {
  readonly tipo?: TipoTitulo | undefined;
  /** Cliente ou fornecedor. */
  readonly contraparteId?: Identificador | undefined;
  /** Só o que ainda tem saldo. O padrão da tela de cobrança. */
  readonly apenasEmAberto?: boolean | undefined;
  /** Vencidos até esta data, inclusive. */
  readonly vencidosAte?: Date | undefined;
  readonly limite: number;
}

export interface TituloRepository {
  porId(id: Identificador): Promise<Titulo | undefined>;
  /**
   * Títulos gerados por uma venda ou nota de compra.
   *
   * É o caminho do cancelamento: cancelar a venda tem de alcançar o fiado que
   * ela criou, senão a dívida sobrevive à venda que a originou.
   */
  porDocumento(documentoId: Identificador): Promise<readonly Titulo[]>;
  /** O que a contraparte ainda deve, para a decisão de vender a prazo. */
  emAbertoDaContraparte(
    contraparteId: Identificador,
    tipo: TipoTitulo,
  ): Promise<readonly Titulo[]>;
  buscar(filtro: FiltroTitulos): Promise<readonly Titulo[]>;
  salvar(titulo: Titulo): Promise<void>;
}
