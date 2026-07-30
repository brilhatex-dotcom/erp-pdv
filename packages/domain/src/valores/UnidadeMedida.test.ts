import { describe, expect, it } from "vitest";

import { ehCodigoUnidade, obterUnidade, UNIDADES } from "./UnidadeMedida.js";

describe("UnidadeMedida", () => {
  it("marca como fracionáveis as unidades de peso, volume e comprimento", () => {
    expect(UNIDADES.KG.fracionavel).toBe(true);
    expect(UNIDADES.L.fracionavel).toBe(true);
    expect(UNIDADES.M.fracionavel).toBe(true);
    expect(UNIDADES.M2.fracionavel).toBe(true);
  });

  it("marca como não fracionáveis as unidades de contagem e embalagem", () => {
    expect(UNIDADES.UN.fracionavel).toBe(false);
    expect(UNIDADES.CX.fracionavel).toBe(false);
    expect(UNIDADES.FD.fracionavel).toBe(false);
    expect(UNIDADES.DZ.fracionavel).toBe(false);
  });

  it("mantém o código dentro do limite de 6 caracteres do campo uCom da NF-e", () => {
    for (const unidade of Object.values(UNIDADES)) {
      expect(unidade.codigo.length).toBeLessThanOrEqual(6);
    }
  });

  it("usa o próprio código como chave do registro", () => {
    for (const [chave, unidade] of Object.entries(UNIDADES)) {
      expect(unidade.codigo).toBe(chave);
    }
  });

  it("reconhece código válido", () => {
    expect(ehCodigoUnidade("KG")).toBe(true);
  });

  it("rejeita código desconhecido", () => {
    expect(ehCodigoUnidade("XYZ")).toBe(false);
  });

  it("obtém a unidade pelo código", () => {
    expect(obterUnidade("KG").descricao).toBe("Quilograma");
  });
});
