import { describe, expect, it } from "vitest";

import { Quantidade } from "../valores/Quantidade.js";
import { CodigoBarras } from "./CodigoBarras.js";
import { Embalagem } from "./Embalagem.js";

function qtd(valor: string, unidade: "UN" | "CX" | "FD" | "KG"): Quantidade {
  return Quantidade.de(valor, unidade).unwrap();
}

describe("Embalagem — criação", () => {
  it("cria embalagem com fator válido", () => {
    const fardo = Embalagem.criar("FD", 12n).unwrap();

    expect(fardo.unidade.codigo).toBe("FD");
    expect(fardo.fator).toBe(12n);
  });

  it("aceita código de barras próprio da embalagem — o DUN-14 da caixa", () => {
    const dun = CodigoBarras.criar("17891000315504").unwrap();

    const caixa = Embalagem.criar("CX", 24n, dun).unwrap();

    expect(caixa.codigoBarras?.valor).toBe("17891000315504");
    expect(caixa.codigoBarras?.ehEmbalagem).toBe(true);
  });

  it("permite embalagem sem código de barras", () => {
    expect(Embalagem.criar("FD", 12n).unwrap().codigoBarras).toBeUndefined();
  });

  it("rejeita fator zero", () => {
    const resultado = Embalagem.criar("FD", 0n);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMBALAGEM_FATOR_INVALIDO");
    }
  });

  it("rejeita fator negativo", () => {
    const resultado = Embalagem.criar("FD", -5n);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMBALAGEM_FATOR_INVALIDO");
    }
  });

  it("rejeita fator 1, que é a própria unidade do produto", () => {
    const resultado = Embalagem.criar("FD", 1n);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMBALAGEM_FATOR_UNITARIO");
    }
  });

  it("usa mensagem compreensível por leigo", () => {
    const resultado = Embalagem.criar("FD", 0n);

    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe(
        "A quantidade por embalagem deve ser maior que zero.",
      );
    }
  });
});

describe("Embalagem — conversão", () => {
  const fardo = Embalagem.criar("FD", 12n).unwrap();

  it("converte fardos em unidades", () => {
    const emUnidades = fardo.converterParaBase(qtd("3", "FD"), "UN").unwrap();

    expect(emUnidades.milesimos).toBe(36000n);
    expect(emUnidades.unidade.codigo).toBe("UN");
  });

  it("converte um único fardo", () => {
    expect(fardo.converterParaBase(qtd("1", "FD"), "UN").unwrap().milesimos).toBe(12000n);
  });

  it("converte zero", () => {
    expect(fardo.converterParaBase(qtd("0", "FD"), "UN").unwrap().ehZero()).toBe(true);
  });

  it("recusa quantidade em unidade diferente da embalagem", () => {
    const resultado = fardo.converterParaBase(qtd("3", "CX"), "UN");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMBALAGEM_UNIDADE_INCOMPATIVEL");
      expect(resultado.error.detalhes?.["esperada"]).toBe("FD");
      expect(resultado.error.detalhes?.["recebida"]).toBe("CX");
    }
  });

  it("propaga erro quando a conversão gera fração em unidade não fracionável", () => {
    // 0,5 kg × fator 3 = 1,5 unidades — e "1,5 unidade" não existe.
    const porPeso = Embalagem.criar("KG", 3n).unwrap();

    expect(porPeso.converterParaBase(qtd("0,5", "KG"), "UN").isErr()).toBe(true);
  });

  it("aceita conversão de peso quando o resultado é inteiro", () => {
    // 0,5 kg × fator 2 = exatamente 1 unidade.
    const porPeso = Embalagem.criar("KG", 2n).unwrap();

    expect(porPeso.converterParaBase(qtd("0,5", "KG"), "UN").unwrap().milesimos).toBe(
      1000n,
    );
  });
});

describe("Embalagem — comparação e apresentação", () => {
  it("considera iguais embalagens da mesma unidade, mesmo com fator diferente", () => {
    // Um produto não pode ter duas embalagens em fardo com fatores distintos.
    const doze = Embalagem.criar("FD", 12n).unwrap();
    const seis = Embalagem.criar("FD", 6n).unwrap();

    expect(doze.equals(seis)).toBe(true);
  });

  it("diferencia embalagens de unidades distintas", () => {
    const fardo = Embalagem.criar("FD", 12n).unwrap();
    const caixa = Embalagem.criar("CX", 12n).unwrap();

    expect(fardo.equals(caixa)).toBe(false);
  });

  it("descreve unidade e fator no toString", () => {
    expect(String(Embalagem.criar("FD", 12n).unwrap())).toBe("fd × 12");
  });

  it("serializa unidade, fator e código de barras", () => {
    const dun = CodigoBarras.criar("17891000315504").unwrap();

    expect(Embalagem.criar("CX", 24n, dun).unwrap().toJSON()).toEqual({
      unidade: "CX",
      fator: "24",
      codigoBarras: "17891000315504",
    });
  });

  it("serializa código de barras nulo quando não há", () => {
    expect(Embalagem.criar("FD", 12n).unwrap().toJSON().codigoBarras).toBeNull();
  });
});
