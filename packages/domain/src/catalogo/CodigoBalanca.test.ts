import { describe, expect, it } from "vitest";

import {
  ehCodigoDeBalanca,
  gerarEtiquetaBalanca,
  interpretarCodigoBalanca,
  LAYOUT_BALANCA_PADRAO,
  type LayoutBalanca,
  validarLayoutBalanca,
} from "./CodigoBalanca.js";

const LAYOUT_PRECO: LayoutBalanca = {
  prefixos: ["2"],
  tamanhoCodigoProduto: 6,
  conteudo: "PRECO",
  casasDecimais: 2,
};

describe("ehCodigoDeBalanca", () => {
  it("reconhece EAN-13 com prefixo de pesável", () => {
    expect(ehCodigoDeBalanca("2012345012509", LAYOUT_BALANCA_PADRAO)).toBe(true);
  });

  it("não confunde produto comum com etiqueta de balança", () => {
    expect(ehCodigoDeBalanca("7891000315507", LAYOUT_BALANCA_PADRAO)).toBe(false);
  });

  it("exige 13 dígitos", () => {
    expect(ehCodigoDeBalanca("2012345", LAYOUT_BALANCA_PADRAO)).toBe(false);
  });

  it("aceita prefixo alternativo configurado na loja", () => {
    const layout: LayoutBalanca = { ...LAYOUT_BALANCA_PADRAO, prefixos: ["20", "21"] };

    expect(ehCodigoDeBalanca("2012345012509", layout)).toBe(true);
  });
});

describe("interpretarCodigoBalanca — peso embutido", () => {
  it("extrai código do produto e peso", () => {
    // 2 · 012345 · 01250 · 9  →  produto 012345, peso 1,250 kg
    const leitura = interpretarCodigoBalanca(
      "2012345012509",
      LAYOUT_BALANCA_PADRAO,
    ).unwrap();

    expect(leitura.codigoProduto).toBe("012345");
    expect(leitura.peso?.milesimos).toBe(1250n);
    expect(leitura.peso?.unidade.codigo).toBe("KG");
    expect(leitura.preco).toBeUndefined();
  });

  it("lê peso abaixo de um quilo sem deslocar a vírgula", () => {
    // O erro clássico aqui é registrar 9,8 kg no lugar de 0,98 kg.
    const leitura = interpretarCodigoBalanca(
      "2012345009806",
      LAYOUT_BALANCA_PADRAO,
    ).unwrap();

    expect(leitura.peso?.formatar()).toBe("0,98 kg");
  });

  it("aceita unidade de peso alternativa", () => {
    const leitura = interpretarCodigoBalanca(
      "2012345012509",
      LAYOUT_BALANCA_PADRAO,
      "G",
    ).unwrap();

    expect(leitura.peso?.unidade.codigo).toBe("G");
  });

  it("respeita layout com código de produto menor", () => {
    const layout: LayoutBalanca = {
      ...LAYOUT_BALANCA_PADRAO,
      tamanhoCodigoProduto: 5,
    };

    const leitura = interpretarCodigoBalanca("2012345012509", layout).unwrap();

    expect(leitura.codigoProduto).toBe("01234");
    expect(leitura.peso?.milesimos).toBe(501250n);
  });

  it("converte quando o layout usa menos casas decimais", () => {
    // Balança configurada em decigramas: 2 casas em vez de 3.
    const layout: LayoutBalanca = { ...LAYOUT_BALANCA_PADRAO, casasDecimais: 2 };

    const leitura = interpretarCodigoBalanca("2012345012509", layout).unwrap();

    expect(leitura.peso?.milesimos).toBe(12500n);
  });
});

describe("interpretarCodigoBalanca — preço embutido", () => {
  it("extrai código do produto e preço total", () => {
    // 2 · 012345 · 01575 · 3  →  produto 012345, R$ 15,75
    const leitura = interpretarCodigoBalanca("2012345015753", LAYOUT_PRECO).unwrap();

    expect(leitura.codigoProduto).toBe("012345");
    expect(leitura.preco?.formatar()).toBe("R$ 15,75");
    expect(leitura.peso).toBeUndefined();
  });

  it("converte quando o layout usa menos casas decimais", () => {
    // Balança que embute reais inteiros.
    const layout: LayoutBalanca = { ...LAYOUT_PRECO, casasDecimais: 0 };

    const leitura = interpretarCodigoBalanca("2012345015753", layout).unwrap();

    expect(leitura.preco?.centavos).toBe(157500n);
  });
});

describe("interpretarCodigoBalanca — recusas", () => {
  it("rejeita tamanho diferente de 13 dígitos", () => {
    const resultado = interpretarCodigoBalanca("20123450125", LAYOUT_BALANCA_PADRAO);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("BALANCA_TAMANHO_INVALIDO");
    }
  });

  it("rejeita prefixo fora do configurado", () => {
    const resultado = interpretarCodigoBalanca("7891000315507", LAYOUT_BALANCA_PADRAO);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("BALANCA_PREFIXO_INVALIDO");
    }
  });

  it("rejeita etiqueta com dígito verificador errado — leitura suja no balcão", () => {
    const resultado = interpretarCodigoBalanca("2012345012500", LAYOUT_BALANCA_PADRAO);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("BALANCA_DIGITO_INVALIDO");
      // Mensagem acionável: o operador sabe o que fazer.
      expect(resultado.error.mensagem).toBe(
        "Não foi possível ler a etiqueta. Passe novamente.",
      );
    }
  });

  it("rejeita layout em que o código do produto não deixa espaço para o valor", () => {
    const layout: LayoutBalanca = {
      ...LAYOUT_BALANCA_PADRAO,
      tamanhoCodigoProduto: 11,
    };

    const resultado = interpretarCodigoBalanca("2012345012509", layout);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("BALANCA_LAYOUT_INVALIDO");
    }
  });

  it("propaga erro de quantidade quando o peso lido é impossível", () => {
    // Layout que joga o valor para uma escala fora do limite de Quantidade.
    const layout: LayoutBalanca = {
      ...LAYOUT_BALANCA_PADRAO,
      tamanhoCodigoProduto: 1,
      casasDecimais: 0,
    };

    const resultado = interpretarCodigoBalanca("2012345012509", layout);

    expect(resultado.isErr()).toBe(true);
  });

  it("lê preço no maior valor que uma etiqueta comporta, sem estourar limite", () => {
    // Dez dígitos de valor é o máximo estrutural de um EAN-13 de balança;
    // mesmo nesse extremo o valor cabe em Dinheiro.
    const layout: LayoutBalanca = {
      prefixos: ["2"],
      tamanhoCodigoProduto: 1,
      conteudo: "PRECO",
      casasDecimais: 0,
    };

    const leitura = interpretarCodigoBalanca("2012345012509", layout).unwrap();

    expect(leitura.preco?.centavos).toBe(123450125000n);
  });
});

describe("validarLayoutBalanca", () => {
  const codigos = (layout: LayoutBalanca): string[] =>
    validarLayoutBalanca(layout).map((erro) => erro.codigo);

  it("aceita o layout mais comum do varejo brasileiro", () => {
    expect(codigos(LAYOUT_BALANCA_PADRAO)).toEqual([]);
    expect(codigos(LAYOUT_PRECO)).toEqual([]);
  });

  it("aceita prefixos 2 e 20 com código de 4 dígitos", () => {
    expect(
      codigos({
        ...LAYOUT_BALANCA_PADRAO,
        prefixos: ["2", "20"],
        tamanhoCodigoProduto: 5,
      }),
    ).toEqual([]);
  });

  it.each([
    ["sem prefixo", { prefixos: [] as string[] }, "BALANCA_PREFIXOS_INVALIDOS"],
    ["prefixo com letra", { prefixos: ["A"] }, "BALANCA_PREFIXO_FORMATO"],
    ["prefixo repetido", { prefixos: ["2", "2"] }, "BALANCA_PREFIXO_REPETIDO"],
    [
      "código de 3 dígitos",
      { tamanhoCodigoProduto: 3 },
      "BALANCA_TAMANHO_CODIGO_INVALIDO",
    ],
    [
      "código de 7 dígitos",
      { tamanhoCodigoProduto: 7 },
      "BALANCA_TAMANHO_CODIGO_INVALIDO",
    ],
    ["peso com 4 casas", { casasDecimais: 4 }, "BALANCA_CASAS_INVALIDAS"],
    ["casas negativas", { casasDecimais: -1 }, "BALANCA_CASAS_INVALIDAS"],
  ])("recusa %s", (_caso, sobrescrita, codigo) => {
    expect(codigos({ ...LAYOUT_BALANCA_PADRAO, ...sobrescrita })).toContain(codigo);
  });

  it("recusa preço com 3 casas: não existe fração de centavo", () => {
    expect(codigos({ ...LAYOUT_PRECO, casasDecimais: 3 })).toContain(
      "BALANCA_CASAS_INVALIDAS",
    );
  });

  it("🔑 recusa combinação que deixa o valor sem espaço", () => {
    // "22" + 6 dígitos de código sobra 4 para o valor: ok. "22" + 6 com mais
    // um prefixo de 2 dígitos e código de 6 também; mas 6 + prefixo 2 com
    // código de 4 deixa 6 — e prefixo 2 com código 6 deixa 4, tudo válido.
    // O que não cabe é código curto com prefixo curto: valor de 7 dígitos.
    expect(
      codigos({ ...LAYOUT_BALANCA_PADRAO, prefixos: ["2"], tamanhoCodigoProduto: 4 }),
    ).toContain("BALANCA_LAYOUT_SEM_ESPACO");
  });
});

describe("gerarEtiquetaBalanca", () => {
  it("🔑 monta a etiqueta que a balança imprimiria, e ela volta igual na leitura", () => {
    const etiqueta = gerarEtiquetaBalanca(LAYOUT_BALANCA_PADRAO, "123", 350n).unwrap();

    expect(etiqueta).toHaveLength(13);
    expect(etiqueta.startsWith("2000123")).toBe(true);

    const leitura = interpretarCodigoBalanca(etiqueta, LAYOUT_BALANCA_PADRAO).unwrap();

    expect(leitura.codigoProduto).toBe("000123");
    expect(leitura.peso?.formatar()).toBe("0,35 kg");
  });

  it("monta etiqueta de preço: R$ 7,00 embutidos", () => {
    const etiqueta = gerarEtiquetaBalanca(LAYOUT_PRECO, "45", 700n).unwrap();

    expect(
      interpretarCodigoBalanca(etiqueta, LAYOUT_PRECO).unwrap().preco?.formatar(),
    ).toBe("R$ 7,00");
  });

  it.each([
    ["código vazio", "", 1n, "BALANCA_CODIGO_NAO_CABE"],
    ["código longo", "1234567", 1n, "BALANCA_CODIGO_NAO_CABE"],
    ["valor que não cabe", "1", 123456n, "BALANCA_VALOR_NAO_CABE"],
    ["valor negativo", "1", -1n, "BALANCA_VALOR_NAO_CABE"],
  ])("recusa %s", (_caso, codigo, valor, esperado) => {
    const resultado = gerarEtiquetaBalanca(LAYOUT_BALANCA_PADRAO, codigo, valor);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe(esperado);
  });

  it("recusa layout sem prefixo", () => {
    const resultado = gerarEtiquetaBalanca(
      { ...LAYOUT_BALANCA_PADRAO, prefixos: [], tamanhoCodigoProduto: 13 },
      "1",
      1n,
    );

    expect(resultado.isErr()).toBe(true);
  });
});
