import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { carregarAmbiente } from "../ambiente.js";
import { type Container, montarContainer } from "../composicao/container.js";
import { montarServidor } from "../servidor.js";
import {
  apagarBancoDeTreino,
  cadastrarUsuario,
  criarBancoDeTreino,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
  proximoId,
  urlBancoDeTeste,
  urlBancoDeTreino,
} from "./apoio.js";

/**
 * O modo treinamento pela API, com os dois bancos de verdade (ADR-0026).
 *
 * O que se prova é o isolamento: a venda de treino só existe no banco de
 * treino, o token e o cookie de um modo não abrem o outro, e recomeçar apaga o
 * treino sem tocar a loja — além de a loja seguir de pé quando o treino cai.
 */

const ESTACAO = proximoId();

let servidor: FastifyInstance;
let container: Container;
let treino: Container;

type Cabecalho = { readonly authorization: string };

async function chamar(
  cabecalho: Cabecalho | undefined,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const resposta = await servidor.inject({
    method,
    url,
    ...(cabecalho === undefined ? {} : { headers: cabecalho }),
    ...(payload === undefined ? {} : { payload }),
  });

  return {
    status: resposta.statusCode,
    corpo: resposta.body === "" ? {} : resposta.json<Record<string, unknown>>(),
  };
}

/** Entra no treino com uma das pessoas de demonstração. */
async function entrarNoTreino(
  matricula = "901",
  pin = "121212",
): Promise<{ readonly cabecalho: Cabecalho; readonly cookies: string }> {
  const resposta = await servidor.inject({
    method: "POST",
    url: "/treino/api/acesso/login",
    payload: {
      matricula,
      segredo: pin,
      contexto: "PDV",
      dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
    },
  });
  expect(resposta.statusCode).toBe(200);

  const { token } = resposta.json<{ token: string }>();

  return {
    cabecalho: { authorization: `Bearer ${token}` },
    cookies: resposta.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };
}

beforeAll(async () => {
  prepararBanco();
  await criarBancoDeTreino();
  const montado = await montarServidorDeTeste({
    DATABASE_URL_TREINAMENTO: urlBancoDeTreino(),
  });
  servidor = montado.servidor;
  container = montado.container;
  // O ambiente aprovou o banco do treino; sem ele, a suíte inteira não vale.
  if (montado.treino === undefined) throw new Error("treino não montado");
  treino = montado.treino;
  await limparBanco(container);
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
  await treino.encerrar();
  await apagarBancoDeTreino();
});

describe("Treinamento — a loja de demonstração", () => {
  it("🔑 a primeira consulta monta a loja e diz com quem entrar", async () => {
    const resposta = await chamar(undefined, "GET", "/treino/api/treinamento");

    expect(resposta.status).toBe(200);
    expect(resposta.corpo["pessoas"]).toEqual([
      expect.objectContaining({ matricula: "901", pin: "121212" }),
      expect.objectContaining({ matricula: "902", pin: "232323" }),
      expect.objectContaining({ matricula: "903", pin: "343434" }),
    ]);
    expect(resposta.corpo["exemplos"]).toContainEqual({
      descricao: "Refrigerante cola 2 L",
      codigo: "7890000000017",
    });

    expect(await treino.prisma.usuario.count()).toBe(3);
    expect(await treino.prisma.produto.count()).toBe(13);
    // Nada disso chegou à loja.
    expect(await container.prisma.usuario.count()).toBe(0);
    expect(await container.prisma.produto.count()).toBe(0);
  });

  it("consultar de novo não monta outra loja", async () => {
    await chamar(undefined, "GET", "/treino/api/treinamento");

    expect(await treino.prisma.usuario.count()).toBe(3);
  });
});

describe("Treinamento — isolamento", () => {
  it("🔑 a venda de treino, com Pix simulado, fica só no banco de treino", async () => {
    await chamar(undefined, "GET", "/treino/api/treinamento");
    const { cabecalho } = await entrarNoTreino();

    const contexto = await chamar(cabecalho, "GET", "/treino/api/pdv/contexto");
    expect(contexto.corpo["modo"]).toBe("TREINAMENTO");
    expect(contexto.corpo["treinamento"]).toEqual({
      exemplos: expect.arrayContaining([
        { descricao: "Leite integral 1 L", codigo: "7890000000062" },
      ]) as unknown,
    });

    const caixa = await chamar(cabecalho, "POST", "/treino/api/caixa/abrir", {
      estacaoId: ESTACAO.valor,
      fundoTroco: "10000",
    });
    expect(caixa.status).toBe(201);

    const venda = await chamar(cabecalho, "POST", "/treino/api/vendas", {
      estacaoId: ESTACAO.valor,
    });
    const id = String(venda.corpo["id"]);
    await chamar(cabecalho, "POST", `/treino/api/vendas/${id}/itens`, {
      codigo: "7890000000017",
    });
    const paga = await chamar(cabecalho, "POST", `/treino/api/vendas/${id}/pagamentos`, {
      forma: "PIX",
      valor: "990",
      confirmacao: "SIMULADA",
    });
    expect(paga.status).toBe(201);
    const finalizada = await chamar(
      cabecalho,
      "POST",
      `/treino/api/vendas/${id}/finalizar`,
      {},
    );
    expect(finalizada.corpo["status"]).toBe("FINALIZADA");

    const comprovante = await chamar(
      cabecalho,
      "GET",
      `/treino/api/vendas/${id}/comprovante`,
    );
    expect(comprovante.corpo["treinamento"]).toBe(true);

    expect(await treino.prisma.venda.count({ where: { status: "FINALIZADA" } })).toBe(1);
    expect(await container.prisma.venda.count()).toBe(0);
    expect(await container.prisma.sessaoCaixa.count()).toBe(0);
  });

  it("🔑 o token do treino não abre a loja, e o da loja não abre o treino", async () => {
    await chamar(undefined, "GET", "/treino/api/treinamento");
    const doTreino = await entrarNoTreino();

    expect((await chamar(doTreino.cabecalho, "GET", "/api/acesso/eu")).status).toBe(401);
    // Rota que só exige o token, sem consultar quem é: é a assinatura do
    // emissor que impede o PIN público do treino de ler o caixa da loja.
    expect(
      (
        await chamar(
          doTreino.cabecalho,
          "GET",
          `/api/caixa/aberto?estacaoId=${ESTACAO.valor}`,
        )
      ).status,
    ).toBe(401);

    await cadastrarUsuario(container, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "482913",
    });
    const { token } = await logar(servidor, "42", "482913");
    const daLoja = { authorization: `Bearer ${token}` };

    expect((await chamar(daLoja, "GET", "/api/acesso/eu")).status).toBe(200);
    expect((await chamar(daLoja, "GET", "/treino/api/acesso/eu")).status).toBe(401);
    // Matrícula de treino não existe na loja.
    expect((await logar(servidor, "901", "121212")).token).toBe("");
  });

  it("🔑 os cookies do treino têm nome próprio e só valem sob /treino", async () => {
    await chamar(undefined, "GET", "/treino/api/treinamento");

    const resposta = await servidor.inject({
      method: "POST",
      url: "/treino/api/acesso/login",
      payload: {
        matricula: "901",
        segredo: "121212",
        contexto: "PDV",
        dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
      },
    });

    expect(resposta.cookies.map((c) => [c.name, c.path])).toEqual([
      ["erp_sessao_treino", "/treino"],
      ["erp_refresh_treino", "/treino"],
    ]);

    const cookies = resposta.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const renovada = await servidor.inject({
      method: "POST",
      url: "/treino/api/acesso/renovar",
      headers: { cookie: cookies },
    });
    expect(renovada.statusCode).toBe(200);

    // Na loja, o cookie de treino não é o que se procura.
    const naLoja = await servidor.inject({
      method: "POST",
      url: "/api/acesso/renovar",
      headers: { cookie: cookies },
    });
    expect(naLoja.statusCode).toBe(401);
  });
});

describe("Treinamento — recomeçar", () => {
  it("recomeçar exige estar no treino", async () => {
    const resposta = await chamar(undefined, "POST", "/treino/api/treinamento/recomecar");

    expect(resposta.status).toBe(401);
  });

  it("🔑 apaga o que o treino fez, monta a loja de novo e derruba as sessões de antes", async () => {
    await chamar(undefined, "GET", "/treino/api/treinamento");
    const { cabecalho } = await entrarNoTreino();
    const outraEstacao = await entrarNoTreino("902", "232323");
    await chamar(cabecalho, "POST", "/treino/api/vendas", { estacaoId: ESTACAO.valor });
    expect(await treino.prisma.venda.count()).toBeGreaterThan(0);

    const recomecado = await chamar(
      cabecalho,
      "POST",
      "/treino/api/treinamento/recomecar",
    );

    expect(recomecado.status).toBe(204);
    expect(await treino.prisma.venda.count()).toBe(0);
    expect(await treino.prisma.usuario.count()).toBe(3);
    expect(await treino.prisma.produto.count()).toBe(13);

    // A outra estação, com token ainda dentro do prazo, volta para a entrada
    // em vez de operar em nome de quem não existe mais.
    const depois = await chamar(
      outraEstacao.cabecalho,
      "GET",
      "/treino/api/pdv/contexto",
    );
    expect(depois.status).toBe(401);
    expect((depois.corpo["erro"] as { codigo: string }).codigo).toBe("SESSAO_INVALIDA");

    // E entra de novo com o mesmo PIN.
    const novamente = await entrarNoTreino("902", "232323");
    expect(
      (await chamar(novamente.cabecalho, "GET", "/treino/api/pdv/contexto")).status,
    ).toBe(200);
  });

  it("recomeçar não toca a loja", async () => {
    await cadastrarUsuario(container, {
      matricula: "77",
      nome: "Dona da loja",
      papel: "GERENTE",
      pin: "573914",
    });
    await chamar(undefined, "GET", "/treino/api/treinamento");
    const { cabecalho } = await entrarNoTreino();
    const antes = await container.prisma.usuario.count();

    await chamar(cabecalho, "POST", "/treino/api/treinamento/recomecar");

    expect(await container.prisma.usuario.count()).toBe(antes);
  });
});

describe("Treinamento — fora do ar ou desligado", () => {
  it("🔑 banco de treino fora do ar: o treino avisa, e a loja segue atendendo", async () => {
    const fora = await montarServidorDeTeste({
      DATABASE_URL_TREINAMENTO:
        "postgresql://erp:erp_dev_only@127.0.0.1:1/erp_fora_treino?connect_timeout=2",
    });

    try {
      const resposta = await fora.servidor.inject({
        method: "GET",
        url: "/treino/api/treinamento",
      });

      expect(resposta.statusCode).toBe(503);
      expect(
        resposta.json<{ erro: { codigo: string; mensagem: string } }>().erro,
      ).toEqual({
        codigo: "TREINAMENTO_INDISPONIVEL",
        mensagem: expect.stringContaining("O caixa de verdade não foi afetado") as string,
      });

      const saude = await fora.servidor.inject({ method: "GET", url: "/saude" });
      expect(saude.statusCode).toBe(200);
    } finally {
      await fora.servidor.close();
      await fora.container.encerrar();
      await fora.treino?.encerrar();
    }
  });

  it("🔑 treino montado por engano sobre o banco da loja: nada é gravado nem apagado", async () => {
    // O ambiente já recusa essa configuração; aqui a composição é forçada,
    // para provar a trava que mora no próprio banco.
    const ambiente = carregarAmbiente({
      NODE_ENV: "test",
      DATABASE_URL: urlBancoDeTeste(),
      SEGREDO_TOKEN: "segredo-de-teste-com-mais-de-32-caracteres",
      LIMITE_LOGIN_MINUTO: "1000",
    });
    const daLoja = montarContainer(ambiente);
    const enganado = montarContainer(ambiente, "TREINAMENTO", urlBancoDeTeste());
    const errado = await montarServidor(daLoja, enganado);

    try {
      await limparBanco(daLoja);

      // A loja recém-instalada, ainda sem ninguém: não ganha o gerente de PIN público.
      const consulta = await errado.inject({
        method: "GET",
        url: "/treino/api/treinamento",
      });
      expect(consulta.statusCode).toBe(422);
      expect(consulta.json<{ erro: { codigo: string } }>().erro.codigo).toBe(
        "BANCO_NAO_E_DE_TREINO",
      );
      expect(await daLoja.prisma.usuario.count()).toBe(0);

      // Com alguém da loja dentro, recomeçar também é recusado — e a pessoa fica.
      await cadastrarUsuario(daLoja, {
        matricula: "42",
        nome: "Maria",
        papel: "OPERADOR_CAIXA",
        pin: "482913",
      });
      const login = await errado.inject({
        method: "POST",
        url: "/treino/api/acesso/login",
        payload: {
          matricula: "42",
          segredo: "482913",
          contexto: "PDV",
          dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
        },
      });
      const { token } = login.json<{ token: string }>();

      const recomeco = await errado.inject({
        method: "POST",
        url: "/treino/api/treinamento/recomecar",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(recomeco.statusCode).toBe(422);
      expect(await daLoja.prisma.usuario.count()).toBe(1);
    } finally {
      await limparBanco(daLoja);
      await errado.close();
      await daLoja.encerrar();
      await enganado.encerrar();
    }
  });

  it("sem banco de treino, /treino não existe", async () => {
    const sem = await montarServidorDeTeste();

    try {
      const resposta = await sem.servidor.inject({
        method: "GET",
        url: "/treino/api/treinamento",
      });

      expect(resposta.statusCode).toBe(404);
      expect(sem.treino).toBeUndefined();
    } finally {
      await sem.servidor.close();
      await sem.container.encerrar();
    }
  });

  it("🔑 treino apontado para o banco da loja fica desligado, com aviso no log", async () => {
    const errado = await montarServidorDeTeste({
      DATABASE_URL_TREINAMENTO: "postgresql://erp:erp_dev_only@localhost:55432/erp_pdv",
    });
    const aviso = vi.spyOn(errado.servidor.log, "warn");

    try {
      await errado.servidor.ready();

      expect(errado.treino).toBeUndefined();
      expect(aviso).toHaveBeenCalledWith(
        { motivo: expect.stringContaining("_treino") as string },
        "treinamento desligado",
      );
    } finally {
      await errado.servidor.close();
      await errado.container.encerrar();
    }
  });
});
