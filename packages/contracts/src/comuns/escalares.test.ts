import { describe, expect, it } from "vitest";

import {
  inteiroDeTexto,
  textoDeInteiro,
  zCentavos,
  zCentavosNaoNegativos,
  zDataHora,
  zIdentificador,
  zMilesimos,
  zMilesimosNaoNegativos,
} from "./escalares.js";

describe("zIdentificador", () => {
  it("aceita UUID e normaliza para minúsculas", () => {
    const resultado = zIdentificador.parse("01952A3B-4C5D-7E8F-9A0B-1C2D3E4F5061");

    expect(resultado).toBe("01952a3b-4c5d-7e8f-9a0b-1c2d3e4f5061");
  });

  it("recusa texto que não é UUID", () => {
    for (const invalido of ["", "abc", "01952a3b4c5d7e8f9a0b1c2d3e4f5061", "1"]) {
      expect(zIdentificador.safeParse(invalido).success).toBe(false);
    }
  });

  it("recusa UUID com caractere fora do hexadecimal", () => {
    expect(zIdentificador.safeParse("01952a3b-4c5d-7e8f-9a0b-1c2d3e4f506g").success).toBe(
      false,
    );
  });
});

describe("zCentavos", () => {
  it("aceita inteiro em texto, com ou sem sinal", () => {
    expect(zCentavos.parse("0")).toBe("0");
    expect(zCentavos.parse("1990")).toBe("1990");
    expect(zCentavos.parse("-500")).toBe("-500");
  });

  it("recusa número fracionário", () => {
    // O ponto do ADR-0019: quem tentar mandar reais em vez de centavos é
    // recusado na fronteira, não silenciosamente arredondado.
    expect(zCentavos.safeParse("19.90").success).toBe(false);
  });

  it("recusa zero à esquerda, que abriria duas representações do mesmo valor", () => {
    expect(zCentavos.safeParse("0199").success).toBe(false);
  });

  it("recusa vazio, espaço e texto", () => {
    for (const invalido of ["", " ", "abc", "1e3", "+5", "-0"]) {
      expect(zCentavos.safeParse(invalido).success).toBe(false);
    }
  });

  it("preserva valor acima do inteiro seguro do JavaScript", () => {
    const grande = "9007199254740993";

    expect(inteiroDeTexto(zCentavos.parse(grande))).toBe(9007199254740993n);
  });
});

describe("zCentavosNaoNegativos", () => {
  it("aceita zero e positivo", () => {
    expect(zCentavosNaoNegativos.parse("0")).toBe("0");
    expect(zCentavosNaoNegativos.parse("12345")).toBe("12345");
  });

  it("recusa negativo", () => {
    expect(zCentavosNaoNegativos.safeParse("-1").success).toBe(false);
  });
});

describe("zMilesimos", () => {
  it("aceita inteiro com sinal", () => {
    expect(zMilesimos.parse("-1500")).toBe("-1500");
  });

  it("recusa fração", () => {
    expect(zMilesimos.safeParse("1,5").success).toBe(false);
  });
});

describe("zMilesimosNaoNegativos", () => {
  it("aceita zero", () => {
    expect(zMilesimosNaoNegativos.parse("0")).toBe("0");
  });

  it("recusa negativo", () => {
    expect(zMilesimosNaoNegativos.safeParse("-1").success).toBe(false);
  });
});

describe("zDataHora", () => {
  it("aceita ISO 8601 em UTC", () => {
    expect(zDataHora.parse("2026-07-31T14:05:09Z")).toBe("2026-07-31T14:05:09Z");
  });

  it("aceita milissegundos e deslocamento de fuso", () => {
    expect(zDataHora.safeParse("2026-07-31T14:05:09.123Z").success).toBe(true);
    expect(zDataHora.safeParse("2026-07-31T11:05:09-03:00").success).toBe(true);
  });

  it("recusa data sem fuso", () => {
    // Sem fuso, o fechamento de caixa perto da meia-noite cairia no dia errado.
    expect(zDataHora.safeParse("2026-07-31T14:05:09").success).toBe(false);
  });

  it("recusa apenas a data", () => {
    expect(zDataHora.safeParse("2026-07-31").success).toBe(false);
  });

  it("aceita o que o Date do JavaScript produz", () => {
    const agora = new Date().toISOString();

    expect(zDataHora.safeParse(agora).success).toBe(true);
  });
});

describe("conversão", () => {
  it("vai e volta sem perder valor", () => {
    for (const valor of [0n, 1n, -1n, 19_90n, 12_345_678_901_234_567_890n]) {
      expect(inteiroDeTexto(textoDeInteiro(valor))).toBe(valor);
    }
  });
});
