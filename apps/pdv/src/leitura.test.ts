import { describe, expect, it } from "vitest";

import { interpretarLeitura, milesimosDoTexto } from "./leitura.js";

/**
 * O campo de código lê tudo: leitor de código de barras, código interno,
 * "3*código" e nome. Esta função só interpreta o texto — se o código existe,
 * quem diz é o servidor.
 */

describe("milesimosDoTexto", () => {
  it.each([
    ["3", "3000"],
    ["0,5", "500"],
    ["0.5", "500"],
    ["1,25", "1250"],
    ["0,350", "350"],
    [" 12 ", "12000"],
  ])("%s → %s milésimos", (texto, esperado) => {
    expect(milesimosDoTexto(texto)).toBe(esperado);
  });

  it.each(["", "0", "0,000", "abc", "1,2345", "1,2,3", "-1", "1234567"])(
    "%s não é quantidade",
    (texto) => {
      expect(milesimosDoTexto(texto)).toBeUndefined();
    },
  );
});

describe("interpretarLeitura", () => {
  it("campo vazio é vazio, com ou sem espaço", () => {
    expect(interpretarLeitura("")).toEqual({ tipo: "VAZIO" });
    expect(interpretarLeitura("   ")).toEqual({ tipo: "VAZIO" });
  });

  it("🔑 código de barras é código, e não pode ser nome", () => {
    expect(interpretarLeitura("7891000315507")).toEqual({
      tipo: "CODIGO",
      codigo: "7891000315507",
      podeSerNome: false,
    });
  });

  it("🔑 texto com letra pode ser nome — se o código não existir, vira busca", () => {
    expect(interpretarLeitura(" pão ")).toEqual({
      tipo: "CODIGO",
      codigo: "pão",
      podeSerNome: true,
    });
  });

  it("🔑 3*código leva o multiplicador em milésimos", () => {
    expect(interpretarLeitura("3*7891000315507")).toEqual({
      tipo: "CODIGO",
      codigo: "7891000315507",
      multiplicador: "3000",
      podeSerNome: false,
    });
    expect(interpretarLeitura("2 * cafe")).toMatchObject({
      codigo: "cafe",
      multiplicador: "2000",
      podeSerNome: true,
    });
  });

  it("quantidade inválida ou código ausente explicam o formato", () => {
    expect(interpretarLeitura("x*789")).toMatchObject({
      tipo: "INVALIDA",
      mensagem: expect.stringContaining("Antes do *"),
    });
    expect(interpretarLeitura("3*")).toMatchObject({
      tipo: "INVALIDA",
      mensagem: expect.stringContaining("Depois do *"),
    });
  });
});
