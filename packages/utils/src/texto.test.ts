import { describe, expect, it } from "vitest";

import {
  apenasAlfanumericos,
  apenasDigitos,
  normalizarParaBusca,
  preencherEsquerda,
  textoOpcional,
} from "./texto.js";

describe("apenasDigitos", () => {
  it("remove máscara de documento", () => {
    expect(apenasDigitos("529.982.247-25")).toBe("52998224725");
  });

  it("remove letras e símbolos", () => {
    expect(apenasDigitos("R$ 1.234,56")).toBe("123456");
  });

  it("devolve vazio quando não há dígito", () => {
    expect(apenasDigitos("abc")).toBe("");
  });
});

describe("apenasAlfanumericos", () => {
  it("mantém letras e dígitos, removendo máscara", () => {
    expect(apenasAlfanumericos("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
  });

  it("converte para maiúsculas", () => {
    expect(apenasAlfanumericos("12abc")).toBe("12ABC");
  });

  it("remove acentos por não serem alfanuméricos ASCII", () => {
    expect(apenasAlfanumericos("AÇÃO")).toBe("AO");
  });
});

describe("normalizarParaBusca", () => {
  it("remove acentos, para o operador achar sem digitá-los", () => {
    expect(normalizarParaBusca("Açúcar Refinado")).toBe("acucar refinado");
  });

  it("colapsa espaços repetidos", () => {
    expect(normalizarParaBusca("Coca   Cola")).toBe("coca cola");
  });

  it("remove espaços das pontas", () => {
    expect(normalizarParaBusca("  pão  ")).toBe("pao");
  });

  it("trata cedilha e til", () => {
    expect(normalizarParaBusca("FEIJÃO MANTEIGA")).toBe("feijao manteiga");
  });

  it("mantém dígitos e símbolos relevantes", () => {
    expect(normalizarParaBusca("Cimento 50KG")).toBe("cimento 50kg");
  });
});

describe("preencherEsquerda", () => {
  it("completa até o tamanho pedido", () => {
    expect(preencherEsquerda("7", 3, "0")).toBe("007");
  });

  it("não altera quando já tem o tamanho", () => {
    expect(preencherEsquerda("123", 3, "0")).toBe("123");
  });

  it("não trunca quando é maior que o tamanho", () => {
    expect(preencherEsquerda("12345", 3, "0")).toBe("12345");
  });
});

describe("textoOpcional", () => {
  it("devolve o texto sem espaço em volta", () => {
    expect(textoOpcional("  Dona Maria  ")).toBe("Dona Maria");
  });

  it("trata ausente como não informado", () => {
    expect(textoOpcional(undefined)).toBeUndefined();
  });

  it("🔑 trata vazio e só-espaço como não informado", () => {
    // O formulário envia `""` para campo em branco; gravar string vazia faria
    // `WHERE apelido IS NULL` deixar de encontrar quem não tem apelido.
    expect(textoOpcional("")).toBeUndefined();
    expect(textoOpcional("   ")).toBeUndefined();
  });
});
