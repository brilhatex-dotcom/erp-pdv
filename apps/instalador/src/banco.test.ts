import { describe, expect, it } from "vitest";

import {
  argumentosDaConsultaDeBanco,
  argumentosDoCreatedb,
  bancoExiste,
  NOME_DO_BANCO,
  NOME_DO_BANCO_DE_TREINO,
} from "./banco.js";

describe("criação do banco da instalação", () => {
  it("cria com a mesma collation do desenvolvimento", () => {
    const argumentos = argumentosDoCreatedb(55433);

    expect(argumentos).toContain("--locale-provider=icu");
    expect(argumentos).toContain("--icu-locale=pt-BR");
    expect(argumentos).toContain("--encoding=UTF8");
  });

  it("parte de template0, para não herdar a collation da máquina do lojista", () => {
    expect(argumentosDoCreatedb(55433)).toContain("--template=template0");
  });

  it("usa a porta dedicada, não a 5432", () => {
    expect(argumentosDoCreatedb(55433)).toContain("--port=55433");
  });

  it("nunca abre prompt de senha: no serviço não há quem digite", () => {
    expect(argumentosDoCreatedb(55433)).toContain("--no-password");
    expect(argumentosDaConsultaDeBanco(55433)).toContain("--no-password");
  });

  it("cria o banco que a URL de conexão espera", () => {
    expect(argumentosDoCreatedb(55433).at(-1)).toBe(NOME_DO_BANCO);
  });

  it("consulta um banco diferente do que vai criar", () => {
    // Perguntar "existe?" conectando no próprio banco perguntado falharia
    // quando ele não existe — que é exatamente o caso a detectar.
    expect(argumentosDaConsultaDeBanco(55433)).toContain("--dbname=postgres");
  });
});

describe("o banco do treinamento (ADR-0026)", () => {
  it("🔑 tem o sufixo que o servidor confere antes de mexer nele", () => {
    expect(NOME_DO_BANCO_DE_TREINO.endsWith("_treino")).toBe(true);
    expect(NOME_DO_BANCO.endsWith("_treino")).toBe(false);
  });

  it("é criado com o mesmo cuidado do banco da loja", () => {
    const argumentos = argumentosDoCreatedb(55433, NOME_DO_BANCO_DE_TREINO);

    expect(argumentos.at(-1)).toBe("erp_pdv_treino");
    expect(argumentos).toContain("--template=template0");
    expect(argumentos).toContain("--icu-locale=pt-BR");
  });

  it("a consulta de existência pergunta pelo banco certo", () => {
    expect(argumentosDaConsultaDeBanco(55433, NOME_DO_BANCO_DE_TREINO).at(-1)).toBe(
      "SELECT 1 FROM pg_database WHERE datname = 'erp_pdv_treino'",
    );
    expect(argumentosDaConsultaDeBanco(55433).at(-1)).toBe(
      "SELECT 1 FROM pg_database WHERE datname = 'erp_pdv'",
    );
  });
});

describe("leitura da resposta do psql", () => {
  it("reconhece o banco existente", () => {
    expect(bancoExiste("1\n")).toBe(true);
  });

  it("reconhece a ausência", () => {
    expect(bancoExiste("\n")).toBe(false);
    expect(bancoExiste("")).toBe(false);
  });

  it("não confunde outra saída com existência", () => {
    expect(bancoExiste("0")).toBe(false);
    expect(bancoExiste("psql: erro de conexão")).toBe(false);
  });
});
