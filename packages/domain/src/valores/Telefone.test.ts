import { describe, expect, it } from "vitest";

import { Telefone } from "./Telefone.js";

describe("Telefone", () => {
  it("aceita celular com máscara e guarda só os dígitos", () => {
    const telefone = Telefone.criar("(11) 98888-7777").unwrap();

    expect(telefone.digitos).toBe("11988887777");
    expect(telefone.ehCelular).toBe(true);
    expect(telefone.ddd).toBe("11");
  });

  it("aceita telefone fixo", () => {
    const telefone = Telefone.criar("1138887777").unwrap();

    expect(telefone.ehCelular).toBe(false);
  });

  it("rejeita telefone vazio", () => {
    const resultado = Telefone.criar("");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("TELEFONE_VAZIO");
    }
  });

  it("🔑 rejeita número sem DDD — não serve para ligar de outra cidade", () => {
    const resultado = Telefone.criar("98888-7777");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("TELEFONE_TAMANHO_INVALIDO");
      expect(resultado.error.detalhes?.["quantidadeInformada"]).toBe(9);
    }
  });

  it("rejeita número longo demais", () => {
    expect(Telefone.criar("119888877771").isErr()).toBe(true);
  });

  it("rejeita DDD inexistente", () => {
    const resultado = Telefone.criar("0188887777");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("TELEFONE_DDD_INVALIDO");
      expect(resultado.error.detalhes?.["ddd"]).toBe(1);
    }
  });

  it("formata celular e fixo de formas diferentes", () => {
    expect(Telefone.criar("11988887777").unwrap().formatar()).toBe("(11) 98888-7777");
    expect(Telefone.criar("1138887777").unwrap().toString()).toBe("(11) 3888-7777");
  });

  it("🔑 compara ignorando a máscara — senão o mesmo cliente entra duas vezes", () => {
    const comMascara = Telefone.criar("(11) 98888-7777").unwrap();
    const semMascara = Telefone.criar("11988887777").unwrap();

    expect(comMascara.equals(semMascara)).toBe(true);
    expect(comMascara.equals(Telefone.criar("11988887778").unwrap())).toBe(false);
  });

  it("serializa só com dígitos — é o formato do campo `fone` da NF-e", () => {
    expect(JSON.stringify(Telefone.criar("(11) 98888-7777").unwrap())).toBe(
      '"11988887777"',
    );
  });
});
