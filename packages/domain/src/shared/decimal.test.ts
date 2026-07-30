import { describe, expect, it } from "vitest";

import { numeroParaTexto, separarDecimal } from "./decimal.js";

describe("separarDecimal", () => {
  it("separa valor com vírgula, como o operador digita", () => {
    expect(separarDecimal("10,50")).toEqual({
      negativo: false,
      inteiros: "10",
      decimais: "50",
    });
  });

  it("separa valor com ponto, como vem de arquivo importado", () => {
    expect(separarDecimal("10.50")).toEqual({
      negativo: false,
      inteiros: "10",
      decimais: "50",
    });
  });

  it("separa valor sem casas decimais", () => {
    expect(separarDecimal("10")).toEqual({
      negativo: false,
      inteiros: "10",
      decimais: "",
    });
  });

  it("reconhece o sinal negativo", () => {
    expect(separarDecimal("-10,50")).toEqual({
      negativo: true,
      inteiros: "10",
      decimais: "50",
    });
  });

  it("reconhece negativo sem casas decimais", () => {
    expect(separarDecimal("-10")).toEqual({
      negativo: true,
      inteiros: "10",
      decimais: "",
    });
  });

  it("ignora espaços", () => {
    expect(separarDecimal(" 10 , 50 ")).toEqual({
      negativo: false,
      inteiros: "10",
      decimais: "50",
    });
  });

  it("preserva muitas casas decimais para quem chama arredondar", () => {
    expect(separarDecimal("1,23456")?.decimais).toBe("23456");
  });

  it.each(["", "abc", "10,50,30", "R$ 10", "10,", ",50", "--10", "1e5"])(
    "rejeita %s",
    (entrada) => {
      expect(separarDecimal(entrada)).toBeUndefined();
    },
  );
});

describe("numeroParaTexto", () => {
  it("converte com quatro casas, sem notação científica", () => {
    expect(numeroParaTexto(10.5)).toBe("10.5000");
  });

  it("descarta o ruído de ponto flutuante das casas distantes", () => {
    // 0.1 + 0.2 é 0.30000000000000004; quatro casas devolvem 0.3000.
    expect(numeroParaTexto(0.1 + 0.2)).toBe("0.3000");
  });

  it("devolve vazio para valor não finito", () => {
    expect(numeroParaTexto(Number.NaN)).toBe("");
    expect(numeroParaTexto(Number.POSITIVE_INFINITY)).toBe("");
  });
});
