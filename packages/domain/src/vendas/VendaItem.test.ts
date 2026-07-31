import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import { type DadosItemVenda, VendaItem } from "./VendaItem.js";

const PRODUTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a07").unwrap();

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function un(valor: string): Quantidade {
  return Quantidade.de(valor, "UN").unwrap();
}

function dados(sobrescritas: Partial<DadosItemVenda> = {}): DadosItemVenda {
  return {
    produtoId: PRODUTO,
    descricao: "Refrigerante Cola 2L",
    quantidade: un("2"),
    precoUnitario: reais("9,90"),
    ...sobrescritas,
  };
}

function criar(sobrescritas: Partial<DadosItemVenda> = {}, numero = 1): VendaItem {
  const resultado = VendaItem.criar(numero, dados(sobrescritas));
  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

describe("VendaItem — criação", () => {
  it("guarda o retrato do produto no momento da venda", () => {
    const item = criar();

    expect(item.numero).toBe(1);
    expect(item.produtoId.equals(PRODUTO)).toBe(true);
    expect(item.descricao).toBe("Refrigerante Cola 2L");
    expect(item.precoUnitario.formatar()).toBe("R$ 9,90");
  });

  it("remove espaços da descrição", () => {
    expect(criar({ descricao: "  Pão  " }).descricao).toBe("Pão");
  });

  it("nasce sem descontos", () => {
    const item = criar();

    expect(item.desconto.ehZero()).toBe(true);
    expect(item.descontoRateado.ehZero()).toBe(true);
  });

  it.each([0, -1, 1.5])("rejeita número de item %s", (numero) => {
    const resultado = VendaItem.criar(numero, dados());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_NUMERO_INVALIDO");
    }
  });
});

describe("VendaItem — totais", () => {
  it("calcula preço × quantidade", () => {
    expect(criar().totalBruto.formatar()).toBe("R$ 19,80");
  });

  it("calcula item pesável", () => {
    const item = criar({
      quantidade: Quantidade.de("1,250", "KG").unwrap(),
      precoUnitario: reais("79,90"),
    });

    expect(item.totalBruto.formatar()).toBe("R$ 99,88");
  });

  it("abate o desconto do próprio item", () => {
    const item = criar();
    item.aplicarDesconto(reais("1,80"));

    expect(item.totalAposDescontoProprio.formatar()).toBe("R$ 18,00");
    expect(item.total.formatar()).toBe("R$ 18,00");
  });

  it("abate também o desconto rateado da venda", () => {
    const item = criar();
    item.aplicarDesconto(reais("1,80"));
    item.definirDescontoRateado(reais("2,00"));

    expect(item.totalAposDescontoProprio.formatar()).toBe("R$ 18,00");
    expect(item.total.formatar()).toBe("R$ 16,00");
  });
});

describe("VendaItem — desconto", () => {
  it("aceita desconto até o valor do item", () => {
    const item = criar();

    expect(item.aplicarDesconto(reais("19,80")).isOk()).toBe(true);
    expect(item.total.ehZero()).toBe(true);
  });

  it("recusa desconto maior que o item", () => {
    const resultado = criar().aplicarDesconto(reais("19,81"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_DESCONTO_MAIOR_QUE_ITEM");
      expect(resultado.error.mensagem).toContain("R$ 19,80");
    }
  });

  it("recusa desconto negativo", () => {
    const resultado = criar().aplicarDesconto(reais("-0,01"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_DESCONTO_NEGATIVO");
    }
  });

  it("aceita desconto zero", () => {
    expect(criar().aplicarDesconto(Dinheiro.zero()).isOk()).toBe(true);
  });
});

describe("VendaItem — alteração de quantidade", () => {
  it("recalcula o total", () => {
    const item = criar();

    expect(item.alterarQuantidade(un("5")).isOk()).toBe(true);
    expect(item.totalBruto.formatar()).toBe("R$ 49,50");
  });

  it("recusa unidade diferente", () => {
    const resultado = criar().alterarQuantidade(Quantidade.de("1", "KG").unwrap());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_UNIDADE_DIFERENTE");
    }
  });

  it("recusa quantidade zero", () => {
    const resultado = criar().alterarQuantidade(un("0"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_QUANTIDADE_INVALIDA");
    }
  });

  it("recusa quantidade negativa", () => {
    expect(criar().alterarQuantidade(un("1").negar()).isErr()).toBe(true);
  });

  it("reduz o desconto quando ele passa a ser maior que o item", () => {
    // Sem isso, diminuir a quantidade deixaria o item com total negativo.
    const item = criar({ quantidade: un("10") }); // R$ 99,00
    item.aplicarDesconto(reais("50,00"));

    item.alterarQuantidade(un("2")); // agora vale R$ 19,80

    expect(item.desconto.formatar()).toBe("R$ 19,80");
    expect(item.total.ehZero()).toBe(true);
  });

  it("preserva o desconto quando ele continua cabendo", () => {
    const item = criar({ quantidade: un("10") });
    item.aplicarDesconto(reais("5,00"));

    item.alterarQuantidade(un("5")); // R$ 49,50

    expect(item.desconto.formatar()).toBe("R$ 5,00");
  });
});
