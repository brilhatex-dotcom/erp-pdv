import { describe, expect, it } from "vitest";

import { descreverPagamento, FORMAS, rotuloDaForma } from "./formas.js";

describe("formas do balcão", () => {
  it("🔑 a tecla de cada forma é a posição dela", () => {
    expect(FORMAS.map((forma) => [forma.tecla, forma.codigo])).toEqual([
      ["1", "DINHEIRO"],
      ["2", "PIX"],
      ["3", "CARTAO_DEBITO"],
      ["4", "CARTAO_CREDITO"],
      ["5", "CREDIARIO"],
    ]);
  });

  it("rótulo da forma conhecida, e o próprio código da desconhecida", () => {
    expect(rotuloDaForma("CARTAO_DEBITO")).toBe("Débito");
    expect(rotuloDaForma("VALE_REFEICAO")).toBe("VALE_REFEICAO");
  });

  it("🔑 o Pix conferido pelo operador é dito assim — e o de treinamento também", () => {
    expect(descreverPagamento("PIX", "MANUAL")).toBe("Pix (conferido pelo operador)");
    expect(descreverPagamento("PIX", "INTEGRACAO")).toBe("Pix");
    expect(descreverPagamento("DINHEIRO", "SIMULADA")).toBe("Dinheiro (treinamento)");
    expect(descreverPagamento("CARTAO_CREDITO", "MANUAL")).toBe("Crédito");
  });
});
