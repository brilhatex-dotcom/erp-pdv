import { describe, expect, it } from "vitest";

import { CredencialHash } from "./CredencialHash.js";
import { Matricula } from "./Matricula.js";
import { Pin } from "./Pin.js";
import { Senha } from "./Senha.js";

describe("Matrícula", () => {
  it.each([
    ["1", "1"],
    ["42", "42"],
    ["999999", "999999"],
    ["  7  ", "7"],
  ])("aceita %p e normaliza para %p", (entrada, esperado) => {
    expect(Matricula.criar(entrada).unwrap().valor).toBe(esperado);
  });

  it("🔑 trata 007 e 7 como a mesma pessoa", () => {
    // Sem isso, o mesmo funcionário viraria dois cadastros e as vendas dele
    // ficariam divididas entre dois históricos.
    const comZeros = Matricula.criar("007").unwrap();
    const sem = Matricula.criar("7").unwrap();

    expect(comZeros.valor).toBe("7");
    expect(comZeros.equals(sem)).toBe(true);
  });

  it("preserva o zero de quem é literalmente a matrícula 0", () => {
    expect(Matricula.criar("000").unwrap().valor).toBe("0");
  });

  it.each([
    ["vazia", "", "MATRICULA_VAZIA"],
    ["só espaço", "   ", "MATRICULA_VAZIA"],
    ["com letra", "A1", "MATRICULA_NAO_NUMERICA"],
    ["com símbolo", "1-2", "MATRICULA_NAO_NUMERICA"],
    ["longa demais", "1234567", "MATRICULA_LONGA"],
  ])("recusa matrícula %s", (_descricao, entrada, codigo) => {
    const resultado = Matricula.criar(entrada);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe(codigo);
  });

  it("distingue matrículas diferentes", () => {
    expect(Matricula.criar("1").unwrap().equals(Matricula.criar("2").unwrap())).toBe(
      false,
    );
  });

  it("converte para texto", () => {
    expect(Matricula.criar("42").unwrap().toString()).toBe("42");
  });
});

describe("PIN", () => {
  it("aceita seis dígitos não óbvios", () => {
    expect(Pin.criar("419273").unwrap().valorEmClaro).toBe("419273");
  });

  it("ignora espaços em volta", () => {
    expect(Pin.criar("  419273 ").unwrap().valorEmClaro).toBe("419273");
  });

  it.each([["12345"], ["1234567"], ["12a456"], [""], ["      "]])(
    "recusa %p por formato",
    (entrada) => {
      const resultado = Pin.criar(entrada);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) expect(resultado.error.codigo).toBe("PIN_FORMATO_INVALIDO");
    },
  );

  it.each([
    ["repetido", "111111"],
    ["zeros", "000000"],
    ["crescente", "123456"],
    ["crescente alto", "456789"],
    ["decrescente", "654321"],
    ["decrescente alto", "987654"],
  ])("🔑 recusa PIN %s — é o primeiro que qualquer um tenta", (_descricao, entrada) => {
    const resultado = Pin.criar(entrada);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("PIN_PREVISIVEL");
  });

  it.each([["112233"], ["135790"], ["102030"]])(
    "aceita %p, que não é sequência nem repetição",
    (entrada) => {
      expect(Pin.criar(entrada).isOk()).toBe(true);
    },
  );

  it("não expõe o valor em serialização acidental", () => {
    // Campo privado: `JSON.stringify` não alcança o segredo.
    expect(JSON.stringify(Pin.criar("419273").unwrap())).toBe("{}");
  });
});

describe("Senha", () => {
  it("aceita frase longa e variada", () => {
    expect(Senha.criar("cavalo bateria grampo correto").isOk()).toBe(true);
  });

  it("🔑 prefere comprimento a regra de composição", () => {
    // `Senha@2026` atende às regras clássicas e é péssima; a frase abaixo não
    // tem símbolo algum e é muito melhor.
    expect(Senha.criar("Senha@2026").isErr()).toBe(true);
    expect(Senha.criar("pao de queijo quente").isOk()).toBe(true);
  });

  it("recusa senha curta", () => {
    const resultado = Senha.criar("curta12345");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SENHA_CURTA");
  });

  it("recusa senha longa mas repetitiva", () => {
    const resultado = Senha.criar("aaaaaaaaaaaaaaa");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SENHA_POUCO_VARIADA");
  });

  it("recusa senha só de espaços", () => {
    const resultado = Senha.criar(" \t\n\r\f\v      ");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SENHA_EM_BRANCO");
  });

  it("entrega o valor em claro só a quem pede explicitamente", () => {
    // O nome incômodo é proposital: quem escrever isto num log vai enxergar.
    expect(Senha.criar("cavalo bateria grampo").unwrap().valorEmClaro).toBe(
      "cavalo bateria grampo",
    );
  });

  it("não expõe o valor em serialização acidental", () => {
    expect(JSON.stringify(Senha.criar("cavalo bateria grampo").unwrap())).toBe("{}");
  });
});

describe("Hash de credencial", () => {
  it("guarda valor e algoritmo", () => {
    const hash = CredencialHash.criar("$argon2id$v=19$...", "argon2id").unwrap();

    expect(hash.valor).toBe("$argon2id$v=19$...");
    expect(hash.algoritmo).toBe("argon2id");
  });

  it("🔑 sabe quando o hash ficou para trás do algoritmo vigente", () => {
    // É o que permite trocar de algoritmo sem obrigar a loja inteira a
    // redefinir senha no mesmo dia: recalcula no próximo login que der certo.
    const antigo = CredencialHash.criar("$2b$12$...", "bcrypt").unwrap();

    expect(antigo.precisaRecalcular("argon2id")).toBe(true);
    expect(antigo.precisaRecalcular("bcrypt")).toBe(false);
  });

  it.each([
    ["valor vazio", "", "argon2id", "CREDENCIAL_HASH_VAZIO"],
    ["algoritmo vazio", "$argon2id$...", "  ", "CREDENCIAL_ALGORITMO_VAZIO"],
  ])("recusa %s", (_descricao, valor, algoritmo, codigo) => {
    const resultado = CredencialHash.criar(valor, algoritmo);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe(codigo);
  });

  it("nunca coloca o hash nos detalhes do erro — eles vão para o log", () => {
    const resultado = CredencialHash.criar("$argon2id$segredo", "");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(JSON.stringify(resultado.error.detalhes)).not.toContain("segredo");
    }
  });

  it("compara por valor e algoritmo", () => {
    const a = CredencialHash.criar("x", "argon2id").unwrap();
    const b = CredencialHash.criar("x", "argon2id").unwrap();
    const c = CredencialHash.criar("x", "bcrypt").unwrap();

    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
