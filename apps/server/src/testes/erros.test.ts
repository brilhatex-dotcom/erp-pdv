import {
  ErroConflito,
  ErroNaoAutorizado,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  ErroValidacao,
} from "@erp/domain";
import { describe, expect, it, vi } from "vitest";

import { corpoDe, statusDe, tratadorDeErro } from "../http/erros.js";

/** Resposta mínima com a superfície que o tratador usa. */
function respostaFalsa() {
  const enviado: { status?: number; corpo?: unknown } = {};

  const resposta = {
    status(codigo: number) {
      enviado.status = codigo;
      return resposta;
    },
    send(corpo: unknown) {
      enviado.corpo = corpo;
      return resposta;
    },
  };

  return { resposta, enviado };
}

const requisicaoFalsa = { log: { error: vi.fn() } };

describe("Status HTTP por tipo de erro", () => {
  it.each([
    [new ErroValidacao("X", "x"), 400],
    [new ErroRegraNegocio("X", "x"), 422],
    [new ErroNaoEncontrado("X", "x"), 404],
    [new ErroNaoAutorizado("X", "x"), 403],
    [new ErroConflito("X", "x"), 409],
  ])("mapeia %s", (erro, esperado) => {
    expect(statusDe(erro)).toBe(esperado);
  });

  it("🔑 credencial inválida é 401, não 403", () => {
    // O cliente precisa saber que deve reautenticar, e não que está
    // autenticado sem permissão.
    expect(statusDe(new ErroNaoAutorizado("CREDENCIAL_INVALIDA", "x"))).toBe(401);
    expect(statusDe(new ErroNaoAutorizado("SESSAO_EXPIRADA", "x"))).toBe(401);
  });

  it("🔑 bloqueio é 429 — é limitação de tentativa, não falta de permissão", () => {
    expect(statusDe(new ErroRegraNegocio("USUARIO_BLOQUEADO", "x"))).toBe(429);
  });
});

describe("Corpo da resposta de erro", () => {
  it("leva código e mensagem escrita para o operador", () => {
    const corpo = corpoDe(new ErroRegraNegocio("SEM_ESTOQUE", "Não há esse produto."));

    expect(corpo.erro.codigo).toBe("SEM_ESTOQUE");
    expect(corpo.erro.mensagem).toBe("Não há esse produto.");
  });

  it("🔑 filtra os detalhes por lista de permissão", () => {
    // `detalhes` foi projetado para o log e carrega identificador interno.
    // Devolvê-lo inteiro entregaria o mapa interno do sistema.
    const corpo = corpoDe(
      new ErroNaoAutorizado("AUTORIZACAO_NECESSARIA", "Precisa de supervisor.", {
        permissaoNecessaria: "venda:desconto_acima_limite",
        usuarioId: "018f-secreto",
        coluna: "hash_pin",
      }),
    );

    expect(corpo.erro.detalhes).toEqual({
      permissaoNecessaria: "venda:desconto_acima_limite",
    });
  });

  it("omite os detalhes quando nada é público", () => {
    const corpo = corpoDe(
      new ErroRegraNegocio("X", "x", { usuarioId: "secreto", tabela: "usuarios" }),
    );

    expect(corpo.erro.detalhes).toBeUndefined();
  });

  it("omite os detalhes quando não há nenhum", () => {
    expect(corpoDe(new ErroValidacao("X", "x")).erro.detalhes).toBeUndefined();
  });
});

describe("Último anteparo", () => {
  it("traduz erro de domínio que escapou", () => {
    const { resposta, enviado } = respostaFalsa();

    tratadorDeErro(
      new ErroNaoEncontrado("SUMIU", "Não encontrado."),
      requisicaoFalsa as never,
      resposta as never,
    );

    expect(enviado.status).toBe(404);
  });

  it("repassa status de validação do próprio Fastify", () => {
    const { resposta, enviado } = respostaFalsa();
    const erro = Object.assign(new Error("body inválido"), { statusCode: 400 });

    tratadorDeErro(erro, requisicaoFalsa as never, resposta as never);

    expect(enviado.status).toBe(400);
    expect(enviado.corpo).toMatchObject({ erro: { codigo: "REQUISICAO_INVALIDA" } });
  });

  it("🔑 bug de programação vira 500 genérico, com o técnico só no log", () => {
    // Erro técnico na tela do caixa é veto do papel UX. O detalhe vai para o
    // log, onde o suporte alcança sem precisar ir à loja.
    const { resposta, enviado } = respostaFalsa();
    const registrar = vi.fn();

    tratadorDeErro(
      new TypeError("cannot read property 'x' of undefined"),
      { log: { error: registrar } } as never,
      resposta as never,
    );

    expect(enviado.status).toBe(500);
    expect(enviado.corpo).toEqual({
      erro: {
        codigo: "FALHA_INTERNA",
        mensagem: "Não foi possível concluir a operação. Tente novamente.",
      },
    });
    expect(JSON.stringify(enviado.corpo)).not.toContain("undefined'");
    expect(registrar).toHaveBeenCalledOnce();
  });

  it("erro do Fastify com status 5xx também vira 500 genérico", () => {
    const { resposta, enviado } = respostaFalsa();
    const erro = Object.assign(new Error("upstream caiu"), { statusCode: 503 });

    tratadorDeErro(erro, requisicaoFalsa as never, resposta as never);

    expect(enviado.status).toBe(500);
  });
});
