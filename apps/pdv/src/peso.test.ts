import { describe, expect, it } from "vitest";

import { pesoNoFio, previaDoPeso } from "./peso.js";

/**
 * O peso digitado à mão, e a prévia da conta antes de confirmar.
 *
 * A prévia usa a mesma aritmética do domínio, e é por isso que o número que o
 * operador mostra ao cliente é o mesmo que o servidor cobra.
 */

describe("pesoNoFio", () => {
  it("🔑 gramas viram milésimos de grama, e o servidor converte para o quilo", () => {
    expect(pesoNoFio("350", "G")).toEqual({ milesimos: "350000", unidade: "G" });
  });

  it("quilos com vírgula viram milésimos de quilo", () => {
    expect(pesoNoFio("0,350", "KG")).toEqual({ milesimos: "350", unidade: "KG" });
    expect(pesoNoFio("1,5", "KG")).toEqual({ milesimos: "1500", unidade: "KG" });
  });

  it.each([
    ["", "G"],
    ["0", "G"],
    ["3,5", "G"],
    ["1234567", "G"],
    ["", "KG"],
    ["abc", "KG"],
  ] as const)("%s em %s não é peso", (texto, unidade) => {
    expect(pesoNoFio(texto, unidade)).toBeUndefined();
  });
});

describe("previaDoPeso", () => {
  it("🔑 exemplo: R$ 20,00/kg × 350 g = R$ 7,00", () => {
    expect(previaDoPeso("2000", { milesimos: "350000", unidade: "G" })).toBe("700");
    expect(previaDoPeso("2000", { milesimos: "350", unidade: "KG" })).toBe("700");
  });

  it("arredonda meio-para-cima, como o domínio", () => {
    // R$ 9,99 × 0,333 kg = R$ 3,32667 → R$ 3,33.
    expect(previaDoPeso("999", { milesimos: "333", unidade: "KG" })).toBe("333");
    // R$ 0,01 × 0,500 kg = R$ 0,005 → R$ 0,01.
    expect(previaDoPeso("1", { milesimos: "500", unidade: "KG" })).toBe("1");
  });
});
