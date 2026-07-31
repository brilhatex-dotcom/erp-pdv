import { describe, expect, it } from "vitest";

import { CNPJ } from "./CNPJ.js";
import { CPF } from "./CPF.js";
import { Documento } from "./Documento.js";

const CPF_VALIDO = "529.982.247-25";
const CNPJ_VALIDO = "11.222.333/0001-81";

describe("Documento", () => {
  it("interpreta 11 caracteres como CPF", () => {
    const documento = Documento.criar(CPF_VALIDO).unwrap();

    expect(documento.tipo).toBe("CPF");
    expect(documento.ehPessoaFisica).toBe(true);
    expect(documento.ehPessoaJuridica).toBe(false);
    expect(documento.valor).toBe("52998224725");
  });

  it("interpreta 14 caracteres como CNPJ", () => {
    const documento = Documento.criar(CNPJ_VALIDO).unwrap();

    expect(documento.tipo).toBe("CNPJ");
    expect(documento.ehPessoaJuridica).toBe(true);
    expect(documento.ehPessoaFisica).toBe(false);
    expect(documento.valor).toBe("11222333000181");
  });

  it("rejeita documento vazio", () => {
    const resultado = Documento.criar("   ");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DOCUMENTO_VAZIO");
    }
  });

  it("rejeita tamanho que não é nem CPF nem CNPJ, e diz os dois formatos", () => {
    const resultado = Documento.criar("123456");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DOCUMENTO_TAMANHO_INVALIDO");
      expect(resultado.error.detalhes?.["quantidadeInformada"]).toBe(6);
      expect(resultado.error.mensagem).toContain("CPF");
      expect(resultado.error.mensagem).toContain("CNPJ");
    }
  });

  it("propaga o erro do CPF em vez de inventar um próprio", () => {
    const resultado = Documento.criar("529.982.247-26");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CPF_INVALIDO");
    }
  });

  it("propaga o erro do CNPJ em vez de inventar um próprio", () => {
    const resultado = Documento.criar("11.222.333/0001-82");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CNPJ_INVALIDO");
    }
  });

  it("aceita o CNPJ alfanumérico emitido a partir de 2026", () => {
    const alfanumerico = CNPJ.criar("12ABC34501DE35").unwrap();
    const documento = Documento.deCnpj(alfanumerico);

    expect(documento.tipo).toBe("CNPJ");
    expect(documento.valor).toBe("12ABC34501DE35");
  });

  it("constrói a partir de um CPF já validado", () => {
    const documento = Documento.deCpf(CPF.criar(CPF_VALIDO).unwrap());

    expect(documento.valor).toBe("52998224725");
  });

  it("compara por tipo e valor", () => {
    const comMascara = Documento.criar(CPF_VALIDO).unwrap();
    const semMascara = Documento.criar("52998224725").unwrap();
    const outro = Documento.criar(CNPJ_VALIDO).unwrap();

    expect(comMascara.equals(semMascara)).toBe(true);
    expect(comMascara.equals(outro)).toBe(false);
  });

  it("formata conforme o tipo", () => {
    expect(Documento.criar(CPF_VALIDO).unwrap().formatar()).toBe("529.982.247-25");
    expect(Documento.criar(CNPJ_VALIDO).unwrap().toString()).toBe("11.222.333/0001-81");
  });

  it("🔑 mascara o CPF na listagem, mas não o CNPJ", () => {
    // CPF é dado pessoal e a tela fica visível no balcão; CNPJ é público, e
    // esconder metade dele atrapalharia quem confere uma nota de entrada.
    expect(Documento.criar(CPF_VALIDO).unwrap().formatarParaListagem()).toBe(
      "529.***.**7-25",
    );
    expect(Documento.criar(CNPJ_VALIDO).unwrap().formatarParaListagem()).toBe(
      "11.222.333/0001-81",
    );
  });

  it("serializa sem máscara — é o formato do XML fiscal", () => {
    expect(JSON.stringify(Documento.criar(CPF_VALIDO).unwrap())).toBe('"52998224725"');
  });
});
