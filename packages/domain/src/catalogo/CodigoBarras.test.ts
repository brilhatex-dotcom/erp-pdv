import { describe, expect, it } from "vitest";

import { CodigoBarras, temDigitoVerificadorValido } from "./CodigoBarras.js";

describe("CodigoBarras", () => {
  describe("padrões GS1", () => {
    it.each([
      ["7891000315507", "EAN13"],
      ["12345670", "EAN8"],
      ["123456789012", "EAN12"],
      ["17891000315504", "DUN14"],
    ] as const)("reconhece %s como %s", (codigo, padrao) => {
      const resultado = CodigoBarras.criar(codigo);

      expect(resultado.isOk()).toBe(true);
      expect(resultado.unwrap().padrao).toBe(padrao);
    });

    it("aceita código com separadores, como vem de arquivo do fornecedor", () => {
      expect(CodigoBarras.criar("789 1000 315507").unwrap().valor).toBe("7891000315507");
    });

    it("rejeita EAN-13 com dígito verificador errado", () => {
      const resultado = CodigoBarras.criar("7891000315508");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CODIGO_BARRAS_DIGITO_INVALIDO");
      }
    });

    it("rejeita EAN-8 com dígito verificador errado", () => {
      expect(CodigoBarras.criar("12345671").isErr()).toBe(true);
    });

    it("marca DUN-14 como embalagem de transporte, não unidade de venda", () => {
      expect(CodigoBarras.criar("17891000315504").unwrap().ehEmbalagem).toBe(true);
      expect(CodigoBarras.criar("7891000315507").unwrap().ehEmbalagem).toBe(false);
    });
  });

  describe("código interno da loja", () => {
    it("aceita tamanho fora dos padrões GS1, sem exigir verificador", () => {
      const resultado = CodigoBarras.criar("12345");

      expect(resultado.isOk()).toBe(true);
      expect(resultado.unwrap().padrao).toBe("INTERNO");
    });

    it("aceita explicitamente como interno mesmo com tamanho de EAN", () => {
      // Loja que reaproveita 13 dígitos num esquema próprio, sem verificador.
      const resultado = CodigoBarras.criarInterno("7891000315508");

      expect(resultado.isOk()).toBe(true);
      expect(resultado.unwrap().padrao).toBe("INTERNO");
    });

    it("rejeita interno vazio", () => {
      const resultado = CodigoBarras.criarInterno("");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CODIGO_BARRAS_VAZIO");
      }
    });

    it("rejeita interno longo demais", () => {
      const resultado = CodigoBarras.criarInterno("123456789012345");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CODIGO_BARRAS_LONGO");
      }
    });
  });

  describe("validação de entrada", () => {
    it("rejeita vazio", () => {
      const resultado = CodigoBarras.criar("");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CODIGO_BARRAS_VAZIO");
      }
    });

    it("rejeita texto sem dígitos", () => {
      expect(CodigoBarras.criar("abc").isErr()).toBe(true);
    });

    it("rejeita mais de 14 dígitos", () => {
      const resultado = CodigoBarras.criar("123456789012345");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CODIGO_BARRAS_LONGO");
      }
    });

    it("usa mensagem compreensível por leigo", () => {
      const resultado = CodigoBarras.criar("7891000315508");

      if (resultado.isErr()) {
        expect(resultado.error.mensagem).toBe(
          "Código de barras inválido. Confira os números.",
        );
      }
    });
  });

  describe("comparação e apresentação", () => {
    it("compara por igualdade estrutural, ignorando separadores", () => {
      const a = CodigoBarras.criar("789 1000 315507").unwrap();
      const b = CodigoBarras.criar("7891000315507").unwrap();

      expect(a.equals(b)).toBe(true);
    });

    it("diferencia códigos distintos", () => {
      const a = CodigoBarras.criar("7891000315507").unwrap();
      const b = CodigoBarras.criar("12345670").unwrap();

      expect(a.equals(b)).toBe(false);
    });

    it("usa o próprio código no toString", () => {
      expect(String(CodigoBarras.criar("12345670").unwrap())).toBe("12345670");
    });

    it("serializa como texto", () => {
      expect(JSON.stringify({ ean: CodigoBarras.criar("12345670").unwrap() })).toBe(
        '{"ean":"12345670"}',
      );
    });
  });
});

describe("temDigitoVerificadorValido", () => {
  it.each(["7891000315507", "12345670", "123456789012", "17891000315504"])(
    "aceita %s",
    (codigo) => {
      expect(temDigitoVerificadorValido(codigo)).toBe(true);
    },
  );

  it.each(["7891000315508", "12345671", "123456789013"])("rejeita %s", (codigo) => {
    expect(temDigitoVerificadorValido(codigo)).toBe(false);
  });
});
