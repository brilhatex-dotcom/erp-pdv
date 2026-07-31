import { describe, expect, it } from "vitest";

import { Senha } from "./Senha.js";

describe("Senha.criar", () => {
  it("aceita doze caracteres", () => {
    expect(Senha.criar("gato azul 12").unwrap().revelar()).toBe("gato azul 12");
  });

  it("recusa menos de doze", () => {
    const resultado = Senha.criar("curta1234");

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("SENHA_MUITO_CURTA");
  });

  it("sugere frase na mensagem, em vez de exigir símbolo", () => {
    // Exigir maiúscula, número e símbolo produz `Senha@2026` — que passa no
    // formulário e é trivial de adivinhar.
    const resultado = Senha.criar("curta");

    expect(resultado.isErr() && resultado.error.mensagem).toContain("frase");
  });

  it("aceita frase longa sem símbolo nem número", () => {
    expect(Senha.criar("meu cachorro dorme na varanda").isOk()).toBe(true);
  });

  it("preserva espaço interno e nas pontas", () => {
    // `trim` faria a senha aceita no cadastro ser recusada no login por um
    // espaço que o usuário não vê.
    const comEspaco = " frase com espaco ";

    expect(Senha.criar(comEspaco).unwrap().revelar()).toBe(comEspaco);
  });

  it("recusa acima de duzentos caracteres", () => {
    const resultado = Senha.criar("a".repeat(201));

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("SENHA_MUITO_LONGA");
  });

  it("aceita exatamente duzentos", () => {
    expect(Senha.criar("a".repeat(200)).isOk()).toBe(true);
  });

  it("não põe a senha nos detalhes do erro", () => {
    const resultado = Senha.criar("segredo");

    expect(resultado.isErr() && JSON.stringify(resultado.error.detalhes)).not.toContain(
      "segredo",
    );
  });

  it("não revela o segredo em texto nem em JSON", () => {
    const senha = Senha.criar("frase secreta longa").unwrap();

    expect(String(senha)).toBe("[senha oculta]");
    expect(JSON.stringify({ senha })).not.toContain("frase");
  });
});
