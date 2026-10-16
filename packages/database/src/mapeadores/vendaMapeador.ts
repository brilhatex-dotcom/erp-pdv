import {
  type CancelamentoVenda,
  type CodigoFormaPagamento,
  type ConfirmacaoPagamento,
  ehCodigoFormaPagamento,
  ehConfirmacaoPagamento,
  Pagamento,
  type SuspensaoVenda,
  Venda,
  VendaItem,
} from "@erp/domain";

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
    suspensao: suspensaoDaLinha(linha),
    cancelamento: cancelamentoDaLinha(linha),
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
            custoUnitario:
              item.custoUnitario === null ? undefined : paraDinheiro(item.custoUnitario),
          },
          paraDinheiro(item.desconto),
          paraDinheiro(item.descontoRateado),
        ),
      ),
    pagamentos: [...linha.pagamentos]
      .sort((a, b) => a.ordem - b.ordem)
      .map((pagamento) =>
        // Reconstituído, e não criado: a regra que recusa número de cartão no
        // campo de autorização é nova, e não pode tornar ilegível uma venda
        // gravada antes dela.
        Pagamento.reconstituir({
          forma: paraForma(pagamento.forma),
          valor: paraDinheiro(pagamento.valor),
          autorizacao: pagamento.autorizacao ?? undefined,
          parcelas: pagamento.parcelas,
          confirmacao: paraConfirmacao(pagamento.confirmacao),
          chave: pagamento.chave ?? undefined,
        }),
      ),
  });
}

function suspensaoDaLinha(linha: VendaLinha): SuspensaoVenda | undefined {
  if (linha.suspensaEm === null) return undefined;

  return { em: linha.suspensaEm, rotulo: linha.rotuloSuspensao ?? undefined };
}

/**
 * O registro do cancelamento, quando houve.
 *
 * Venda cancelada antes desta versão não tem as colunas preenchidas — o caso
 * de uso de cancelar não existia. Ela volta sem registro, e não com um
 * inventado: "quem cancelou" desconhecido é verdade; um nome qualquer seria
 * mentira com cara de auditoria.
 */
function cancelamentoDaLinha(linha: VendaLinha): CancelamentoVenda | undefined {
  // As três colunas andam juntas (`ck_vendas_cancelamento_coerente`).
  const { canceladaEm, canceladaPorId, motivoCancelamento } = linha;
  if (canceladaEm === null || canceladaPorId === null || motivoCancelamento === null) {
    return undefined;
  }

  return {
    em: canceladaEm,
    motivo: motivoCancelamento,
    solicitadoPorId: paraId(canceladaPorId),
    autorizadoPorId: paraIdOpcional(linha.cancelamentoAutorizadoPorId),
  };
}

function paraForma(codigo: string): CodigoFormaPagamento {
  if (!ehCodigoFormaPagamento(codigo)) {
    throw new Error(`Forma de pagamento desconhecida no banco: ${codigo}`);
  }

  return codigo;
}

function paraConfirmacao(valor: string): ConfirmacaoPagamento {
  /* v8 ignore next 3 -- defesa: `ck_pagamentos_confirmacao` já recusa */
  if (!ehConfirmacaoPagamento(valor)) {
    throw new Error(`Confirmação de pagamento desconhecida no banco: ${valor}`);
  }

  return valor;
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
    suspensaEm: ouNulo(venda.suspensao?.em),
    rotuloSuspensao: ouNulo(venda.suspensao?.rotulo),
    canceladaEm: ouNulo(venda.cancelamento?.em),
    motivoCancelamento: ouNulo(venda.cancelamento?.motivo),
    canceladaPorId: ouNulo(venda.cancelamento?.solicitadoPorId.valor),
    cancelamentoAutorizadoPorId: ouNulo(venda.cancelamento?.autorizadoPorId?.valor),
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
    custoUnitario: ouNulo(item.custoUnitario?.centavos),
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
    confirmacao: pagamento.confirmacao,
    chave: ouNulo(pagamento.chave),
  }));
}
