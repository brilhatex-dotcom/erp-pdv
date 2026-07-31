import { type CodigoFormaPagamento, Pagamento, Venda, VendaItem } from "@erp/domain";

import type {
  Pagamento as PagamentoLinha,
  Venda as VendaLinha,
  VendaItem as ItemLinha,
} from "../gerado/index.js";
import {
  ouNulo,
  paraDinheiro,
  paraId,
  paraIdOpcional,
  paraQuantidade,
} from "./comuns.js";

export type VendaCompleta = VendaLinha & {
  readonly itens: readonly ItemLinha[];
  readonly pagamentos: readonly PagamentoLinha[];
};

/**
 * Linha do banco → agregado.
 *
 * Os itens voltam com os **dois** descontos que tinham gravados: o do próprio
 * item e o rateado. Recalcular o rateio na leitura faria um cupom reimpresso
 * divergir do original assim que a regra de rateio mudasse — e o valor por item
 * é o que a SEFAZ conferiu.
 */
export function paraDominio(linha: VendaCompleta): Venda {
  return Venda.reconstituir({
    id: paraId(linha.id),
    numero: linha.numero,
    sessaoCaixaId: paraId(linha.sessaoCaixaId),
    operadorId: paraId(linha.operadorId),
    estacaoId: paraId(linha.estacaoId),
    clienteId: paraIdOpcional(linha.clienteId),
    abertaEm: linha.abertaEm,
    status: linha.status,
    finalizadaEm: linha.finalizadaEm ?? undefined,
    descontoVenda: paraDinheiro(linha.descontoVenda),
    itens: [...linha.itens]
      .sort((a, b) => a.numero - b.numero)
      .map((item) =>
        VendaItem.reconstituir(
          item.numero,
          {
            produtoId: paraId(item.produtoId),
            descricao: item.descricao,
            quantidade: paraQuantidade(item.quantidade, item.unidade),
            precoUnitario: paraDinheiro(item.precoUnitario),
          },
          paraDinheiro(item.desconto),
          paraDinheiro(item.descontoRateado),
        ),
      ),
    pagamentos: [...linha.pagamentos]
      .sort((a, b) => a.ordem - b.ordem)
      .map((pagamento) =>
        // Já validado quando foi gravado; o banco ainda exige valor > 0.
        Pagamento.criar(
          pagamento.forma as CodigoFormaPagamento,
          paraDinheiro(pagamento.valor),
          {
            autorizacao: pagamento.autorizacao ?? undefined,
            parcelas: pagamento.parcelas,
          },
        ).unwrap(),
      ),
  });
}

/** Agregado → colunas da venda, sem os filhos. */
export function paraLinha(venda: Venda): VendaLinha {
  return {
    id: venda.id.valor,
    numero: venda.numero,
    sessaoCaixaId: venda.sessaoCaixaId.valor,
    operadorId: venda.operadorId.valor,
    estacaoId: venda.estacaoId.valor,
    clienteId: ouNulo(venda.clienteId?.valor),
    status: venda.status,
    descontoVenda: venda.descontoVenda.centavos,
    troco: venda.troco.centavos,
    abertaEm: venda.abertaEm,
    finalizadaEm: ouNulo(venda.finalizadaEm),
  };
}

/** Itens do agregado → linhas. */
export function itensParaLinhas(venda: Venda): ItemLinha[] {
  return venda.itens.map((item) => ({
    vendaId: venda.id.valor,
    numero: item.numero,
    produtoId: item.produtoId.valor,
    descricao: item.descricao,
    quantidade: item.quantidade.milesimos,
    unidade: item.quantidade.unidade.codigo,
    precoUnitario: item.precoUnitario.centavos,
    desconto: item.desconto.centavos,
    descontoRateado: item.descontoRateado.centavos,
  }));
}

/** Pagamentos do agregado → linhas. A ordem é a chave, e ela é a de registro. */
export function pagamentosParaLinhas(venda: Venda): PagamentoLinha[] {
  return venda.pagamentos.map((pagamento, indice) => ({
    vendaId: venda.id.valor,
    ordem: indice + 1,
    forma: pagamento.forma.codigo,
    valor: pagamento.valor.centavos,
    autorizacao: ouNulo(pagamento.autorizacao),
    parcelas: pagamento.parcelas,
  }));
}
