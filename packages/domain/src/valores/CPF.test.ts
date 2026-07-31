import { describe, expect, it } from "vitest";

import { CPF } from "./CPF.js";

describe("CPF", () => {
  it("aceita CPF válido com máscara", () => {
    const cpf = CPF.criar("529.982.247-25").unwrap();

    expect(cpf.digitos).toBe("52998224725");
  });

  it("aceita CPF válido sem máscara", () => {
    expect(CPF.criar("52998224725").unwrap().digitos).toBe("52998224725");
  });

  it("rejeita CPF vazio", () => {
    const resultado = CPF.criar("");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CPF_VAZIO");
    }
  });

  it("rejeita CPF com quantidade errada de dígitos", () => {
    const resultado = CPF.criar("123456789");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CPF_TAMANHO_INVALIDO");
      expect(resultado.error.detalhes?.["quantidadeInformada"]).toBe(9);
    }
  });

  it("rejeita CPF com dígito verificador errado", () => {
    const resultado = CPF.criar("529.982.247-26");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CPF_INVALIDO");
    }
  });

  it("usa mensagem compreensível por leigo, nunca jargão técnico", () => {
    const resultado = CPF.criar("529.982.247-26");

    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("CPF inválido. Confira os números.");
    }
  });

  it("compara por igualdade estrutural, ignorando a máscara de origem", () => {
    const comMascara = CPF.criar("529.982.247-25").unwrap();
    const semMascara = CPF.criar("52998224725").unwrap();

    expect(comMascara.equals(semMascara)).toBe(true);
  });

  it("diferencia CPFs distintos", () => {
    const a = CPF.criar("529.982.247-25").unwrap();
    const b = CPF.criar("111.444.777-35").unwrap();

    expect(a.equals(b)).toBe(false);
  });

  it("formata no padrão brasileiro", () => {
    expect(CPF.criar("52998224725").unwrap().formatar()).toBe("529.982.247-25");
  });

  it("mascara para exibição em tela visível no balcão", () => {
    expect(CPF.criar("52998224725").unwrap().formatarMascarado()).toBe("529.***.**7-25");
  });

  it("usa a formatação completa no toString", () => {
    expect(String(CPF.criar("52998224725").unwrap())).toBe("529.982.247-25");
  });

  it("serializa apenas os dígitos, que é o formato do XML fiscal", () => {
    expect(JSON.stringify({ cpf: CPF.criar("52998224725").unwrap() })).toBe(
      '{"cpf":"52998224725"}',
    );
  });
});
