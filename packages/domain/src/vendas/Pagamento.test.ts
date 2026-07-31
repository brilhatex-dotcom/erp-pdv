import { describe, expect, it } from "vitest";

import { Dinheiro } from "../valores/Dinheiro.js";
import { Pagamento } from "./Pagamento.js";

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

describe("Pagamento — criação", () => {
  it("cria pagamento em dinheiro", () => {
    const pagamento = Pagamento.criar("DINHEIRO", reais("50,00")).unwrap();

    expect(pagamento.forma.codigo).toBe("DINHEIRO");
    expect(pagamento.valor.formatar()).toBe("R$ 50,00");
    expect(pagamento.parcelas).toBe(1);
  });

  it("rejeita valor zero", () => {
    const resultado = Pagamento.criar("DINHEIRO", reais("0,00"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PAGAMENTO_VALOR_INVALIDO");
    }
  });

  it("rejeita valor negativo", () => {
    expect(Pagamento.criar("DINHEIRO", reais("-1,00")).isErr()).toBe(true);
  });
});

describe("Pagamento — parcelamento", () => {
  it("aceita parcelamento em cartão de crédito", () => {
    const pagamento = Pagamento.criar("CARTAO_CREDITO", reais("300,00"), {
      parcelas: 3,
    }).unwrap();

    expect(pagamento.parcelas).toBe(3);
  });

  it("aceita parcelamento em crediário", () => {
    expect(
      Pagamento.criar("CREDIARIO", reais("300,00"), { parcelas: 6 }).unwrap().parcelas,
    ).toBe(6);
  });

  it.each(["DINHEIRO", "PIX", "CARTAO_DEBITO", "VALE_ALIMENTACAO"] as const)(
    "recusa parcelar %s",
    (codigo) => {
      const resultado = Pagamento.criar(codigo, reais("100,00"), { parcelas: 2 });

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("PAGAMENTO_PARCELAMENTO_NAO_PERMITIDO");
      }
    },
  );

  it("aceita uma parcela em qualquer forma", () => {
    expect(Pagamento.criar("PIX", reais("10,00"), { parcelas: 1 }).isOk()).toBe(true);
  });

  it.each([0, -1, 1.5])("rejeita %s parcelas", (parcelas) => {
    const resultado = Pagamento.criar("CARTAO_CREDITO", reais("100,00"), { parcelas });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PAGAMENTO_PARCELAS_INVALIDAS");
    }
  });

  it("assume uma parcela quando não informado", () => {
    expect(Pagamento.criar("CARTAO_CREDITO", reais("100,00")).unwrap().parcelas).toBe(1);
  });
});

describe("Pagamento — autorização", () => {
  it("guarda o NSU da maquininha", () => {
    const pagamento = Pagamento.criar("CARTAO_DEBITO", reais("50,00"), {
      autorizacao: "NSU998877",
    }).unwrap();

    expect(pagamento.autorizacao).toBe("NSU998877");
  });

  it("remove espaços das pontas", () => {
    expect(
      Pagamento.criar("CARTAO_DEBITO", reais("50,00"), {
        autorizacao: "  NSU1  ",
      }).unwrap().autorizacao,
    ).toBe("NSU1");
  });

  it("trata autorização em branco como ausente", () => {
    expect(
      Pagamento.criar("CARTAO_DEBITO", reais("50,00"), {
        autorizacao: "   ",
      }).unwrap().autorizacao,
    ).toBeUndefined();
  });

  it("não exige autorização", () => {
    expect(Pagamento.criar("DINHEIRO", reais("50,00")).unwrap().autorizacao).toBe(
      undefined,
    );
  });
});

describe("Pagamento — classificação para o caixa", () => {
  it("dinheiro entra na gaveta", () => {
    expect(Pagamento.criar("DINHEIRO", reais("10,00")).unwrap().entraNaGaveta).toBe(true);
  });

  it.each(["PIX", "CARTAO_DEBITO", "CARTAO_CREDITO", "CREDIARIO"] as const)(
    "%s não entra na gaveta",
    (codigo) => {
      expect(Pagamento.criar(codigo, reais("10,00")).unwrap().entraNaGaveta).toBe(false);
    },
  );

  it("crediário gera conta a receber", () => {
    expect(Pagamento.criar("CREDIARIO", reais("10,00")).unwrap().geraContaReceber).toBe(
      true,
    );
  });

  it.each(["DINHEIRO", "PIX", "CARTAO_CREDITO"] as const)(
    "%s não gera conta a receber",
    (codigo) => {
      expect(Pagamento.criar(codigo, reais("10,00")).unwrap().geraContaReceber).toBe(
        false,
      );
    },
  );
});
