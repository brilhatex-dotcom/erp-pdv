import { ErroInfraestrutura } from "@erp/application";
import { TIPOS_ERRO, zRespostaErro } from "@erp/contracts";
import {
  ErroConflito,
  ErroNaoAutorizado,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  ErroValidacao,
} from "@erp/domain";
import { describe, expect, it } from "vitest";

import {
  corpoDeErro,
  corpoDeErroDireto,
  corpoDeErroInterno,
  MENSAGEM_ERRO_INTERNO,
  statusHttp,
  tipoNoFio,
} from "./erro.js";

const CORRELACAO = "01952a3b-4c5d-7e8f-9a0b-000000000001";

describe("tipoNoFio", () => {
  it("preserva a categoria dos erros de negócio", () => {
    expect(tipoNoFio(new ErroValidacao("X", "m"))).toBe("VALIDACAO");
    expect(tipoNoFio(new ErroRegraNegocio("X", "m"))).toBe("REGRA_NEGOCIO");
    expect(tipoNoFio(new ErroNaoEncontrado("X", "m"))).toBe("NAO_ENCONTRADO");
    expect(tipoNoFio(new ErroConflito("X", "m"))).toBe("CONFLITO");
    expect(tipoNoFio(new ErroNaoAutorizado("X", "m"))).toBe("NAO_AUTORIZADO");
  });

  it("traduz falha de infraestrutura para indisponibilidade", () => {
    // No domínio ela se declara CONFLITO por falta de categoria melhor. Mandar
    // 409 ao PDV faria o operador tentar corrigir algo que está certo.
    const erro = new ErroInfraestrutura("FALHA_TRANSACAO");

    expect(erro.tipo).toBe("CONFLITO");
    expect(tipoNoFio(erro)).toBe("INDISPONIVEL");
  });
});

describe("statusHttp", () => {
  it("mapeia cada categoria para um status", () => {
    expect(statusHttp("VALIDACAO")).toBe(400);
    expect(statusHttp("NAO_AUTORIZADO")).toBe(403);
    expect(statusHttp("NAO_ENCONTRADO")).toBe(404);
    expect(statusHttp("CONFLITO")).toBe(409);
    expect(statusHttp("REGRA_NEGOCIO")).toBe(422);
    expect(statusHttp("INDISPONIVEL")).toBe(503);
  });

  it("cobre todas as categorias do contrato", () => {
    // Categoria nova sem status seria `undefined` no lugar do código de status.
    // Este teste falha no dia em que alguém acrescentar uma e esquecer o mapa.
    for (const tipo of TIPOS_ERRO) {
      expect(statusHttp(tipo)).toBeGreaterThanOrEqual(400);
    }
  });

  it("separa recusa de negócio de pedido malformado", () => {
    // 422 é "entendi e a regra não permite"; 400 é "não entendi". Colapsar as
    // duas apagaria o sinal que distingue mensagem ao operador de bug do cliente.
    expect(statusHttp("REGRA_NEGOCIO")).not.toBe(statusHttp("VALIDACAO"));
  });
});

describe("corpoDeErro", () => {
  it("monta um envelope válido pelo contrato", () => {
    const corpo = corpoDeErro(
      new ErroRegraNegocio("ESTOQUE_INSUFICIENTE", "Não há saldo suficiente."),
      CORRELACAO,
    );

    expect(zRespostaErro.parse(corpo)).toEqual({
      erro: {
        codigo: "ESTOQUE_INSUFICIENTE",
        tipo: "REGRA_NEGOCIO",
        mensagem: "Não há saldo suficiente.",
        correlacao: CORRELACAO,
      },
    });
  });

  it("não deixa os detalhes técnicos saírem na resposta", () => {
    // `detalhes` carrega id, código de barras e valor — contexto legítimo no log
    // e indevido na resposta (CLAUDE.md §9).
    const corpo = corpoDeErro(
      new ErroNaoEncontrado("PRODUTO_NAO_ENCONTRADO", "Produto não encontrado.", {
        codigo: "7891234567895",
        consulta: "select * from produtos",
      }),
      CORRELACAO,
    );

    expect(JSON.stringify(corpo)).not.toContain("7891234567895");
    expect(JSON.stringify(corpo)).not.toContain("select");
  });

  it("preserva a mensagem do domínio, que é escrita para o operador", () => {
    const mensagem = "Abra o caixa antes de iniciar uma venda.";

    expect(
      corpoDeErro(new ErroRegraNegocio("CAIXA_FECHADO", mensagem), CORRELACAO).erro
        .mensagem,
    ).toBe(mensagem);
  });
});

describe("corpoDeErroDireto", () => {
  it("monta envelope sem erro de domínio por trás", () => {
    const corpo = corpoDeErroDireto(
      {
        codigo: "ROTA_NAO_ENCONTRADA",
        tipo: "NAO_ENCONTRADO",
        mensagem: "Recurso não encontrado.",
      },
      CORRELACAO,
    );

    expect(zRespostaErro.safeParse(corpo).success).toBe(true);
  });
});

describe("corpoDeErroInterno", () => {
  it("diz o que fazer, não o que quebrou", () => {
    const corpo = corpoDeErroInterno(CORRELACAO);

    expect(corpo.erro.mensagem).toBe(MENSAGEM_ERRO_INTERNO);
    expect(corpo.erro.mensagem).toContain("suporte");
    expect(corpo.erro.codigo).toBe("ERRO_INTERNO");
  });

  it("carrega a correlação, que é o que liga a tela ao log", () => {
    expect(corpoDeErroInterno(CORRELACAO).erro.correlacao).toBe(CORRELACAO);
  });
});
