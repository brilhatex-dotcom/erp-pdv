import { describe, expect, it } from "vitest";

import { type DadosEndereco, Endereco } from "./Endereco.js";

const COMPLETO: DadosEndereco = {
  logradouro: "Avenida Paulista",
  numero: "1578",
  bairro: "Bela Vista",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01310-200",
};

function codigosDeErro(dados: DadosEndereco): string[] {
  const resultado = Endereco.criar(dados);

  return resultado.isErr() ? resultado.error.map((erro) => erro.codigo) : [];
}

describe("Endereco", () => {
  it("aceita um endereço completo", () => {
    const endereco = Endereco.criar(COMPLETO).unwrap();

    expect(endereco.logradouro).toBe("Avenida Paulista");
    expect(endereco.numero).toBe("1578");
    expect(endereco.bairro).toBe("Bela Vista");
    expect(endereco.municipio).toBe("São Paulo");
    expect(endereco.uf).toBe("SP");
    expect(endereco.cep).toBe("01310200");
    expect(endereco.complemento).toBeUndefined();
    expect(endereco.codigoMunicipioIbge).toBeUndefined();
  });

  it("aceita UF em minúscula, normalizando para maiúscula", () => {
    expect(Endereco.criar({ ...COMPLETO, uf: "sp" }).unwrap().uf).toBe("SP");
  });

  it("guarda o CEP só com dígitos e formata na exibição", () => {
    const endereco = Endereco.criar(COMPLETO).unwrap();

    expect(endereco.cep).toBe("01310200");
    expect(endereco.cepFormatado()).toBe("01310-200");
  });

  it("guarda o código do município do IBGE, que a NF-e exige", () => {
    const endereco = Endereco.criar({
      ...COMPLETO,
      codigoMunicipioIbge: "3550308",
    }).unwrap();

    expect(endereco.codigoMunicipioIbge).toBe("3550308");
  });

  it("trata complemento e código do município vazios como não informados", () => {
    const endereco = Endereco.criar({
      ...COMPLETO,
      complemento: "   ",
      codigoMunicipioIbge: "",
    }).unwrap();

    expect(endereco.complemento).toBeUndefined();
    expect(endereco.codigoMunicipioIbge).toBeUndefined();
  });

  it("preserva o complemento informado", () => {
    const endereco = Endereco.criar({ ...COMPLETO, complemento: "Sala 12" }).unwrap();

    expect(endereco.complemento).toBe("Sala 12");
  });

  it("exige a rua", () => {
    expect(codigosDeErro({ ...COMPLETO, logradouro: " " })).toContain(
      "ENDERECO_LOGRADOURO_VAZIO",
    );
  });

  it("exige o número e ensina a usar S/N", () => {
    const resultado = Endereco.criar({ ...COMPLETO, numero: "" });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("ENDERECO_NUMERO_VAZIO");
      expect(resultado.error[0]?.mensagem).toContain("S/N");
    }
  });

  it("aceita S/N como número", () => {
    expect(Endereco.criar({ ...COMPLETO, numero: "S/N" }).unwrap().numero).toBe("S/N");
  });

  it("exige bairro e cidade", () => {
    const codigos = codigosDeErro({ ...COMPLETO, bairro: "", municipio: "" });

    expect(codigos).toContain("ENDERECO_BAIRRO_VAZIO");
    expect(codigos).toContain("ENDERECO_MUNICIPIO_VAZIO");
  });

  it("recusa UF desconhecida", () => {
    expect(codigosDeErro({ ...COMPLETO, uf: "XX" })).toContain("ENDERECO_UF_INVALIDA");
  });

  it("recusa CEP com quantidade errada de dígitos", () => {
    expect(codigosDeErro({ ...COMPLETO, cep: "0131020" })).toContain(
      "ENDERECO_CEP_INVALIDO",
    );
  });

  it("recusa código de município fora dos 7 dígitos do IBGE", () => {
    expect(codigosDeErro({ ...COMPLETO, codigoMunicipioIbge: "355030" })).toContain(
      "ENDERECO_MUNICIPIO_IBGE_INVALIDO",
    );
  });

  it("🔑 recusa texto acima do limite do layout da NF-e", () => {
    // Passa no formulário, grava no banco e é rejeitado na emissão — quando
    // já não dá para corrigir sem refazer a venda.
    const longo = "x".repeat(61);
    const codigos = codigosDeErro({
      ...COMPLETO,
      logradouro: longo,
      bairro: longo,
      municipio: longo,
      complemento: longo,
      numero: longo,
    });

    expect(codigos).toContain("ENDERECO_LOGRADOURO_LONGO");
    expect(codigos).toContain("ENDERECO_BAIRRO_LONGO");
    expect(codigos).toContain("ENDERECO_MUNICIPIO_LONGO");
    expect(codigos).toContain("ENDERECO_COMPLEMENTO_LONGO");
    expect(codigos).toContain("ENDERECO_NUMERO_LONGO");
  });

  it("🔑 devolve todos os erros de uma vez, não um por gravação", () => {
    const resultado = Endereco.criar({
      logradouro: "",
      numero: "",
      bairro: "",
      municipio: "",
      uf: "ZZ",
      cep: "1",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.length).toBe(6);
    }
  });

  it("compara pelo conteúdo, ignorando a máscara do CEP", () => {
    const a = Endereco.criar(COMPLETO).unwrap();
    const b = Endereco.criar({ ...COMPLETO, cep: "01310200" }).unwrap();
    const outro = Endereco.criar({ ...COMPLETO, numero: "1000" }).unwrap();

    expect(a.equals(b)).toBe(true);
    expect(a.equals(outro)).toBe(false);
  });

  it("escreve o endereço como se fosse num envelope", () => {
    const endereco = Endereco.criar({ ...COMPLETO, complemento: "Sala 12" }).unwrap();

    expect(endereco.toString()).toBe(
      "Avenida Paulista, 1578 Sala 12 — Bela Vista, São Paulo/SP — 01310-200",
    );
  });

  it("omite o complemento na linha única quando não há", () => {
    expect(Endereco.criar(COMPLETO).unwrap().linhaUnica()).toBe(
      "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — 01310-200",
    );
  });
});
