import { CABECALHO_CORRELACAO, zRespostaErro } from "@erp/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { criarAmbienteFalso, criarContainerFalso } from "../testes/dubles.js";
import { MENSAGEM_ERRO_INTERNO } from "./apresentadores/erro.js";
import { criarServidor } from "./servidor.js";

/**
 * Testes da fronteira HTTP.
 *
 * Usam `app.inject`: exercitam o caminho real de uma requisição — hooks,
 * plugins, tratador de erro — sem abrir porta TCP. O que se verifica aqui é o
 * comportamento que o cliente vê, não a implementação de cada peça.
 */

let servidor: FastifyInstance | undefined;

afterEach(async () => {
  await servidor?.close();
  servidor = undefined;
});

async function levantar(
  sobrescritas: Parameters<typeof criarAmbienteFalso>[0] = {},
): Promise<FastifyInstance> {
  servidor = await criarServidor({
    ambiente: criarAmbienteFalso(sobrescritas),
    container: criarContainerFalso(),
    versao: "1.2.3",
    tempoNoArSegundos: () => 12,
  });

  return servidor;
}

describe("rota inexistente", () => {
  it("responde 404 no envelope do contrato", async () => {
    const app = await levantar();

    const resposta = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(resposta.statusCode).toBe(404);
    expect(zRespostaErro.parse(resposta.json()).erro).toMatchObject({
      codigo: "ROTA_NAO_ENCONTRADA",
      tipo: "NAO_ENCONTRADO",
    });
  });

  it("não revela quais rotas existem", async () => {
    // Mensagem que diferencia "rota inexistente" de "método errado" entrega o
    // desenho da API a quem estiver sondando (ARQUITETURA.md §7.1).
    const app = await levantar();

    const inexistente = await app.inject({ method: "GET", url: "/nao-existe" });
    const metodoErrado = await app.inject({ method: "DELETE", url: "/saude" });

    expect(metodoErrado.statusCode).toBe(404);
    expect(metodoErrado.json()).toMatchObject({
      erro: {
        mensagem: inexistente.json<{ erro: { mensagem: string } }>().erro.mensagem,
      },
    });
  });
});

describe("correlação", () => {
  it("devolve o cabeçalho em toda resposta", async () => {
    const app = await levantar();

    const resposta = await app.inject({ method: "GET", url: "/saude" });

    expect(resposta.headers[CABECALHO_CORRELACAO]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("devolve o cabeçalho também na resposta de erro", async () => {
    // É justamente quando o operador precisa informar o número ao suporte.
    const app = await levantar();

    const resposta = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(resposta.headers[CABECALHO_CORRELACAO]).toBeDefined();
    expect(resposta.json()).toMatchObject({
      erro: { correlacao: resposta.headers[CABECALHO_CORRELACAO] },
    });
  });

  it("reaproveita a correlação enviada pelo cliente", async () => {
    const app = await levantar();

    const resposta = await app.inject({
      method: "GET",
      url: "/saude",
      headers: { [CABECALHO_CORRELACAO]: "pdv-01-000123" },
    });

    expect(resposta.headers[CABECALHO_CORRELACAO]).toBe("pdv-01-000123");
  });

  it("descarta correlação com quebra de linha", async () => {
    const app = await levantar();

    const resposta = await app.inject({
      method: "GET",
      url: "/nao-existe",
      headers: { [CABECALHO_CORRELACAO]: "abc def" },
    });

    expect(resposta.headers[CABECALHO_CORRELACAO]).not.toBe("abc def");
  });

  it("ignora o cabeçalho request-id, que não passa por validação", async () => {
    // Se o Fastify o aceitasse, o valor entraria no log sem passar pelo filtro.
    const app = await levantar();

    const resposta = await app.inject({
      method: "GET",
      url: "/saude",
      headers: { "request-id": "forjado\ninjetado" },
    });

    expect(resposta.headers[CABECALHO_CORRELACAO]).not.toContain("forjado");
  });
});

describe("cabeçalhos de segurança", () => {
  it("aplica os cabeçalhos do Helmet", async () => {
    const app = await levantar();

    const resposta = await app.inject({ method: "GET", url: "/saude" });

    expect(resposta.headers["x-content-type-options"]).toBe("nosniff");
    expect(resposta.headers["x-frame-options"]).toBeDefined();
  });

  it("não anuncia o servidor", async () => {
    const app = await levantar();

    const resposta = await app.inject({ method: "GET", url: "/saude" });

    expect(resposta.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("limite de requisições", () => {
  it("recusa acima do teto com o envelope do contrato", async () => {
    const app = await levantar({ limiteRequisicoesPorMinuto: 2 });

    await app.inject({ method: "GET", url: "/saude" });
    await app.inject({ method: "GET", url: "/saude" });
    const excedida = await app.inject({ method: "GET", url: "/saude" });

    expect(excedida.statusCode).toBe(429);
    expect(zRespostaErro.parse(excedida.json()).erro).toMatchObject({
      codigo: "EXCESSO_REQUISICOES",
      // O status diz o que houve; a categoria diz o que fazer — esperar.
      tipo: "INDISPONIVEL",
    });
  });

  it("mantém a correlação na resposta recusada pelo limitador", async () => {
    const app = await levantar({ limiteRequisicoesPorMinuto: 1 });

    await app.inject({ method: "GET", url: "/saude" });
    const excedida = await app.inject({ method: "GET", url: "/saude" });

    expect(excedida.headers[CABECALHO_CORRELACAO]).toBeDefined();
  });
});

describe("valores padrão", () => {
  it("usa a versão do pacote e o tempo real de processo quando não recebe nenhum", async () => {
    // É como o servidor sobe em produção; sem este teste, os padrões só seriam
    // exercitados na loja.
    servidor = await criarServidor({
      ambiente: criarAmbienteFalso(),
      container: criarContainerFalso(),
    });

    const corpo = (await servidor.inject({ method: "GET", url: "/saude" })).json<{
      versao: string;
      tempoNoArSegundos: number;
    }>();

    expect(corpo.versao).toMatch(/^\d+\.\d+\.\d+/);
    expect(corpo.tempoNoArSegundos).toBeGreaterThan(0);
  });
});

describe("falha inesperada", () => {
  it("responde 500 sem revelar a exceção", async () => {
    const app = await levantar();

    app.get("/defeito", () => {
      throw new Error("select senha from usuarios -- detalhe interno");
    });

    const resposta = await app.inject({ method: "GET", url: "/defeito" });

    expect(resposta.statusCode).toBe(500);
    expect(resposta.body).not.toContain("senha");
    expect(resposta.body).not.toContain("usuarios");
    expect(zRespostaErro.parse(resposta.json()).erro).toMatchObject({
      codigo: "ERRO_INTERNO",
      mensagem: MENSAGEM_ERRO_INTERNO,
    });
  });

  it("responde 400 genérico para corpo malformado", async () => {
    // O Fastify devolveria a própria mensagem de erro de parse, em inglês e com
    // a posição do caractere — texto de desenvolvedor na tela do caixa.
    const app = await levantar();

    app.post("/eco", () => ({ ok: true }));

    const resposta = await app.inject({
      method: "POST",
      url: "/eco",
      headers: { "content-type": "application/json" },
      payload: "{isso não é json",
    });

    expect(resposta.statusCode).toBe(400);
    expect(zRespostaErro.parse(resposta.json()).erro).toMatchObject({
      codigo: "REQUISICAO_INVALIDA",
      tipo: "VALIDACAO",
    });
    expect(resposta.body).not.toMatch(/JSON|Unexpected/i);
  });

  it("responde 400 quando um schema recusa dados dentro da rota", async () => {
    // As rotas de negócio validam com Zod. Uma recusa de schema é pedido
    // malformado — 400 —, e não falha do servidor; sem isto o cliente veria 500
    // e o log acusaria defeito onde só houve requisição errada.
    const app = await levantar();

    app.get("/valida", () => {
      zRespostaErro.parse({ erro: {} });
      return { ok: true };
    });

    const resposta = await app.inject({ method: "GET", url: "/valida" });

    expect(resposta.statusCode).toBe(400);
    expect(zRespostaErro.parse(resposta.json()).erro.codigo).toBe("REQUISICAO_INVALIDA");
  });

  it("recusa corpo acima do limite", async () => {
    const app = await levantar();

    app.post("/eco", () => ({ ok: true }));

    const resposta = await app.inject({
      method: "POST",
      url: "/eco",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ lixo: "x".repeat(2_000_000) }),
    });

    expect(resposta.statusCode).toBe(413);
    expect(zRespostaErro.safeParse(resposta.json()).success).toBe(true);
  });
});
