import { describe, expect, it } from "vitest";

import { ReferenciaProduto } from "./ReferenciaProduto.js";

describe("ReferenciaProduto — criação", () => {
  it.each([
    ["EAN", "7891000315507"],
    ["FABRICANTE", "HG-1234"],
    ["ORIGINAL", "90919-01210"],
    ["SIMILAR", "BOSCH 0242235666"],
    ["INTERNO", "PC-001"],
    ["FORNECEDOR", "F.4455"],
  ] as const)("cria referência do tipo %s", (tipo, valor) => {
    const referencia = ReferenciaProduto.criar(tipo, valor).unwrap();

    expect(referencia.tipo).toBe(tipo);
    expect(referencia.valor).toBe(valor);
  });

  it("remove espaços das pontas, preservando o valor exibido", () => {
    expect(ReferenciaProduto.criar("FABRICANTE", "  HG-1234  ").unwrap().valor).toBe(
      "HG-1234",
    );
  });

  it("rejeita valor vazio", () => {
    const resultado = ReferenciaProduto.criar("FABRICANTE", "");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("REFERENCIA_VAZIA");
    }
  });

  it("rejeita valor só com espaços", () => {
    expect(ReferenciaProduto.criar("FABRICANTE", "   ").isErr()).toBe(true);
  });

  it("rejeita valor longo demais", () => {
    const resultado = ReferenciaProduto.criar("FABRICANTE", "X".repeat(61));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("REFERENCIA_LONGA");
      expect(resultado.error.detalhes?.["tamanho"]).toBe(61);
    }
  });

  it("aceita valor exatamente no limite", () => {
    expect(ReferenciaProduto.criar("FABRICANTE", "X".repeat(60)).isOk()).toBe(true);
  });

  it("rejeita valor que vira vazio depois de normalizado", () => {
    // Só separadores: não identifica nada.
    const resultado = ReferenciaProduto.criar("FABRICANTE", "---...");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("REFERENCIA_SEM_CONTEUDO");
    }
  });
});

describe("ReferenciaProduto — normalização para busca", () => {
  it.each([
    ["HG-1234", "hg1234"],
    ["hg 1234", "hg1234"],
    ["HG.1234", "hg1234"],
    ["HG/1234", "hg1234"],
    ["hg1234", "hg1234"],
  ])("normaliza %s como %s", (entrada, esperado) => {
    expect(ReferenciaProduto.criar("FABRICANTE", entrada).unwrap().normalizado).toBe(
      esperado,
    );
  });

  it("remove acentos", () => {
    expect(ReferenciaProduto.criar("INTERNO", "PEÇA-01").unwrap().normalizado).toBe(
      "peca01",
    );
  });

  it("preserva o valor original para exibição", () => {
    const referencia = ReferenciaProduto.criar("FABRICANTE", "HG-1234").unwrap();

    expect(referencia.valor).toBe("HG-1234");
    expect(referencia.normalizado).toBe("hg1234");
  });
});

describe("ReferenciaProduto — comparação", () => {
  it("considera iguais valores que só diferem em separadores", () => {
    const a = ReferenciaProduto.criar("FABRICANTE", "HG-1234").unwrap();
    const b = ReferenciaProduto.criar("FABRICANTE", "hg 1234").unwrap();

    expect(a.equals(b)).toBe(true);
  });

  it("diferencia o mesmo número em tipos distintos", () => {
    // Código do fabricante e código original coincidirem é comum e legítimo:
    // são referências diferentes apontando para o mesmo item.
    const fabricante = ReferenciaProduto.criar("FABRICANTE", "HG-1234").unwrap();
    const original = ReferenciaProduto.criar("ORIGINAL", "HG-1234").unwrap();

    expect(fabricante.equals(original)).toBe(false);
  });

  it("diferencia valores distintos do mesmo tipo", () => {
    const a = ReferenciaProduto.criar("FABRICANTE", "HG-1234").unwrap();
    const b = ReferenciaProduto.criar("FABRICANTE", "HG-9999").unwrap();

    expect(a.equals(b)).toBe(false);
  });
});

describe("ReferenciaProduto — apresentação", () => {
  it("descreve tipo e valor no toString", () => {
    expect(String(ReferenciaProduto.criar("FABRICANTE", "HG-1234").unwrap())).toBe(
      "FABRICANTE:HG-1234",
    );
  });

  it("serializa tipo e valor original", () => {
    expect(ReferenciaProduto.criar("ORIGINAL", "90919-01210").unwrap().toJSON()).toEqual({
      tipo: "ORIGINAL",
      valor: "90919-01210",
    });
  });
});
