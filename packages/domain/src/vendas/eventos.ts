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
  /** Quem pediu o cancelamento — o operador da venda, quase sempre. */
  readonly solicitadoPorId: Identificador;
  /** Quem liberou, quando o pedido passou da alçada de quem pediu. */
  readonly autorizadoPorId?: Identificador | undefined;
  readonly total: Dinheiro;
  readonly itens: readonly ItemVendido[];
}

/** Item devolvido, no formato que o estoque precisa. */
export interface ItemDevolvidoNoEvento {
  readonly produtoId: Identificador;
  readonly quantidade: Quantidade;
  /** `PERDA` quando o produto voltou sem condição de venda. */
  readonly destino: "ESTOQUE" | "PERDA";
}

/**
 * Devolução registrada.
 *
 * Não altera a venda — ela continua finalizada, com o valor que teve. A
 * devolução é um fato **posterior**, com data, valor e responsável próprios,
 * que é como o fechamento e a nota fiscal de devolução precisam enxergá-la.
 */
export interface DevolucaoRegistrada extends DomainEvent {
  readonly tipo: "DevolucaoRegistrada";
  readonly vendaId: Identificador;
  readonly valor: Dinheiro;
  readonly formaReembolso: string;
  readonly itens: readonly ItemDevolvidoNoEvento[];
}

export type EventoVenda = VendaFinalizada | VendaCancelada | DevolucaoRegistrada;
