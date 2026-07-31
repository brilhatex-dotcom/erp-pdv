import { describe, expect, it } from "vitest";

import {
  type CodigoFormaPagamento,
  ehCodigoFormaPagamento,
  FORMAS_PAGAMENTO,
  obterFormaPagamento,
} from "./FormaPagamento.js";

const TODAS = Object.values(FORMAS_PAGAMENTO);

describe("FormaPagamento — conferência de caixa", () => {
  it("🔑 só dinheiro entra na gaveta", () => {
    // O fechamento confronta a gaveta com a contagem manual. Cartão e PIX
    // conferem contra o extrato, não contra o dinheiro contado.
    const naGaveta = TODAS.filter((forma) => forma.entraNaGaveta).map((f) => f.codigo);

    expect(naGaveta).toEqual(["DINHEIRO"]);
  });

  it("🔑 só crediário gera conta a receber", () => {
    // Somá-lo como recebido faria o caixa fechar com sobra inexistente.
    const aReceber = TODAS.filter((forma) => forma.geraContaReceber).map((f) => f.codigo);

    expect(aReceber).toEqual(["CREDIARIO"]);
  });

  it("só dinheiro devolve troco", () => {
    const comTroco = TODAS.filter((forma) => forma.permiteTroco).map((f) => f.codigo);

    expect(comTroco).toEqual(["DINHEIRO"]);
  });
});

describe("FormaPagamento — códigos fiscais", () => {
  it.each([
    ["DINHEIRO", "01"],
    ["CHEQUE", "02"],
    ["CARTAO_CREDITO", "03"],
    ["CARTAO_DEBITO", "04"],
    ["CREDIARIO", "05"],
    ["VALE_ALIMENTACAO", "10"],
    ["VALE_REFEICAO", "11"],
    ["PIX", "17"],
    ["OUTRO", "99"],
  ] as const)("%s usa tPag %s", (codigo, fiscal) => {
    expect(obterFormaPagamento(codigo).codigoFiscal).toBe(fiscal);
  });

  it("mapeia crediário para Crédito Loja, que é o fiado no layout fiscal", () => {
    expect(FORMAS_PAGAMENTO.CREDIARIO.codigoFiscal).toBe("05");
  });

  it("não repete código fiscal entre formas", () => {
    const codigos = TODAS.map((forma) => forma.codigoFiscal);

    expect(new Set(codigos).size).toBe(codigos.length);
  });
});

describe("FormaPagamento — registro", () => {
  it("usa o próprio código como chave", () => {
    for (const [chave, forma] of Object.entries(FORMAS_PAGAMENTO)) {
      expect(forma.codigo).toBe(chave);
    }
  });

  it("tem descrição legível para todas as formas", () => {
    for (const forma of TODAS) {
      expect(forma.descricao.length).toBeGreaterThan(0);
    }
  });

  it("reconhece código válido", () => {
    expect(ehCodigoFormaPagamento("PIX")).toBe(true);
  });

  it("rejeita código desconhecido", () => {
    expect(ehCodigoFormaPagamento("BITCOIN")).toBe(false);
  });

  it("obtém a forma pelo código", () => {
    const codigo: CodigoFormaPagamento = "CARTAO_DEBITO";

    expect(obterFormaPagamento(codigo).descricao).toBe("Cartão de débito");
  });
});
