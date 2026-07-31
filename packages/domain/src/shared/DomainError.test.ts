import { describe, expect, it } from "vitest";

import {
  DomainError,
  ErroConflito,
  ErroNaoAutorizado,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  ErroValidacao,
} from "./DomainError.js";

describe("DomainError", () => {
  it("não estende Error, para não convidar ao throw", () => {
    const erro = new ErroValidacao("X", "mensagem");

    expect(erro).not.toBeInstanceOf(Error);
    expect(erro).toBeInstanceOf(DomainError);
  });

  it.each([
    [new ErroValidacao("CPF_INVALIDO", "CPF inválido."), "VALIDACAO"],
    [new ErroRegraNegocio("ESTOQUE", "Estoque insuficiente."), "REGRA_NEGOCIO"],
    [new ErroNaoEncontrado("PRODUTO", "Produto não encontrado."), "NAO_ENCONTRADO"],
    [new ErroConflito("CAIXA_ABERTO", "Já existe caixa aberto."), "CONFLITO"],
    [new ErroNaoAutorizado("SEM_PERMISSAO", "Sem permissão."), "NAO_AUTORIZADO"],
  ])("classifica $codigo com o tipo %s", (erro, tipoEsperado) => {
    expect(erro.tipo).toBe(tipoEsperado);
  });

  it("guarda código, mensagem e detalhes", () => {
    const erro = new ErroRegraNegocio(
      "ESTOQUE_INSUFICIENTE",
      "Não há estoque suficiente para este produto.",
      { produtoId: "abc", disponivel: 2, solicitado: 5 },
    );

    expect(erro.codigo).toBe("ESTOQUE_INSUFICIENTE");
    expect(erro.mensagem).toBe("Não há estoque suficiente para este produto.");
    expect(erro.detalhes).toEqual({ produtoId: "abc", disponivel: 2, solicitado: 5 });
  });

  it("permite omitir os detalhes", () => {
    expect(new ErroConflito("X", "mensagem").detalhes).toBeUndefined();
  });

  it("descreve como código e mensagem no toString, para o log", () => {
    const erro = new ErroNaoEncontrado("PRODUTO_NAO_ENCONTRADO", "Produto não existe.");

    expect(erro.toString()).toBe("PRODUTO_NAO_ENCONTRADO: Produto não existe.");
  });

  it("separa o código técnico da mensagem do operador", () => {
    // O CLAUDE.md §9 proíbe exibir erro técnico ao caixa. O código fica no log;
    // a mensagem é o que pode aparecer na tela.
    const erro = new ErroValidacao(
      "QUANTIDADE_NAO_FRACIONAVEL",
      "Não é possível usar quantidade fracionada em caixa.",
    );

    expect(erro.codigo).toMatch(/^[A-Z_]+$/);
    expect(erro.mensagem).not.toMatch(/[A-Z_]{4,}/);
  });
});
