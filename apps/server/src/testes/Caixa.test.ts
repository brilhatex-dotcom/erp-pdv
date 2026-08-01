import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarProduto,
  cadastrarUsuario,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
} from "./apoio.js";

/**
 * Sangria, suprimento e fechamento pela API.
 *
 * O que se verifica aqui é a **borda**: quem pode chamar, o que o corpo aceita
 * e — o mais importante — que o valor esperado na gaveta não vaza para a
 * estação antes da contagem.
 */

let servidor: FastifyInstance;
let container: Container;

const ESTACAO = "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9101";

const PIN_OPERADOR = "419273";
const PIN_SUPERVISOR = "860412";
const PIN_GERENTE = "573914";

beforeAll(async () => {
  prepararBanco();
  const montado = await montarServidorDeTeste();
  servidor = montado.servidor;
  container = montado.container;
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
});

beforeEach(async () => {
  await limparBanco(container);
  await cadastrarProduto(container);

  await cadastrarUsuario(container, {
    matricula: "42",
    nome: "Maria Operadora",
    papel: "OPERADOR_CAIXA",
    pin: PIN_OPERADOR,
  });
  await cadastrarUsuario(container, {
    matricula: "7",
    nome: "João Supervisor",
    papel: "SUPERVISOR",
    pin: PIN_SUPERVISOR,
  });
  await cadastrarUsuario(container, {
    matricula: "1",
    nome: "Ana Gerente",
    papel: "GERENTE",
    pin: PIN_GERENTE,
  });
});

async function entrar(
  matricula: string,
  pin: string,
): Promise<{ authorization: string }> {
  return { authorization: `Bearer ${(await logar(servidor, matricula, pin)).token}` };
}

async function abrirCaixa(
  cabecalho: { authorization: string },
  fundoTroco = "100000",
): Promise<void> {
  await servidor.inject({
    method: "POST",
    url: "/api/caixa/abrir",
    headers: cabecalho,
    payload: { estacaoId: ESTACAO, fundoTroco },
  });
}

function sangrar(
  cabecalho: { authorization: string },
  valor: string,
  supervisor?: { matricula: string; pin: string },
) {
  return servidor.inject({
    method: "POST",
    url: "/api/caixa/sangria",
    headers: cabecalho,
    payload: {
      estacaoId: ESTACAO,
      valor,
      motivo: "Depósito bancário",
      ...(supervisor === undefined ? {} : { supervisor }),
    },
  });
}

function fechar(
  cabecalho: { authorization: string },
  contadoEmDinheiro: string,
  vendasPendentes?: number,
) {
  return servidor.inject({
    method: "POST",
    url: "/api/caixa/fechar",
    headers: cabecalho,
    payload: {
      estacaoId: ESTACAO,
      contadoEmDinheiro,
      ...(vendasPendentes === undefined ? {} : { vendasPendentes }),
    },
  });
}

describe("GET /api/caixa/aberto", () => {
  it("🔑 não entrega o esperado em dinheiro à estação", async () => {
    // É o número que a conferência existe para descobrir. Escondê-lo só na tela
    // não bastaria: quem abre a aba de rede do navegador veria o mesmo valor.
    const cabecalho = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(cabecalho);

    const resposta = await servidor.inject({
      method: "GET",
      url: `/api/caixa/aberto?estacaoId=${ESTACAO}`,
      headers: cabecalho,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).not.toHaveProperty("esperadoEmDinheiro");
    expect(resposta.json()).toMatchObject({ fundoTroco: "100000", quantidadeVendas: 0 });
  });
});

describe("POST /api/caixa/sangria", () => {
  it("🔑 o operador de caixa é recusado", async () => {
    const cabecalho = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(cabecalho);

    const resposta = await sangrar(cabecalho, "10000");

    // 403 e não 401: a sessão é válida, o que falta é alçada. Responder 401
    // faria o cliente tentar renovar o token e cair no login — o operador
    // acharia que a sessão caiu, quando na verdade ele só não pode sangrar.
    expect(resposta.statusCode).toBe(403);
  });

  it("o supervisor sangra dentro do teto dele", async () => {
    const doOperador = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(doOperador);

    const resposta = await sangrar(await entrar("7", PIN_SUPERVISOR), "10000");

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ tipo: "SANGRIA", valor: "10000" });
  });

  it("🔑 acima do teto, a resposta diz que falta liberação — não que é proibido", async () => {
    // A tela precisa da diferença para abrir o modal do supervisor em vez de
    // mostrar "você não pode".
    const doOperador = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(doOperador);

    const resposta = await sangrar(await entrar("7", PIN_SUPERVISOR), "60000");

    expect(resposta.json<{ erro: { codigo: string } }>().erro.codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );
  });

  it("o gerente libera a sangria acima do teto", async () => {
    const doOperador = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(doOperador);

    const resposta = await sangrar(await entrar("7", PIN_SUPERVISOR), "60000", {
      matricula: "1",
      pin: PIN_GERENTE,
    });

    expect(resposta.statusCode).toBe(201);
  });

  it("motivo em branco é recusado", async () => {
    const cabecalho = await entrar("7", PIN_SUPERVISOR);
    await abrirCaixa(await entrar("42", PIN_OPERADOR));

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/caixa/sangria",
      headers: cabecalho,
      payload: { estacaoId: ESTACAO, valor: "1000", motivo: "" },
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("sem token, nada acontece", async () => {
    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/caixa/sangria",
      payload: { estacaoId: ESTACAO, valor: "1000", motivo: "Depósito" },
    });

    expect(resposta.statusCode).toBe(401);
  });
});

describe("POST /api/caixa/suprimento", () => {
  it("🔑 o operador põe troco sem chamar ninguém", async () => {
    const cabecalho = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(cabecalho);

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/caixa/suprimento",
      headers: cabecalho,
      payload: { estacaoId: ESTACAO, valor: "5000", motivo: "Troco do cofre" },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ tipo: "SUPRIMENTO", valor: "5000" });
  });
});

describe("POST /api/caixa/fechar", () => {
  it("fecha e devolve a conferência, agora com o esperado", async () => {
    // Aqui o esperado aparece: a contagem já foi enviada, e o operador precisa
    // ver de onde vem a diferença para explicá-la.
    const cabecalho = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(cabecalho);

    const resposta = await fechar(cabecalho, "100000");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      esperadoEmDinheiro: "100000",
      contadoEmDinheiro: "100000",
      divergenciaEmDinheiro: "0",
      quantidadeVendas: 0,
    });
  });

  it("🔑 divergência não impede o fechamento", async () => {
    const cabecalho = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(cabecalho);

    const resposta = await fechar(cabecalho, "98000");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<{ divergenciaEmDinheiro: string }>().divergenciaEmDinheiro).toBe(
      "-2000",
    );
  });

  it("🔑 venda ainda na fila da estação impede", async () => {
    const cabecalho = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(cabecalho);

    const resposta = await fechar(cabecalho, "100000", 2);

    expect(resposta.json<{ erro: { codigo: string } }>().erro.codigo).toBe(
      "CAIXA_COM_VENDAS_PENDENTES",
    );

    // E o caixa continua aberto: o operador sincroniza e tenta de novo.
    const aberto = await servidor.inject({
      method: "GET",
      url: `/api/caixa/aberto?estacaoId=${ESTACAO}`,
      headers: cabecalho,
    });
    expect(aberto.statusCode).toBe(200);
  });

  it("dinheiro chega como texto, e valor com vírgula é recusado", async () => {
    const cabecalho = await entrar("42", PIN_OPERADOR);
    await abrirCaixa(cabecalho);

    const resposta = await fechar(cabecalho, "1000,00");

    expect(resposta.statusCode).toBe(400);
  });

  it("estação sem caixa aberto é 404", async () => {
    const resposta = await fechar(await entrar("42", PIN_OPERADOR), "100000");

    expect(resposta.statusCode).toBe(404);
  });
});
