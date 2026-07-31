import { describe, expect, it } from "vitest";

import { Dinheiro } from "../valores/Dinheiro.js";
import { ILIMITADO, LimitesPapel, PERCENTUAL_TOTAL } from "./LimitesPapel.js";

const reais = (valor: string): Dinheiro => Dinheiro.deReais(valor).unwrap();

function limites(
  sobrescritas: Partial<Parameters<typeof LimitesPapel.criar>[0]> = {},
): LimitesPapel {
  return LimitesPapel.criar({
    descontoItem: 500,
    descontoVenda: 300,
    sangria: reais("500.00"),
    estornoEmDinheiro: reais("200.00"),
    cancelarVendaAteMinutos: 30,
    ...sobrescritas,
  }).unwrap();
}

describe("LimitesPapel.criar", () => {
  it("aceita limites válidos", () => {
    const criado = limites();

    expect(criado.descontoItem).toBe(500);
    expect(criado.descontoVenda).toBe(300);
    expect(criado.cancelarVendaAteMinutos).toBe(30);
  });

  it("aceita as pontas do percentual", () => {
    expect(limites({ descontoItem: 0 }).descontoItem).toBe(0);
    expect(limites({ descontoItem: PERCENTUAL_TOTAL }).descontoItem).toBe(10_000);
  });

  it("recusa percentual acima de cem por cento", () => {
    const resultado = LimitesPapel.criar({
      descontoItem: 10_001,
      descontoVenda: 0,
      sangria: Dinheiro.zero(),
      estornoEmDinheiro: Dinheiro.zero(),
      cancelarVendaAteMinutos: 0,
    });

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe(
      "LIMITE_PERCENTUAL_INVALIDO",
    );
  });

  it("recusa percentual negativo e fracionário", () => {
    // Fração aqui seria ponto flutuante entrando no cálculo de desconto — o
    // centavo de diferença que ninguém explica no fechamento (ADR-0009).
    for (const valor of [-1, 1.5]) {
      expect(
        LimitesPapel.criar({
          descontoItem: valor,
          descontoVenda: 0,
          sangria: Dinheiro.zero(),
          estornoEmDinheiro: Dinheiro.zero(),
          cancelarVendaAteMinutos: 0,
        }).isErr(),
      ).toBe(true);
    }
  });

  it("aponta qual campo de percentual está errado", () => {
    const resultado = LimitesPapel.criar({
      descontoItem: 500,
      descontoVenda: -1,
      sangria: Dinheiro.zero(),
      estornoEmDinheiro: Dinheiro.zero(),
      cancelarVendaAteMinutos: 0,
    });

    expect(resultado.isErr() && resultado.error.detalhes?.["campo"]).toBe(
      "descontoVenda",
    );
  });

  it("recusa janela de cancelamento negativa ou fracionária", () => {
    for (const minutos of [-1, 2.5]) {
      const resultado = LimitesPapel.criar({
        descontoItem: 0,
        descontoVenda: 0,
        sangria: Dinheiro.zero(),
        estornoEmDinheiro: Dinheiro.zero(),
        cancelarVendaAteMinutos: minutos,
      });

      expect(resultado.isErr()).toBe(true);
      expect(resultado.isErr() && resultado.error.codigo).toBe("LIMITE_MINUTOS_INVALIDO");
    }
  });

  it("aceita janela ilimitada", () => {
    expect(limites({ cancelarVendaAteMinutos: ILIMITADO }).cancelarVendaAteMinutos).toBe(
      ILIMITADO,
    );
  });

  it("recusa limite de valor negativo", () => {
    const resultado = LimitesPapel.criar({
      descontoItem: 0,
      descontoVenda: 0,
      sangria: Dinheiro.deCentavos(-1n).unwrap(),
      estornoEmDinheiro: Dinheiro.zero(),
      cancelarVendaAteMinutos: 0,
    });

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("LIMITE_VALOR_NEGATIVO");
  });

  it("aponta qual limite de valor está errado", () => {
    const resultado = LimitesPapel.criar({
      descontoItem: 0,
      descontoVenda: 0,
      sangria: Dinheiro.zero(),
      estornoEmDinheiro: Dinheiro.deCentavos(-500n).unwrap(),
      cancelarVendaAteMinutos: 0,
    });

    expect(resultado.isErr() && resultado.error.detalhes?.["campo"]).toBe(
      "estornoEmDinheiro",
    );
  });
});

describe("cobertura de desconto", () => {
  it("cobre até o limite, inclusive", () => {
    const papel = limites();

    expect(papel.cobreDescontoEmItem(499)).toBe(true);
    expect(papel.cobreDescontoEmItem(500)).toBe(true);
    expect(papel.cobreDescontoEmItem(501)).toBe(false);
  });

  it("distingue o limite do item do limite da venda", () => {
    // Desconto de 4% num item cabe; 4% na venda inteira não. São grandezas
    // diferentes e limites diferentes (§9.4).
    const papel = limites();

    expect(papel.cobreDescontoEmItem(400)).toBe(true);
    expect(papel.cobreDescontoNaVenda(400)).toBe(false);
  });
});

describe("cobertura de valor", () => {
  it("cobre até o teto, inclusive", () => {
    const papel = limites();

    expect(papel.cobreSangria(reais("499.99"))).toBe(true);
    expect(papel.cobreSangria(reais("500.00"))).toBe(true);
    expect(papel.cobreSangria(reais("500.01"))).toBe(false);
  });

  it("ilimitado cobre qualquer valor", () => {
    const papel = limites({ sangria: ILIMITADO });

    expect(papel.cobreSangria(reais("999999.00"))).toBe(true);
  });

  it("aplica o teto de estorno separado do de sangria", () => {
    const papel = limites();

    expect(papel.cobreEstornoEmDinheiro(reais("200.00"))).toBe(true);
    expect(papel.cobreEstornoEmDinheiro(reais("300.00"))).toBe(false);
  });

  it("ilimitado cobre estorno de qualquer valor", () => {
    expect(
      limites({ estornoEmDinheiro: ILIMITADO }).cobreEstornoEmDinheiro(reais("50000.00")),
    ).toBe(true);
  });
});

describe("cobertura de cancelamento", () => {
  it("cobre dentro da janela", () => {
    const papel = limites();

    expect(papel.cobreCancelamentoApos(29)).toBe(true);
    expect(papel.cobreCancelamentoApos(30)).toBe(true);
    expect(papel.cobreCancelamentoApos(31)).toBe(false);
  });

  it("janela zero não cobre nem cancelamento imediato", () => {
    // É o operador de caixa: cancelar venda finalizada não é atribuição dele,
    // nem um segundo depois.
    expect(limites({ cancelarVendaAteMinutos: 0 }).cobreCancelamentoApos(0)).toBe(true);
    expect(limites({ cancelarVendaAteMinutos: 0 }).cobreCancelamentoApos(1)).toBe(false);
  });

  it("ilimitado cobre venda de meses atrás", () => {
    expect(
      limites({ cancelarVendaAteMinutos: ILIMITADO }).cobreCancelamentoApos(100_000),
    ).toBe(true);
  });
});

describe("LimitesPapel.nenhum", () => {
  it("não concede alçada nenhuma", () => {
    // Papel novo criado pela empresa não deve ganhar alçada por esquecimento.
    const nenhum = LimitesPapel.nenhum();

    expect(nenhum.cobreDescontoEmItem(1)).toBe(false);
    expect(nenhum.cobreDescontoNaVenda(1)).toBe(false);
    expect(nenhum.cobreSangria(reais("0.01"))).toBe(false);
    expect(nenhum.cobreEstornoEmDinheiro(reais("0.01"))).toBe(false);
    expect(nenhum.cobreCancelamentoApos(1)).toBe(false);
  });

  it("expõe os tetos zerados", () => {
    const nenhum = LimitesPapel.nenhum();

    expect(nenhum.descontoItem).toBe(0);
    expect(nenhum.descontoVenda).toBe(0);
    expect(nenhum.sangria).toEqual(Dinheiro.zero());
    expect(nenhum.estornoEmDinheiro).toEqual(Dinheiro.zero());
    expect(nenhum.cancelarVendaAteMinutos).toBe(0);
  });
});
