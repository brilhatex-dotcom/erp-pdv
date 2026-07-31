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

let servidor: FastifyInstance;
let container: Container;
let cabecalho: { authorization: string };

const ESTACAO = "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9001";
const PIN = "419273";

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
    matricula: "1",
    nome: "Ana Gerente",
    papel: "GERENTE",
    pin: PIN,
  });
  cabecalho = { authorization: `Bearer ${(await logar(servidor, "1", PIN)).token}` };

  // A venda offline entra no caixa aberto da estação, como qualquer venda.
  await servidor.inject({
    method: "POST",
    url: "/api/caixa/abrir",
    headers: cabecalho,
    payload: { estacaoId: ESTACAO, fundoTroco: "10000" },
  });
});

function vendaOffline(chave: string, extras: Record<string, unknown> = {}) {
  return {
    chave,
    estacaoId: ESTACAO,
    registradaEm: "2026-07-31T13:59:00.000Z",
    itens: [{ codigo: "REF001" }],
    pagamentos: [{ forma: "DINHEIRO", valor: "990" }],
    ...extras,
  };
}

function importar(corpo: Record<string, unknown>) {
  return servidor.inject({
    method: "POST",
    url: "/api/sincronizacao/vendas",
    headers: cabecalho,
    payload: corpo,
  });
}

describe("Importação de venda offline", () => {
  it("cria a venda e devolve o identificador do servidor", async () => {
    const resposta = await importar(vendaOffline("estacao-1-venda-0001"));

    expect(resposta.statusCode).toBe(201);

    const corpo = resposta.json<{ jaExistia: boolean; vendaId: string }>();
    expect(corpo.jaExistia).toBe(false);
    expect(corpo.vendaId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("🔑 reenviar a mesma venda NÃO cria uma segunda", async () => {
    // A resposta pode se perder na rede depois de o servidor ter gravado. Sem
    // esta garantia, o reenvio duplicaria a venda e o fechamento de caixa
    // acusaria dinheiro que não existe.
    const primeira = await importar(vendaOffline("estacao-1-venda-0001"));
    const segunda = await importar(vendaOffline("estacao-1-venda-0001"));

    expect(segunda.statusCode).toBe(200);
    expect(segunda.json<{ jaExistia: boolean }>().jaExistia).toBe(true);
    expect(segunda.json<{ vendaId: string }>().vendaId).toBe(
      primeira.json<{ vendaId: string }>().vendaId,
    );

    const quantas = await container.prisma.venda.count();
    expect(quantas).toBe(1);
  });

  it("🔑 reenvio com o conteúdo alterado também não cria outra", async () => {
    // A chave é o que decide, não o corpo: uma estação que reenvie com um item
    // a mais por defeito não deve conseguir gravar duas vendas.
    await importar(vendaOffline("estacao-1-venda-0001"));

    const alterada = await importar(
      vendaOffline("estacao-1-venda-0001", {
        pagamentos: [{ forma: "DINHEIRO", valor: "99900" }],
      }),
    );

    expect(alterada.json<{ jaExistia: boolean }>().jaExistia).toBe(true);
    expect(await container.prisma.venda.count()).toBe(1);
  });

  it("chaves diferentes criam vendas diferentes", async () => {
    await importar(vendaOffline("estacao-1-venda-0001"));
    await importar(vendaOffline("estacao-1-venda-0002"));

    expect(await container.prisma.venda.count()).toBe(2);
  });

  it("aceita venda com quantidade pesada", async () => {
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0003", {
        itens: [{ codigo: "REF001", quantidade: { milesimos: "2000", unidade: "UN" } }],
        pagamentos: [{ forma: "DINHEIRO", valor: "1980" }],
      }),
    );

    expect(resposta.statusCode).toBe(201);
  });

  it("aceita venda dividida em duas formas", async () => {
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0004", {
        pagamentos: [
          { forma: "DINHEIRO", valor: "500" },
          { forma: "PIX", valor: "490" },
        ],
      }),
    );

    expect(resposta.statusCode).toBe(201);
  });
});

describe("Recusas", () => {
  it("corpo malformado é 400", async () => {
    for (const corpo of [
      {},
      vendaOffline("curta".slice(0, 3)),
      vendaOffline("estacao-1-venda-0005", { itens: [] }),
      vendaOffline("estacao-1-venda-0006", { pagamentos: [] }),
      vendaOffline("estacao-1-venda-0007", { estacaoId: "não-é-uuid" }),
      vendaOffline("estacao-1-venda-0008", { registradaEm: "ontem" }),
    ]) {
      expect((await importar(corpo)).statusCode).toBe(400);
    }
  });

  it("🔑 produto que não existe mais é recusado, não ignorado", async () => {
    // A estação vendeu com a réplica antiga. Ignorar o item faria a venda
    // entrar com valor menor que o cobrado do cliente.
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0009", { itens: [{ codigo: "SUMIU" }] }),
    );

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    expect(resposta.statusCode).toBeLessThan(500);
    expect(await container.prisma.vendaImportada.count()).toBe(0);
  });

  it("forma de pagamento desconhecida é recusada", async () => {
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0010", {
        pagamentos: [{ forma: "BITCOIN", valor: "990" }],
      }),
    );

    expect(resposta.statusCode).toBe(400);
  });

  it("unidade inexistente é recusada sem derrubar o servidor", async () => {
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0011", {
        itens: [{ codigo: "REF001", quantidade: { milesimos: "1000", unidade: "XYZ" } }],
      }),
    );

    expect(resposta.statusCode).toBe(400);
  });

  it("🔑 venda recusada não deixa marca de importada — o reenvio segue possível", async () => {
    // Gravar a marca antes de a venda existir bloquearia para sempre uma venda
    // que nunca chegou a ser criada.
    await importar(
      vendaOffline("estacao-1-venda-0012", { itens: [{ codigo: "SUMIU" }] }),
    );

    expect(await container.prisma.vendaImportada.count()).toBe(0);
  });

  it("sem autenticação não entra nada", async () => {
    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/sincronizacao/vendas",
      payload: vendaOffline("estacao-1-venda-0013"),
    });

    expect(resposta.statusCode).toBe(401);
  });

  it("🔑 o operador vem do token, não do corpo", async () => {
    // Aceitar `operadorId` na requisição permitiria atribuir a venda a outra
    // pessoa, e a auditoria passaria a apontar quem não vendeu.
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0014", {
        operadorId: "018f3a2b-7c1d-7e4f-8a9b-000000000099",
      }),
    );

    expect(resposta.statusCode).toBe(201);

    const venda = await container.prisma.venda.findFirst();
    expect(venda?.operadorId).not.toBe("018f3a2b-7c1d-7e4f-8a9b-000000000099");
  });
});

describe("Abertura de caixa pela API", () => {
  it("🔑 existe rota para abrir o caixa — sem ela o PDV não vende", async () => {
    // `IniciarVenda` exige sessão aberta. Enquanto esta rota não existiu, o
    // caixa só podia ser aberto por dentro do banco.
    const outraEstacao = "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9002";

    const aberto = await servidor.inject({
      method: "POST",
      url: "/api/caixa/abrir",
      headers: cabecalho,
      payload: { estacaoId: outraEstacao, fundoTroco: "10000" },
    });

    expect(aberto.statusCode).toBe(201);
    expect(aberto.json<{ fundoTroco: string }>().fundoTroco).toBe("10000");
  });

  it("🔑 recusa o segundo caixa na mesma estação", async () => {
    // Duas gavetas abertas duplicariam o fundo de troco, e o fechamento
    // acusaria sobra que não existe.
    const repetido = await servidor.inject({
      method: "POST",
      url: "/api/caixa/abrir",
      headers: cabecalho,
      payload: { estacaoId: ESTACAO, fundoTroco: "5000" },
    });

    expect(repetido.statusCode).toBe(409);
  });

  it("consultar sem caixa aberto responde 204, não 404", async () => {
    // "Ainda não abriu" é resposta legítima do começo do dia, não recurso que
    // sumiu — é assim que o PDV escolhe entre a tela de abertura e a de venda.
    const semCaixa = await servidor.inject({
      method: "GET",
      url: "/api/caixa/aberto?estacaoId=018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9003",
      headers: cabecalho,
    });

    expect(semCaixa.statusCode).toBe(204);

    const comCaixa = await servidor.inject({
      method: "GET",
      url: `/api/caixa/aberto?estacaoId=${ESTACAO}`,
      headers: cabecalho,
    });

    expect(comCaixa.statusCode).toBe(200);
    expect(comCaixa.json<{ quantidadeVendas: number }>().quantidadeVendas).toBe(0);
  });

  it("entrada inválida é 400", async () => {
    for (const payload of [
      {},
      { estacaoId: "x", fundoTroco: "1" },
      { estacaoId: ESTACAO, fundoTroco: "10,00" },
    ]) {
      const resposta = await servidor.inject({
        method: "POST",
        url: "/api/caixa/abrir",
        headers: cabecalho,
        payload,
      });
      expect(resposta.statusCode).toBe(400);
    }

    const consulta = await servidor.inject({
      method: "GET",
      url: "/api/caixa/aberto?estacaoId=xpto",
      headers: cabecalho,
    });
    expect(consulta.statusCode).toBe(400);
  });

  it("sem autenticação, nada", async () => {
    for (const rota of [
      { method: "POST" as const, url: "/api/caixa/abrir" },
      { method: "GET" as const, url: `/api/caixa/aberto?estacaoId=${ESTACAO}` },
    ]) {
      expect((await servidor.inject({ ...rota, payload: {} })).statusCode).toBe(401);
    }
  });
});

describe("Recusas vindas do domínio", () => {
  it("🔑 venda offline de estação sem caixa aberto é recusada, e pode ser reenviada", async () => {
    // Cenário real: o servidor ficou fora do ar até depois do fechamento. A
    // venda não entra — mas também não vira marca de importada, então continua
    // reenviável depois que o caixa reabrir.
    const semCaixa = "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9009";

    const resposta = await importar(
      vendaOffline("estacao-9-venda-0001", { estacaoId: semCaixa }),
    );

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    expect(resposta.statusCode).toBeLessThan(500);
    expect(await container.prisma.vendaImportada.count()).toBe(0);
  });

  it("forma de pagamento com parcelas onde não cabe é recusada", async () => {
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0020", {
        pagamentos: [{ forma: "DINHEIRO", valor: "990", parcelas: 3 }],
      }),
    );

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    expect(resposta.statusCode).toBeLessThan(500);
  });

  it("venda paga a menos não finaliza", async () => {
    const resposta = await importar(
      vendaOffline("estacao-1-venda-0021", {
        pagamentos: [{ forma: "DINHEIRO", valor: "100" }],
      }),
    );

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    expect(resposta.statusCode).toBeLessThan(500);
    expect(await container.prisma.vendaImportada.count()).toBe(0);
  });
});
