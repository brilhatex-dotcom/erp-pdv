import { describe, expect, it } from "vitest";

import { Dinheiro } from "../valores/Dinheiro.js";
import { ehConfirmacaoPagamento, Pagamento, pareceNumeroDeCartao } from "./Pagamento.js";

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

describe("Pagamento — confirmação", () => {
  it("nasce manual: sem integração, quem confirma é o operador", () => {
    expect(Pagamento.criar("PIX", reais("10,00")).unwrap().confirmacao).toBe("MANUAL");
  });

  it.each(["INTEGRACAO", "SIMULADA"] as const)("guarda confirmação %s", (confirmacao) => {
    const pagamento = Pagamento.criar("PIX", reais("10,00"), { confirmacao }).unwrap();

    expect(pagamento.confirmacao).toBe(confirmacao);
  });

  it("reconhece os valores de confirmação que existem", () => {
    expect(ehConfirmacaoPagamento("MANUAL")).toBe(true);
    expect(ehConfirmacaoPagamento("SIMULADA")).toBe(true);
    expect(ehConfirmacaoPagamento("AUTOMATICA")).toBe(false);
  });
});

describe("Pagamento — número de cartão", () => {
  it("🔑 recusa o número completo do cartão no campo de autorização", () => {
    // Guardar o PAN colocaria a loja no escopo do PCI-DSS por um campo que só
    // precisava do NSU.
    const resultado = Pagamento.criar("CARTAO_CREDITO", reais("50,00"), {
      autorizacao: "4111 1111 1111 1111",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PAGAMENTO_NUMERO_DE_CARTAO");
      expect(resultado.error.mensagem).toContain("NSU");
    }
  });

  it("aceita NSU comum da maquininha", () => {
    const pagamento = Pagamento.criar("CARTAO_DEBITO", reais("50,00"), {
      autorizacao: "004512",
    }).unwrap();

    expect(pagamento.autorizacao).toBe("004512");
  });

  it.each([
    ["16 dígitos que passam no Luhn", "4111111111111111", true],
    ["com hífens", "5555-5555-5555-4444", true],
    ["com pontos", "4012.8888.8888.1881", true],
    ["16 dígitos que não passam no Luhn", "4111111111111112", false],
    ["12 dígitos", "411111111111", false],
    ["20 dígitos", "41111111111111111111", false],
    ["com letras", "AB12CD34EF56GH78", false],
  ])("%s → %s", (_caso, texto, esperado) => {
    expect(pareceNumeroDeCartao(texto)).toBe(esperado);
  });
});

describe("Pagamento — chave de reenvio", () => {
  it("guarda a chave sem espaços nas pontas", () => {
    const pagamento = Pagamento.criar("DINHEIRO", reais("5,00"), {
      chave: "  018f3a2b-chave  ",
    }).unwrap();

    expect(pagamento.chave).toBe("018f3a2b-chave");
  });

  it.each([
    ["vazia", "   "],
    ["longa demais", "x".repeat(65)],
  ])("recusa chave %s", (_caso, chave) => {
    const resultado = Pagamento.criar("DINHEIRO", reais("5,00"), { chave });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PAGAMENTO_CHAVE_INVALIDA");
    }
  });

  it("compara conteúdo por forma e valor", () => {
    const pagamento = Pagamento.criar("PIX", reais("30,00")).unwrap();

    expect(pagamento.mesmoConteudoQue("PIX", reais("30,00"))).toBe(true);
    expect(pagamento.mesmoConteudoQue("PIX", reais("31,00"))).toBe(false);
    expect(pagamento.mesmoConteudoQue("DINHEIRO", reais("30,00"))).toBe(false);
  });
});

describe("Pagamento — reconstituição", () => {
  it("não revalida: dado antigo continua legível mesmo com regra nova", () => {
    const pagamento = Pagamento.reconstituir({
      forma: "CARTAO_CREDITO",
      valor: reais("90,00"),
      autorizacao: "4111111111111111",
      parcelas: 3,
      confirmacao: "MANUAL",
      chave: "abc",
    });

    expect(pagamento.forma.codigo).toBe("CARTAO_CREDITO");
    expect(pagamento.autorizacao).toBe("4111111111111111");
    expect(pagamento.parcelas).toBe(3);
    expect(pagamento.chave).toBe("abc");
    expect(pagamento.entraNaGaveta).toBe(false);
  });
});
