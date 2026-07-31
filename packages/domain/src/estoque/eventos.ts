import type { DomainEvent } from "../shared/DomainEvent.js";
import type { Identificador } from "../shared/Identificador.js";

import type { TipoMovimento } from "./TipoMovimento.js";

/**
 * Estoque movimentado.
 *
 * Consumido pela projeção de saldo, pelo alerta de estoque mínimo e pela
 * replicação para os PDVs. Carrega o **delta** em vez do saldo resultante,
 * justamente para preservar a comutatividade: quem recebe soma, não sobrescreve.
 */
export interface EstoqueMovimentado extends DomainEvent {
  readonly tipo: "EstoqueMovimentado";
  readonly produtoId: Identificador;
  readonly tipoMovimento: TipoMovimento;
  /** Variação em milésimos, com sinal. */
  readonly delta: bigint;
  readonly unidade: string;
}

export function estoqueMovimentado(
  movimentoId: Identificador,
  produtoId: Identificador,
  tipoMovimento: TipoMovimento,
  delta: bigint,
  unidade: string,
  ocorridoEm: Date,
): EstoqueMovimentado {
  return {
    tipo: "EstoqueMovimentado",
    agregadoId: movimentoId,
    produtoId,
    tipoMovimento,
    delta,
    unidade,
    ocorridoEm,
  };
}
