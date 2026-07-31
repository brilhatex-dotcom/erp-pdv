import { describe, expect, it } from "vitest";

import {
  CABECALHO_CORRELACAO,
  CODIGO_ERRO_INTERNO,
  TIPOS_ERRO,
  zRespostaErro,
  zTipoErroApi,
} from "./erro.js";

const VALIDO = {
  erro: {
    codigo: "PRODUTO_NAO_ENCONTRADO",
    tipo: "NAO_ENCONTRADO",
    mensagem: "Produto não encontrado. Confira o código.",
    correlacao: "01952a3b-4c5d-7e8f-9a0b-1c2d3e4f5061",
  },
};

describe("zRespostaErro", () => {
  it("aceita o envelope completo", () => {
    expect(zRespostaErro.parse(VALIDO)).toEqual(VALIDO);
  });

  it("exige mensagem preenchida", () => {
    // Envelope com mensagem vazia deixaria a tela do PDV sem o que mostrar, e o
    // operador veria um erro sem explicação.
    const semMensagem = { erro: { ...VALIDO.erro, mensagem: "" } };

    expect(zRespostaErro.safeParse(semMensagem).success).toBe(false);
  });

  it("exige correlação, que é o que o suporte pede", () => {
    const semCorrelacao = { erro: { ...VALIDO.erro, correlacao: "" } };

    expect(zRespostaErro.safeParse(semCorrelacao).success).toBe(false);
  });

  it("recusa tipo fora da lista", () => {
    const tipoInvalido = { erro: { ...VALIDO.erro, tipo: "OUTRO" } };

    expect(zRespostaErro.safeParse(tipoInvalido).success).toBe(false);
  });

  it("descarta campo extra em vez de repassá-lo", () => {
    // Garante que `detalhes` não trafega nem por acidente: um servidor futuro
    // que os anexasse veria o campo ser removido aqui, não vazado ao cliente.
    const comDetalhes = {
      erro: { ...VALIDO.erro, detalhes: { sql: "select 1", pilha: "..." } },
    };

    const analisado = zRespostaErro.parse(comDetalhes);

    expect(analisado.erro).not.toHaveProperty("detalhes");
  });
});

describe("zTipoErroApi", () => {
  it("aceita todas as categorias declaradas", () => {
    for (const tipo of TIPOS_ERRO) {
      expect(zTipoErroApi.parse(tipo)).toBe(tipo);
    }
  });

  it("distingue indisponibilidade de conflito", () => {
    // A distinção existe para o PDV: conflito o operador resolve, indisponível
    // ele só espera.
    expect(TIPOS_ERRO).toContain("INDISPONIVEL");
    expect(TIPOS_ERRO).toContain("CONFLITO");
  });
});

describe("constantes", () => {
  it("mantém o cabeçalho de correlação em minúsculas", () => {
    // Cabeçalho HTTP é insensível a caixa, mas o Node entrega em minúsculas:
    // comparar sem normalizar é defeito clássico de middleware.
    expect(CABECALHO_CORRELACAO).toBe(CABECALHO_CORRELACAO.toLowerCase());
  });

  it("expõe o código de erro interno como valor estável", () => {
    expect(CODIGO_ERRO_INTERNO).toBe("ERRO_INTERNO");
  });
});
