import { describe, expect, it } from "vitest";

import { Matricula } from "./Matricula.js";

describe("Matricula.criar", () => {
  it("aceita dígitos", () => {
    expect(Matricula.criar("42").unwrap().valor).toBe("42");
  });

  it("remove espaço em volta", () => {
    expect(Matricula.criar("  7 ").unwrap().valor).toBe("7");
  });

  it("trata 007 e 7 como a mesma matrícula", () => {
    // Sem isso, o gerente cadastra `07`, o operador digita `7`, o login falha e
    // ninguém entende por quê.
    expect(Matricula.criar("007").unwrap().equals(Matricula.criar("7").unwrap())).toBe(
      true,
    );
  });

  it("preserva a matrícula zero", () => {
    // `000` normalizado sem cuidado viraria texto vazio.
    expect(Matricula.criar("000").unwrap().valor).toBe("0");
  });

  it("recusa vazio", () => {
    const resultado = Matricula.criar("   ");

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("MATRICULA_VAZIA");
  });

  it("recusa letras, para não tirar a mão do teclado numérico", () => {
    for (const invalida of ["ana", "7a", "a7", "7-1", "7 1"]) {
      const resultado = Matricula.criar(invalida);

      expect(resultado.isErr()).toBe(true);
      expect(resultado.isErr() && resultado.error.codigo).toBe(
        "MATRICULA_FORMATO_INVALIDO",
      );
    }
  });

  it("recusa mais de oito dígitos", () => {
    const resultado = Matricula.criar("123456789");

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("MATRICULA_MUITO_LONGA");
  });

  it("aceita exatamente oito dígitos", () => {
    expect(Matricula.criar("12345678").unwrap().valor).toBe("12345678");
  });

  it("distingue matrículas diferentes", () => {
    expect(Matricula.criar("7").unwrap().equals(Matricula.criar("8").unwrap())).toBe(
      false,
    );
  });

  it("é legível como texto", () => {
    expect(String(Matricula.criar("42").unwrap())).toBe("42");
  });
});
