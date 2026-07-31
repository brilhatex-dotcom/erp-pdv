import type { DomainEvent } from "../shared/DomainEvent.js";
import type { Identificador } from "../shared/Identificador.js";
import type { Dinheiro } from "../valores/Dinheiro.js";

/**
 * Preço de venda alterado.
 *
 * É o evento mais importante do catálogo: dispara a replicação do preço para o
 * cache local de cada PDV (ARQUITETURA.md §12.2). Preço desatualizado numa
 * estação significa cobrar valor errado do cliente.
 */
export interface PrecoAlterado extends DomainEvent {
  readonly tipo: "PrecoAlterado";
  readonly anterior: Dinheiro;
  readonly novo: Dinheiro;
}

/** Custo de compra alterado — recalcula margem e alimenta relatórios. */
export interface CustoAlterado extends DomainEvent {
  readonly tipo: "CustoAlterado";
  readonly anterior: Dinheiro;
  readonly novo: Dinheiro;
}

/**
 * Produto desativado.
 *
 * Desativar não apaga: o histórico de vendas e os documentos fiscais continuam
 * apontando para ele. O PDV é que deixa de oferecê-lo.
 */
export interface ProdutoDesativado extends DomainEvent {
  readonly tipo: "ProdutoDesativado";
}

export interface ProdutoAtivado extends DomainEvent {
  readonly tipo: "ProdutoAtivado";
}

export type EventoCatalogo =
  PrecoAlterado | CustoAlterado | ProdutoDesativado | ProdutoAtivado;

/** Constrói o evento de alteração de preço. */
export function precoAlterado(
  agregadoId: Identificador,
  anterior: Dinheiro,
  novo: Dinheiro,
  ocorridoEm: Date,
): PrecoAlterado {
  return { tipo: "PrecoAlterado", agregadoId, anterior, novo, ocorridoEm };
}

/** Constrói o evento de alteração de custo. */
export function custoAlterado(
  agregadoId: Identificador,
  anterior: Dinheiro,
  novo: Dinheiro,
  ocorridoEm: Date,
): CustoAlterado {
  return { tipo: "CustoAlterado", agregadoId, anterior, novo, ocorridoEm };
}
