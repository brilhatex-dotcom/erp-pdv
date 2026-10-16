import type { Devolucao, Pagamento, Venda, VendaItem } from "@erp/domain";

/**
 * Como a venda atravessa a fronteira.
 *
 * Dinheiro e quantidade saem como **inteiro em texto** (ADR-0019): `JSON.parse`
 * transforma número em `double`, e o centavo que some no caminho só aparece no
 * fechamento do caixa, sem explicação.
 *
 * Os totais vêm prontos do domínio. A tela não recalcula nada: o desconto
 * rateado e o arredondamento são regra de negócio, e uma segunda conta no
 * navegador divergiria da primeira no primeiro centavo.
 */

export function apresentarVenda(venda: Venda): Record<string, unknown> {
  return {
    id: venda.id.valor,
    numero: venda.numero,
    status: venda.status,
    estacaoId: venda.estacaoId.valor,
    operadorId: venda.operadorId.valor,
    clienteId: venda.clienteId?.valor,
    abertaEm: venda.abertaEm.toISOString(),
    finalizadaEm: venda.finalizadaEm?.toISOString(),
    subtotal: venda.subtotal.centavos.toString(),
    descontoItens: venda.descontoItens.centavos.toString(),
    descontoVenda: venda.descontoVenda.centavos.toString(),
    descontoTotal: venda.descontoTotal.centavos.toString(),
    total: venda.total.centavos.toString(),
    totalPago: venda.totalPago.centavos.toString(),
    faltaPagar: venda.faltaPagar.centavos.toString(),
    troco: venda.troco.centavos.toString(),
    suspensao:
      venda.suspensao === undefined
        ? undefined
        : { em: venda.suspensao.em.toISOString(), rotulo: venda.suspensao.rotulo },
    cancelamento:
      venda.cancelamento === undefined
        ? undefined
        : { em: venda.cancelamento.em.toISOString(), motivo: venda.cancelamento.motivo },
    itens: venda.itens.map(apresentarItem),
    pagamentos: venda.pagamentos.map(apresentarPagamento),
  };
}

export function apresentarItem(item: VendaItem): Record<string, unknown> {
  return {
    numero: item.numero,
    produtoId: item.produtoId.valor,
    descricao: item.descricao,
    quantidade: {
      milesimos: item.quantidade.milesimos.toString(),
      unidade: item.quantidade.unidade.codigo,
    },
    precoUnitario: item.precoUnitario.centavos.toString(),
    totalBruto: item.totalBruto.centavos.toString(),
    desconto: item.desconto.centavos.toString(),
    descontoRateado: item.descontoRateado.centavos.toString(),
    total: item.total.centavos.toString(),
  };
}

/**
 * O pagamento, com a posição na lista — é ela que identifica qual tirar.
 *
 * Nada de cartão além da forma, do valor, das parcelas e do código de
 * autorização da maquininha: o número do cartão nunca entra no sistema (o
 * domínio recusa), e por isso nunca sai.
 */
export function apresentarPagamento(
  pagamento: Pagamento,
  indice: number,
): Record<string, unknown> {
  return {
    indice,
    forma: pagamento.forma.codigo,
    descricao: pagamento.forma.descricao,
    valor: pagamento.valor.centavos.toString(),
    parcelas: pagamento.parcelas,
    autorizacao: pagamento.autorizacao,
    confirmacao: pagamento.confirmacao,
  };
}

export function apresentarDevolucao(devolucao: Devolucao): Record<string, unknown> {
  return {
    id: devolucao.id.valor,
    vendaId: devolucao.vendaId.valor,
    numeroVenda: devolucao.numeroVenda,
    formaReembolso: devolucao.formaReembolso,
    motivo: devolucao.motivo,
    ocorridaEm: devolucao.ocorridaEm.toISOString(),
    valorTotal: devolucao.valorTotal.centavos.toString(),
    itens: devolucao.itens.map((item) => ({
      numeroItem: item.numeroItem,
      descricao: item.descricao,
      quantidade: {
        milesimos: item.quantidade.milesimos.toString(),
        unidade: item.quantidade.unidade.codigo,
      },
      valor: item.valor.centavos.toString(),
      destino: item.destino,
    })),
  };
}
