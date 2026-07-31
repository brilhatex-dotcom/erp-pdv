import type { DomainEvent } from "../shared/DomainEvent.js";
import type { Identificador } from "../shared/Identificador.js";
import type { Dinheiro } from "../valores/Dinheiro.js";
import type { Quantidade } from "../valores/Quantidade.js";

/** Item vendido, no formato que a baixa de estoque precisa. */
export interface ItemVendido {
  readonly produtoId: Identificador;
  readonly quantidade: Quantidade;
}

/**
 * Venda finalizada.
 *
 * É o evento que costura o sistema: dá baixa no estoque, credita o caixa,
 * enfileira o documento fiscal e, quando há crediário, gera a conta a receber.
 * `FinalizarVenda` não conhece nenhum desses módulos — publica o fato e segue.
 */
export interface VendaFinalizada extends DomainEvent {
  readonly tipo: "VendaFinalizada";
  readonly numero: number;
  readonly sessaoCaixaId: Identificador;
  readonly operadorId: Identificador;
  readonly clienteId?: Identificador | undefined;
  readonly total: Dinheiro;
  readonly itens: readonly ItemVendido[];
  /** Valor lançado em crediário, se houver. Zero na maioria das vendas. */
  readonly valorAReceber: Dinheiro;
}

/**
 * Venda cancelada.
 *
 * Cancelar **não apaga** a venda: gera um fato novo. Quem reage estorna o
 * estoque e o caixa. Apagar destruiria a sequência e a auditoria.
 */
export interface VendaCancelada extends DomainEvent {
  readonly tipo: "VendaCancelada";
  readonly numero: number;
  readonly motivo: string;
  readonly autorizadoPorId: Identificador;
  readonly total: Dinheiro;
  readonly itens: readonly ItemVendido[];
}

export type EventoVenda = VendaFinalizada | VendaCancelada;
