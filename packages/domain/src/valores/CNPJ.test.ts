import { describe, expect, it } from "vitest";

import { CNPJ } from "./CNPJ.js";

describe("CNPJ", () => {
  describe("formato numérico (legado)", () => {
    it("aceita com máscara", () => {
      expect(CNPJ.criar("11.222.333/0001-81").unwrap().caracteres).toBe("11222333000181");
    });

    it("aceita sem máscara", () => {
      expect(CNPJ.criar("11222333000181").unwrap().caracteres).toBe("11222333000181");
    });

    it("não é marcado como alfanumérico", () => {
      expect(CNPJ.criar("11222333000181").unwrap().ehAlfanumerico).toBe(false);
    });
  });

  describe("formato alfanumérico (2026)", () => {
    it("aceita CNPJ alfanumérico, emitido a partir de 2026", () => {
      expect(CNPJ.criar("12ABC34501DE35").unwrap().caracteres).toBe("12ABC34501DE35");
    });

    it("aceita com máscara", () => {
      expect(CNPJ.criar("12.ABC.345/01DE-35").unwrap().caracteres).toBe("12ABC34501DE35");
    });

    it("normaliza minúsculas", () => {
      expect(CNPJ.criar("12abc34501de35").unwrap().caracteres).toBe("12ABC34501DE35");
    });

    it("é marcado como alfanumérico", () => {
      expect(CNPJ.criar("12ABC34501DE35").unwrap().ehAlfanumerico).toBe(true);
    });

    it("rejeita dígito verificador errado", () => {
      expect(CNPJ.criar("12ABC34501DE36").isErr()).toBe(true);
    });
  });

  describe("validação", () => {
    it("rejeita CNPJ vazio", () => {
      const resultado = CNPJ.criar("");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CNPJ_VAZIO");
      }
    });

    it("rejeita quantidade errada de caracteres", () => {
      const resultado = CNPJ.criar("1122233300018");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CNPJ_TAMANHO_INVALIDO");
      }
    });

    it("rejeita dígito verificador errado", () => {
      const resultado = CNPJ.criar("11.222.333/0001-82");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CNPJ_INVALIDO");
      }
    });

    it("usa mensagem compreensível por leigo", () => {
      const resultado = CNPJ.criar("11.222.333/0001-82");

      if (resultado.isErr()) {
        expect(resultado.error.mensagem).toBe("CNPJ inválido. Confira os caracteres.");
      }
    });
  });

  describe("estrutura", () => {
    it("extrai a raiz, que identifica a empresa", () => {
      expect(CNPJ.criar("11222333000181").unwrap().raiz).toBe("11222333");
    });

    it("extrai a ordem do estabelecimento", () => {
      expect(CNPJ.criar("11222333000181").unwrap().ordem).toBe("0001");
    });

    it("identifica a matriz pela ordem 0001", () => {
      expect(CNPJ.criar("11222333000181").unwrap().ehMatriz).toBe(true);
    });

    it("identifica filial", () => {
      // Mesma raiz, ordem 0002 — filial.
      const filial = CNPJ.criar("11222333000262").unwrap();

      expect(filial.ehMatriz).toBe(false);
      expect(filial.ordem).toBe("0002");
    });
  });

  describe("apresentação", () => {
    it("formata no padrão brasileiro", () => {
      expect(CNPJ.criar("11222333000181").unwrap().formatar()).toBe("11.222.333/0001-81");
    });

    it("formata alfanumérico com a mesma máscara", () => {
      expect(CNPJ.criar("12ABC34501DE35").unwrap().formatar()).toBe("12.ABC.345/01DE-35");
    });

    it("usa a formatação no toString", () => {
      expect(String(CNPJ.criar("11222333000181").unwrap())).toBe("11.222.333/0001-81");
    });

    it("serializa sem máscara, formato do XML fiscal", () => {
      expect(JSON.stringify({ cnpj: CNPJ.criar("11222333000181").unwrap() })).toBe(
        '{"cnpj":"11222333000181"}',
      );
    });
  });

  it("compara por igualdade estrutural", () => {
    const a = CNPJ.criar("11.222.333/0001-81").unwrap();
    const b = CNPJ.criar("11222333000181").unwrap();

    expect(a.equals(b)).toBe(true);
  });
});
