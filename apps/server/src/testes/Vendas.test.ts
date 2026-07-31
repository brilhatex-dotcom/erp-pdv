import { Dinheiro, Identificador, SessaoCaixa } from "@erp/domain";
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
  proximoId,
} from "./apoio.js";

/**
 * Rotas de venda, ponta a ponta contra o Postgres real.
 *
 * É o caminho que o PDV vai percorrer a cada atendimento, e o único lugar onde
 * a corrente inteira se prova: token → permissão decidida no servidor → caso de
 * uso → transação → banco. Dublê em qualquer elo aqui esconderia justamente o
 * que costuma quebrar.
 */

const ESTACAO = proximoId();

let servidor: FastifyInstance;
let container: Container;

beforeAll(async () => {
  prepararBanco();
  ({ servidor, container } = await montarServidorDeTeste());
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
});

beforeEach(async () => {
  await limparBanco(container);
});

/** Caixa aberto na estação: sem ele não existe venda (regra do domínio). */
async function abrirCaixa(operadorId: ReturnType<typeof proximoId>): Promise<void> {
  const sessao = SessaoCaixa.abrir({
    id: proximoId(),
    estacaoId: ESTACAO,
    operadorId,
    fundoTroco: Dinheiro.deReais("100,00").unwrap(),
    abertaEm: new Date(),
  }).unwrap();

  await container.leitura.caixas.salvar(sessao);
}

/** Operador autenticado, com caixa aberto e um produto no catálogo. */
async function balcaoPronto(): Promise<{ token: string; codigoBarras: string }> {
  const usuario = await cadastrarUsuario(container, {
    matricula: "42",
    nome: "Maria da Silva",
    papel: "OPERADOR_CAIXA",
    pin: "482913",
  });

  await abrirCaixa(usuario.id);
  const produto = await cadastrarProduto(container);

  const { token } = await logar(servidor, "42", "482913");

  return { token, codigoBarras: produto.codigoBarras?.valor ?? "" };
}

function comToken(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("fluxo de venda", () => {
  it("🔑 vai da abertura ao fechamento, com os totais batendo", async () => {
    const { token, codigoBarras } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    expect(aberta.statusCode).toBe(201);
    const venda = aberta.json<{ id: string; numero: number; total: string }>();
    expect(venda.numero).toBe(1);
    expect(venda.total).toBe("0");

    const item = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${venda.id}/itens`,
      headers: comToken(token),
      payload: { codigo: codigoBarras },
    });

    expect(item.statusCode).toBe(201);
    // A resposta traz o item **e** a venda: é o que poupa uma ida ao servidor
    // por bipada no caminho quente do PDV.
    const registrado = item.json<{
      item: { total: string };
      venda: { total: string; faltaPagar: string };
    }>();
    expect(registrado.item.total).toBe("990");
    expect(registrado.venda.total).toBe("990");
    expect(registrado.venda.faltaPagar).toBe("990");

    const pagamento = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${venda.id}/pagamentos`,
      headers: comToken(token),
      payload: { forma: "DINHEIRO", valor: "1000" },
    });

    expect(pagamento.statusCode).toBe(201);
    expect(pagamento.json<{ faltaPagar: string; troco: string }>()).toMatchObject({
      faltaPagar: "0",
      troco: "10",
    });

    const finalizada = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${venda.id}/finalizar`,
      headers: comToken(token),
      payload: {},
    });

    expect(finalizada.statusCode).toBe(200);
    expect(finalizada.json<{ status: string; troco: string }>()).toMatchObject({
      status: "FINALIZADA",
      troco: "10",
    });
  });

  it("🔑 atribui a venda a quem está autenticado, não a quem o corpo disser", async () => {
    // Aceitar `operadorId` do corpo permitiria a qualquer estação lançar venda
    // no nome de outra pessoa — e a auditoria apontaria quem não vendeu, o que
    // é pior que não auditar, porque parece prova.
    const { token } = await balcaoPronto();
    const outroOperador = proximoId();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor, operadorId: outroOperador.valor },
    });

    expect(aberta.statusCode).toBe(201);

    const gravada = await container.leitura.vendas.porId(
      Identificador.criar(aberta.json<{ id: string }>().id).unwrap(),
    );

    expect(gravada?.operadorId.valor).not.toBe(outroOperador.valor);
  });

  it("aceita venda identificada ao cliente", async () => {
    // É o que sustenta crediário e histórico de compra — e no varejo alvo o
    // crediário é a diferença entre ter e não ter a venda.
    const { token } = await balcaoPronto();
    const cliente = proximoId();

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor, clienteId: cliente.valor },
    });

    expect(resposta.statusCode).toBe(201);
  });

  it("guarda parcelas e autorização do cartão", async () => {
    // A autorização da maquininha é o que permite conciliar a venda com o
    // extrato da adquirente; sem ela, divergência no fim do mês não tem como
    // ser rastreada.
    const { token, codigoBarras } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });
    const vendaId = aberta.json<{ id: string }>().id;

    await servidor.inject({
      method: "POST",
      url: `/api/vendas/${vendaId}/itens`,
      headers: comToken(token),
      payload: { codigo: codigoBarras },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${vendaId}/pagamentos`,
      headers: comToken(token),
      payload: {
        forma: "CARTAO_CREDITO",
        valor: "990",
        parcelas: 3,
        autorizacao: "AUT123456",
      },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json<{ parcelas: number }>().parcelas).toBe(3);
  });

  it("recusa venda sem caixa aberto, com mensagem acionável", async () => {
    await cadastrarUsuario(container, {
      matricula: "42",
      nome: "Maria da Silva",
      papel: "OPERADOR_CAIXA",
      pin: "482913",
    });

    const { token } = await logar(servidor, "42", "482913");

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    // 422: a API entendeu o pedido e a regra recusou. 400 diria que o PDV
    // mandou algo errado, e mandaria o desenvolvedor procurar no lugar errado.
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json<{ erro: { mensagem: string } }>().erro.mensagem).toContain(
      "Abra o caixa",
    );
  });
});

describe("porta fechada", () => {
  it("🔑 recusa sem token", async () => {
    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      payload: { estacaoId: ESTACAO.valor },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it("🔑 recusa quem não tem venda:criar, mesmo autenticado", async () => {
    await cadastrarUsuario(container, {
      matricula: "9",
      nome: "Carlos Contador",
      papel: "CONTADOR",
      pin: "482913",
      senha: "conferencia mensal 2026",
    });

    const { token } = await logar(servidor, "9", "conferencia mensal 2026", "RETAGUARDA");

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    expect(resposta.statusCode).toBe(403);
  });
});

describe("entrada malformada", () => {
  it("recusa venda sem estação", async () => {
    const { token } = await balcaoPronto();

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: {},
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("responde 404 para venda inexistente", async () => {
    const { token, codigoBarras } = await balcaoPronto();

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${proximoId().valor}/itens`,
      headers: comToken(token),
      payload: { codigo: codigoBarras },
    });

    expect(resposta.statusCode).toBe(404);
  });

  it("recusa identificador de venda que não é UUID", async () => {
    const { token, codigoBarras } = await balcaoPronto();

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/vendas/nao-e-uuid/itens",
      headers: comToken(token),
      payload: { codigo: codigoBarras },
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa identificador inválido em pagamento e em finalização", async () => {
    // Cada rota valida o próprio parâmetro: confiar em que a anterior já
    // validou é como uma delas passa a aceitar lixo depois de uma refatoração.
    const { token } = await balcaoPronto();

    for (const caminho of ["pagamentos", "finalizar"]) {
      const resposta = await servidor.inject({
        method: "POST",
        url: `/api/vendas/nao-e-uuid/${caminho}`,
        headers: comToken(token),
        payload: { forma: "DINHEIRO", valor: "100" },
      });

      expect(resposta.statusCode).toBe(400);
    }
  });

  it("recusa pagamento sem forma nem valor", async () => {
    const { token } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${aberta.json<{ id: string }>().id}/pagamentos`,
      headers: comToken(token),
      payload: {},
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa item sem código", async () => {
    const { token } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${aberta.json<{ id: string }>().id}/itens`,
      headers: comToken(token),
      payload: {},
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("🔑 recusa unidade desconhecida em vez de assumir uma", async () => {
    // Adivinhar "UN" para uma etiqueta de quilo faria a balança cobrar por peça.
    const { token, codigoBarras } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${aberta.json<{ id: string }>().id}/itens`,
      headers: comToken(token),
      payload: {
        codigo: codigoBarras,
        quantidade: { milesimos: "1500", unidade: "XYZ" },
      },
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("aceita quantidade explícita na unidade do produto", async () => {
    const { token, codigoBarras } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${aberta.json<{ id: string }>().id}/itens`,
      headers: comToken(token),
      payload: { codigo: codigoBarras, quantidade: { milesimos: "3000", unidade: "UN" } },
    });

    expect(resposta.statusCode).toBe(201);
    // 3 × R$ 9,90.
    expect(resposta.json<{ item: { total: string } }>().item.total).toBe("2970");
  });

  it("recusa forma de pagamento desconhecida", async () => {
    const { token } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${aberta.json<{ id: string }>().id}/pagamentos`,
      headers: comToken(token),
      payload: { forma: "PIX_CRIPTO", valor: "100" },
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("🔑 recusa valor de pagamento fracionário", async () => {
    // Quem manda reais onde se espera centavos tem um defeito; aceitar em
    // silêncio erraria o preço por um fator de cem.
    const { token } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${aberta.json<{ id: string }>().id}/pagamentos`,
      headers: comToken(token),
      payload: { forma: "DINHEIRO", valor: "9.90" },
    });

    expect(resposta.statusCode).toBe(400);
  });
});

describe("pagamento parcial", () => {
  it("informa quanto falta a cada parcela recebida", async () => {
    // É o número que a tela mostra em seguida, e o que o operador lê em voz
    // alta para o cliente.
    const { token, codigoBarras } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });
    const vendaId = aberta.json<{ id: string }>().id;

    await servidor.inject({
      method: "POST",
      url: `/api/vendas/${vendaId}/itens`,
      headers: comToken(token),
      payload: { codigo: codigoBarras },
    });

    const primeiro = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${vendaId}/pagamentos`,
      headers: comToken(token),
      payload: { forma: "DINHEIRO", valor: "500" },
    });

    expect(primeiro.json<{ faltaPagar: string; troco: string }>()).toMatchObject({
      faltaPagar: "490",
      troco: "0",
    });

    const segundo = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${vendaId}/pagamentos`,
      headers: comToken(token),
      payload: { forma: "CARTAO_DEBITO", valor: "490" },
    });

    expect(segundo.json<{ faltaPagar: string }>().faltaPagar).toBe("0");
  });

  it("🔑 recusa finalizar antes de o pagamento fechar", async () => {
    const { token, codigoBarras } = await balcaoPronto();

    const aberta = await servidor.inject({
      method: "POST",
      url: "/api/vendas",
      headers: comToken(token),
      payload: { estacaoId: ESTACAO.valor },
    });
    const vendaId = aberta.json<{ id: string }>().id;

    await servidor.inject({
      method: "POST",
      url: `/api/vendas/${vendaId}/itens`,
      headers: comToken(token),
      payload: { codigo: codigoBarras },
    });

    const resposta = await servidor.inject({
      method: "POST",
      url: `/api/vendas/${vendaId}/finalizar`,
      headers: comToken(token),
      payload: {},
    });

    expect(resposta.statusCode).toBe(422);
  });
});
