import {
  type CodigoFormaPagamento,
  type Dinheiro,
  MovimentoCaixa,
  SessaoCaixa,
} from "@erp/domain";

import type {
  MovimentoCaixa as MovimentoLinha,
  RecebimentoCaixa as RecebimentoLinha,
  SessaoCaixa as SessaoLinha,
} from "../../gerado/index.js";
import { ouNulo, paraDinheiro, paraId, paraIdOpcional } from "./comuns.js";

export type SessaoCompleta = SessaoLinha & {
  readonly movimentos: readonly MovimentoLinha[];
  readonly recebidos: readonly RecebimentoLinha[];
};

/**
 * Linha do banco → agregado.
 *
 * A sessão volta com **totais**, não com a lista de vendas do dia. Carregar
 * 2.000 vendas só para abrir a gaveta quebraria a meta de resposta do PDV
 * (RNF-01) — e o caixa nunca precisou de mais que os totais.
 */
export function paraDominio(linha: SessaoCompleta): SessaoCaixa {
  const recebidos = new Map<CodigoFormaPagamento, Dinheiro>();
  for (const recebimento of linha.recebidos) {
    recebidos.set(
      recebimento.forma as CodigoFormaPagamento,
      paraDinheiro(recebimento.valor),
    );
  }

  return SessaoCaixa.reconstituir({
    id: paraId(linha.id),
    estacaoId: paraId(linha.estacaoId),
    operadorId: paraId(linha.operadorId),
    fundoTroco: paraDinheiro(linha.fundoTroco),
    abertaEm: linha.abertaEm,
    status: linha.status,
    fechadaEm: linha.fechadaEm ?? undefined,
    trocoDevolvido: paraDinheiro(linha.trocoDevolvido),
    totalVendido: paraDinheiro(linha.totalVendido),
    quantidadeVendas: linha.quantidadeVendas,
    movimentos: [...linha.movimentos]
      .sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime())
      .map((movimento) =>
        MovimentoCaixa.criar({
          id: paraId(movimento.id),
          tipo: movimento.tipo,
          valor: paraDinheiro(movimento.valor),
          motivo: movimento.motivo,
          usuarioId: paraId(movimento.usuarioId),
          autorizadoPorId: paraIdOpcional(movimento.autorizadoPorId),
          ocorridoEm: movimento.ocorridoEm,
        }).unwrap(),
      ),
    recebidos,
  });
}

/** Agregado → colunas da sessão, sem os filhos. */
export function paraLinha(sessao: SessaoCaixa): SessaoLinha {
  return {
    id: sessao.id.valor,
    estacaoId: sessao.estacaoId.valor,
    operadorId: sessao.operadorId.valor,
    fundoTroco: sessao.fundoTroco.centavos,
    status: sessao.status,
    abertaEm: sessao.abertaEm,
    fechadaEm: ouNulo(sessao.fechadaEm),
    trocoDevolvido: sessao.trocoDevolvido.centavos,
    totalVendido: sessao.totalVendido.centavos,
    quantidadeVendas: sessao.quantidadeVendas,
    contadoEmDinheiro: ouNulo(sessao.conferencia?.contadoEmDinheiro.centavos),
  };
}

export function movimentosParaLinhas(sessao: SessaoCaixa): MovimentoLinha[] {
  return sessao.movimentos.map((movimento) => ({
    id: movimento.id.valor,
    sessaoCaixaId: sessao.id.valor,
    tipo: movimento.tipo,
    valor: movimento.valor.centavos,
    motivo: movimento.motivo,
    usuarioId: movimento.usuarioId.valor,
    autorizadoPorId: ouNulo(movimento.autorizadoPorId?.valor),
    ocorridoEm: movimento.ocorridoEm,
  }));
}

/**
 * Totais por forma de pagamento.
 *
 * O agregado não expõe o mapa inteiro — expõe `recebidoEm(forma)`. Percorrer a
 * lista fechada de formas é o preço de manter o encapsulamento, e ela tem nove
 * entradas.
 */
export function recebimentosParaLinhas(
  sessao: SessaoCaixa,
  formas: readonly CodigoFormaPagamento[],
): RecebimentoLinha[] {
  return formas
    .map((forma) => ({
      sessaoCaixaId: sessao.id.valor,
      forma,
      valor: sessao.recebidoEm(forma).centavos,
    }))
    .filter((linha) => linha.valor !== 0n);
}
