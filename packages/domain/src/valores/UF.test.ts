import { describe, expect, it } from "vitest";

import { ehSiglaUF, obterUF, UFS } from "./UF.js";

describe("UF", () => {
  it("cobre as 27 unidades da federação", () => {
    expect(Object.keys(UFS)).toHaveLength(27);
  });

  it("reconhece sigla válida", () => {
    expect(ehSiglaUF("SP")).toBe(true);
  });

  it("recusa sigla desconhecida", () => {
    expect(ehSiglaUF("XX")).toBe(false);
  });

  it("recusa sigla em minúscula — o formato gravado é maiúsculo", () => {
    expect(ehSiglaUF("sp")).toBe(false);
  });

  it("devolve o código do IBGE, que é o `cUF` do XML fiscal", () => {
    expect(obterUF("SP").codigoIbge).toBe(35);
    expect(obterUF("MG").codigoIbge).toBe(31);
    expect(obterUF("DF").codigoIbge).toBe(53);
  });

  it("não repete código do IBGE entre estados", () => {
    const codigos = Object.values(UFS).map((uf) => uf.codigoIbge);

    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("mantém a sigla da chave igual à do valor", () => {
    for (const [chave, uf] of Object.entries(UFS)) {
      expect(uf.sigla).toBe(chave);
    }
  });
});
