import { describe, expect, it } from "vitest";

import { ehCnpjAlfanumerico, ehCnpjValido, ehCpfValido } from "./documento.js";

describe("ehCpfValido", () => {
  it.each([
    ["529.982.247-25", "com máscara"],
    ["52998224725", "sem máscara"],
    ["111.444.777-35", "com dígito verificador zero no cálculo"],
  ])("aceita CPF válido %s (%s)", (cpf) => {
    expect(ehCpfValido(cpf)).toBe(true);
  });

  it("aceita CPF cujos dois dígitos verificadores são zero", () => {
    // Quando o resto do módulo 11 é menor que 2, o dígito é 0. Sem este caso o
    // ramo de arredondamento do cálculo nunca é exercitado.
    expect(ehCpfValido("00000003700")).toBe(true);
  });

  it("rejeita CPF com o PRIMEIRO dígito verificador errado", () => {
    // O correto é 25; aqui o primeiro dígito está errado, o que precisa
    // interromper a validação antes de conferir o segundo.
    expect(ehCpfValido("529.982.247-15")).toBe(false);
  });

  it("rejeita CPF com o SEGUNDO dígito verificador errado", () => {
    expect(ehCpfValido("529.982.247-26")).toBe(false);
  });

  it.each(["00000000000", "11111111111", "99999999999"])(
    "rejeita a sequência repetida %s, que passa no cálculo mas não é CPF real",
    (cpf) => {
      expect(ehCpfValido(cpf)).toBe(false);
    },
  );

  it.each([
    ["", "vazio"],
    ["123", "curto demais"],
    ["529982247250", "longo demais"],
    ["abcdefghijk", "sem dígitos"],
  ])("rejeita %s (%s)", (cpf) => {
    expect(ehCpfValido(cpf)).toBe(false);
  });
});

describe("ehCnpjValido — formato numérico (legado)", () => {
  it.each([
    ["11.222.333/0001-81", "com máscara"],
    ["11222333000181", "sem máscara"],
  ])("aceita CNPJ válido %s (%s)", (cnpj) => {
    expect(ehCnpjValido(cnpj)).toBe(true);
  });

  it("aceita CNPJ cujo primeiro dígito verificador é zero", () => {
    expect(ehCnpjValido("11222333000009")).toBe(true);
  });

  it("rejeita CNPJ com o PRIMEIRO dígito verificador errado", () => {
    // O correto é 81; aqui o primeiro dígito está errado.
    expect(ehCnpjValido("11.222.333/0001-91")).toBe(false);
  });

  it("rejeita CNPJ com o SEGUNDO dígito verificador errado", () => {
    expect(ehCnpjValido("11.222.333/0001-82")).toBe(false);
  });

  it.each(["00000000000000", "11111111111111"])(
    "rejeita a sequência repetida %s",
    (cnpj) => {
      expect(ehCnpjValido(cnpj)).toBe(false);
    },
  );

  it.each([
    ["", "vazio"],
    ["1122233300018", "curto demais"],
    ["112223330001811", "longo demais"],
  ])("rejeita %s (%s)", (cnpj) => {
    expect(ehCnpjValido(cnpj)).toBe(false);
  });
});

describe("ehCnpjValido — formato alfanumérico (2026)", () => {
  // Casos derivados do algoritmo oficial: valor do caractere = ASCII − 48.
  it("aceita CNPJ alfanumérico válido", () => {
    expect(ehCnpjValido("12ABC34501DE35")).toBe(true);
  });

  it("aceita CNPJ alfanumérico com máscara", () => {
    expect(ehCnpjValido("12.ABC.345/01DE-35")).toBe(true);
  });

  it("aceita letras minúsculas, normalizando para maiúsculas", () => {
    expect(ehCnpjValido("12abc34501de35")).toBe(true);
  });

  it("rejeita CNPJ alfanumérico com dígito verificador errado", () => {
    expect(ehCnpjValido("12ABC34501DE36")).toBe(false);
  });

  it("rejeita letra na posição de dígito verificador", () => {
    // Os dois últimos caracteres são sempre numéricos, mesmo no alfanumérico.
    expect(ehCnpjValido("12ABC34501DEA5")).toBe(false);
  });
});

describe("ehCnpjAlfanumerico", () => {
  it("identifica o formato alfanumérico", () => {
    expect(ehCnpjAlfanumerico("12ABC34501DE35")).toBe(true);
  });

  it("não confunde CNPJ numérico com alfanumérico", () => {
    expect(ehCnpjAlfanumerico("11222333000181")).toBe(false);
  });

  it("ignora letras fora dos 12 primeiros caracteres", () => {
    expect(ehCnpjAlfanumerico("112223330001AB")).toBe(false);
  });

  it("rejeita comprimento inválido", () => {
    expect(ehCnpjAlfanumerico("12ABC")).toBe(false);
  });
});
