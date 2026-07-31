import { describe, expect, it } from "vitest";

import {
  ehCodigoDeBalanca,
  interpretarCodigoBalanca,
  LAYOUT_BALANCA_PADRAO,
  type LayoutBalanca,
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
