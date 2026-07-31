/**
 * Formas de pagamento aceitas no PDV.
 *
 * Os códigos fiscais correspondem ao campo `tPag` do layout da NF-e/NFC-e.
 * Mantê-los aqui, junto da forma, evita uma tabela de-para espalhada pelo
 * módulo fiscal — e é o módulo fiscal que some quando a empresa não emite
 * documento (ADR-0016), não a forma de pagamento.
 */
export type CodigoFormaPagamento =
  | "DINHEIRO"
  | "PIX"
  | "CARTAO_DEBITO"
  | "CARTAO_CREDITO"
  | "VALE_ALIMENTACAO"
  | "VALE_REFEICAO"
  | "CREDIARIO"
  | "CHEQUE"
  | "OUTRO";

export interface FormaPagamento {
  readonly codigo: CodigoFormaPagamento;
  readonly descricao: string;
  /**
   * Entra **fisicamente na gaveta**. Só dinheiro.
   *
   * É o que a conferência de fechamento confronta com a contagem manual;
   * cartão e PIX conferem contra o extrato, não contra a gaveta.
   */
  readonly entraNaGaveta: boolean;
  /**
   * Gera valor **a receber** em vez de recebimento.
   *
   * 🔑 O crediário é o caso. Somá-lo como dinheiro no fechamento faria o caixa
   * fechar com sobra que não existe, e o histórico ficaria irrecuperável
   * (`docs/ANALISE-SEGMENTOS.md` §3.3).
   */
  readonly geraContaReceber: boolean;
  /** Só dinheiro devolve troco. */
  readonly permiteTroco: boolean;
  /** Código `tPag` do layout fiscal. */
  readonly codigoFiscal: string;
}

export const FORMAS_PAGAMENTO = {
  DINHEIRO: {
    codigo: "DINHEIRO",
    descricao: "Dinheiro",
    entraNaGaveta: true,
    geraContaReceber: false,
    permiteTroco: true,
    codigoFiscal: "01",
  },
  CHEQUE: {
    codigo: "CHEQUE",
    descricao: "Cheque",
    entraNaGaveta: false,
    geraContaReceber: false,
    permiteTroco: false,
    codigoFiscal: "02",
  },
  CARTAO_CREDITO: {
    codigo: "CARTAO_CREDITO",
    descricao: "Cartão de crédito",
    entraNaGaveta: false,
    geraContaReceber: false,
    permiteTroco: false,
    codigoFiscal: "03",
  },
  CARTAO_DEBITO: {
    codigo: "CARTAO_DEBITO",
    descricao: "Cartão de débito",
    entraNaGaveta: false,
    geraContaReceber: false,
    permiteTroco: false,
    codigoFiscal: "04",
  },
  CREDIARIO: {
    codigo: "CREDIARIO",
    descricao: "Crediário",
    entraNaGaveta: false,
    geraContaReceber: true,
    permiteTroco: false,
    // "05 — Crédito Loja" no layout fiscal é exatamente o fiado.
    codigoFiscal: "05",
  },
  VALE_ALIMENTACAO: {
    codigo: "VALE_ALIMENTACAO",
    descricao: "Vale-alimentação",
    entraNaGaveta: false,
    geraContaReceber: false,
    permiteTroco: false,
    codigoFiscal: "10",
  },
  VALE_REFEICAO: {
    codigo: "VALE_REFEICAO",
    descricao: "Vale-refeição",
    entraNaGaveta: false,
    geraContaReceber: false,
    permiteTroco: false,
    codigoFiscal: "11",
  },
  PIX: {
    codigo: "PIX",
    descricao: "PIX",
    entraNaGaveta: false,
    geraContaReceber: false,
    permiteTroco: false,
    codigoFiscal: "17",
  },
  OUTRO: {
    codigo: "OUTRO",
    descricao: "Outro",
    entraNaGaveta: false,
    geraContaReceber: false,
    permiteTroco: false,
    codigoFiscal: "99",
  },
} as const satisfies Record<CodigoFormaPagamento, FormaPagamento>;

export function obterFormaPagamento(codigo: CodigoFormaPagamento): FormaPagamento {
  return FORMAS_PAGAMENTO[codigo];
}

export function ehCodigoFormaPagamento(codigo: string): codigo is CodigoFormaPagamento {
  return Object.hasOwn(FORMAS_PAGAMENTO, codigo);
}
