import { describe, expect, it } from "vitest";

import { centavosDoTexto } from "./CampoDinheiro.js";
import { formatarPercentual } from "./ModalDesconto.js";
import { horaDe } from "./ModalGuardadas.js";

describe("centavosDoTexto", () => {
  it.each([
    ["R$ 0,002", "2"],
    ["R$ 0,020", "20"],
    ["R$ 2,000", "2000"],
    ["R$ 20,000", "20000"],
    ["", "0"],
    ["R$ 0,0", "0"],
    ["abc", "0"],
    ["123456789012345", "12345678901"],
  ])("%s → %s centavos", (texto, esperado) => {
    expect(centavosDoTexto(texto)).toBe(esperado);
  });
});

describe("formatarPercentual", () => {
  it.each([
    [500, "5%"],
    [1050, "10,5%"],
    [250, "2,5%"],
    [1234, "12,34%"],
    [10_000, "100%"],
    [5, "0,05%"],
  ])("%d pontos-base → %s", (bps, esperado) => {
    expect(formatarPercentual(bps)).toBe(esperado);
  });
});

describe("horaDe", () => {
  it("hora e minuto, no fuso da estação", () => {
    expect(horaDe("2026-10-17T13:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
