import { describe, expect, it } from "vitest";

import { InscricaoEstadual } from "./InscricaoEstadual.js";

describe("InscricaoEstadual", () => {
  it("aceita inscrição numérica, guardando só os dígitos", () => {
    const inscricao = InscricaoEstadual.criar("110.042.490.114").unwrap();

    expect(inscricao.valor).toBe("110042490114");
    expect(inscricao.ehIsento).toBe(false);
  });

  it("🔑 aceita ISENTO, que é o caso comum de MEI e produtor rural", () => {
    const inscricao = InscricaoEstadual.criar("isento").unwrap();

    expect(inscricao.valor).toBe("ISENTO");
    expect(inscricao.ehIsento).toBe(true);
  });

  it("constrói o isento diretamente", () => {
    expect(InscricaoEstadual.isento().ehIsento).toBe(true);
  });

  it("rejeita valor vazio e sugere a saída", () => {
    const resultado = InscricaoEstadual.criar("");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("INSCRICAO_ESTADUAL_VAZIA");
      expect(resultado.error.mensagem).toContain("isento");
    }
  });

  it("rejeita inscrição curta demais", () => {
    const resultado = InscricaoEstadual.criar("7");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("INSCRICAO_ESTADUAL_INVALIDA");
      expect(resultado.error.detalhes?.["quantidadeInformada"]).toBe(1);
    }
  });

  it("rejeita inscrição longa demais", () => {
    expect(InscricaoEstadual.criar("1".repeat(15)).isErr()).toBe(true);
  });

  it("rejeita texto que não é número nem ISENTO", () => {
    const resultado = InscricaoEstadual.criar("NAO TENHO");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("INSCRICAO_ESTADUAL_INVALIDA");
    }
  });

  it("compara pelo valor normalizado", () => {
    const comMascara = InscricaoEstadual.criar("110.042.490.114").unwrap();
    const semMascara = InscricaoEstadual.criar("110042490114").unwrap();

    expect(comMascara.equals(semMascara)).toBe(true);
    expect(comMascara.equals(InscricaoEstadual.isento())).toBe(false);
  });

  it("serializa como texto simples", () => {
    const inscricao = InscricaoEstadual.isento();

    expect(inscricao.toString()).toBe("ISENTO");
    expect(JSON.stringify(inscricao)).toBe('"ISENTO"');
  });
});
