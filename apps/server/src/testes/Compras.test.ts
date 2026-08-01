import { Dinheiro, Documento, Embalagem, Fornecedor, Produto } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarUsuario,
  cadastrarUsuarioComPermissoes,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
  proximoId,
} from "./apoio.js";

/**
 * Entrada de mercadoria pelo transporte real.
 *
 * O que estes casos protegem, além da autorização: a **atomicidade** entre a
 * nota e os movimentos que ela gera, e a recusa da nota lançada duas vezes —
 * que é o defeito que dobra o estoque sem ninguém notar.
 */

let servidor: FastifyInstance;
let container: Container;
let fornecedorId: string;
let produtoId: string;

const PIN_ESTOQUISTA = "550284";
const PIN_CAIXA = "884016";
const PIN_SO_ENTRADA = "112233";

let comoEstoquista: { authorization: string };

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

  const fornecedor = Fornecedor.criar({
    id: proximoId(),
    razaoSocial: "Distribuidora Central Ltda",
    documento: Documento.criar("11.222.333/0001-81").unwrap(),
  }).unwrap();

  await container.leitura.fornecedores.salvar(fornecedor);
  fornecedorId = fornecedor.id.valor;

  const produto = Produto.criar({
    id: proximoId(),
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: Dinheiro.deReais("9,90").unwrap(),
    embalagens: [Embalagem.criar("FD", 12n).unwrap()],
  }).unwrap();

  await container.leitura.produtos.salvar(produto);
  produtoId = produto.id.valor;

  await cadastrarUsuario(container, {
    matricula: "2",
    nome: "Bruno Estoquista",
    papel: "ESTOQUISTA",
    pin: PIN_ESTOQUISTA,
  });
  await cadastrarUsuario(container, {
    matricula: "4",
    nome: "Davi Caixa",
    papel: "OPERADOR_CAIXA",
    pin: PIN_CAIXA,
  });

  comoEstoquista = await autenticar("2", PIN_ESTOQUISTA);
});

async function autenticar(
  matricula: string,
  pin: string,
): Promise<{ authorization: string }> {
  const { token } = await logar(servidor, matricula, pin);
  return { authorization: `Bearer ${token}` };
}

/** Lança nota, mas não pode cancelar — a separação que a rota protege. */
async function comoSoEntrada(): Promise<{ authorization: string }> {
  await cadastrarUsuarioComPermissoes(container, {
    matricula: "8",
    nome: "Íris Conferente",
    pin: PIN_SO_ENTRADA,
    permissoes: ["estoque:entrada"],
  });

  return autenticar("8", PIN_SO_ENTRADA);
}

function nota(sobrescritas: Record<string, unknown> = {}) {
  return {
    fornecedorId,
    numero: "123456",
    serie: "1",
    emitidaEm: "2026-07-28",
    recebidaEm: "2026-07-30",
    itens: [{ produtoId, quantidade: "10000", unidade: "UN", custoUnitario: "300" }],
    totalDeclarado: "3000",
    ...sobrescritas,
  };
}

function lancar(corpo: Record<string, unknown>, headers = comoEstoquista) {
  return servidor.inject({
    method: "POST",
    url: "/api/compras/notas",
    headers,
    payload: corpo,
  });
}

async function lancada(sobrescritas: Record<string, unknown> = {}): Promise<string> {
  const resposta = await lancar(nota(sobrescritas));

  if (resposta.statusCode !== 201) {
    throw new Error(`fixture falhou: ${resposta.body}`);
  }

  return resposta.json<{ id: string }>().id;
}

function saldoAtual() {
  return container.leitura.produtos
    .porSku("REF001")
    .then((produto) =>
      produto === undefined
        ? undefined
        : container.leitura.estoque.saldo(produto.id, "UN"),
    );
}

describe("POST /api/compras/notas", () => {
  it("🔑 lança a nota e o estoque sobe junto", async () => {
    const resposta = await lancar(nota());

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ numero: "123456", total: "3000" });
    expect((await saldoAtual())?.milesimos).toBe(10_000n);
  });

  it("🔑 dinheiro e quantidade atravessam a fronteira como texto", async () => {
    const corpo = (await lancar(nota())).json<Record<string, unknown>>();

    expect(typeof corpo["total"]).toBe("string");
    const itens = corpo["itens"] as Record<string, unknown>[];
    expect(typeof itens[0]?.["quantidade"]).toBe("string");
  });

  it("🔑 recebeu 3 fardos, o estoque recebe 36 unidades", async () => {
    await lancar(
      nota({
        itens: [{ produtoId, quantidade: "3000", unidade: "FD", custoUnitario: "6000" }],
        totalDeclarado: "18000",
      }),
    );

    const saldo = await saldoAtual();
    expect(saldo?.milesimos).toBe(36_000n);
    expect(saldo?.custoMedio.centavos).toBe(500n);
  });

  it("🔑 recusa a mesma nota lançada duas vezes, sem dobrar o estoque", async () => {
    await lancada();

    const repetida = await lancar(nota());

    expect(repetida.statusCode).toBe(409);
    expect(repetida.json<{ erro: { codigo: string } }>().erro.codigo).toBe(
      "NOTA_JA_LANCADA",
    );
    expect((await saldoAtual())?.milesimos).toBe(10_000n);
  });

  it("🔑 total que não confere derruba a nota inteira, sem mover estoque", async () => {
    const resposta = await lancar(nota({ totalDeclarado: "3500" }));

    expect(resposta.statusCode).toBe(400);
    expect((await saldoAtual())?.milesimos).toBe(0n);

    const lista = await servidor.inject({
      method: "GET",
      url: "/api/compras/notas",
      headers: comoEstoquista,
    });
    expect(lista.json<{ itens: unknown[] }>().itens).toHaveLength(0);
  });

  it("🔑 a data da nota sobrevive ao fuso da loja", async () => {
    // Meia-noite UTC vira o dia anterior em todo o Brasil.
    const corpo = (await lancar(nota())).json<{ recebidaEm: string }>();

    expect(corpo.recebidaEm.slice(0, 10)).toBe("2026-07-30");
  });

  it("recusa fornecedor inexistente com 404", async () => {
    const resposta = await lancar(
      nota({ fornecedorId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999" }),
    );

    expect(resposta.statusCode).toBe(404);
  });

  it("recusa corpo malformado", async () => {
    expect((await lancar(nota({ itens: [] }))).statusCode).toBe(400);
    expect((await lancar(nota({ numero: "" }))).statusCode).toBe(400);
    expect((await lancar(nota({ emitidaEm: "28/07/2026" }))).statusCode).toBe(400);
    expect((await lancar(nota({ totalDeclarado: "30,00" }))).statusCode).toBe(400);
  });

  it("🔑 o operador de caixa não lança nota", async () => {
    const resposta = await lancar(nota(), await autenticar("4", PIN_CAIXA));

    expect(resposta.statusCode).toBe(403);
  });

  it("exige autenticação", async () => {
    expect((await lancar(nota(), { authorization: "" })).statusCode).toBe(401);
  });
});

describe("POST /api/compras/notas/:id/cancelamento", () => {
  function cancelar(id: string, motivo: string, headers = comoEstoquista) {
    return servidor.inject({
      method: "POST",
      url: `/api/compras/notas/${id}/cancelamento`,
      headers,
      payload: { motivo },
    });
  }

  it("🔑 cancela e estorna o estoque", async () => {
    const id = await lancada();

    const resposta = await cancelar(id, "Lançada em duplicidade");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ status: "CANCELADA" });
    expect((await saldoAtual())?.milesimos).toBe(0n);
  });

  it("🔑 a nota e os movimentos continuam existindo", async () => {
    // Fato é imutável: a pergunta "por que teve entrada e saída no mesmo dia"
    // precisa ter resposta seis meses depois.
    const id = await lancada();
    await cancelar(id, "Duplicada");

    const detalhe = await servidor.inject({
      method: "GET",
      url: `/api/compras/notas/${id}`,
      headers: comoEstoquista,
    });

    expect(detalhe.statusCode).toBe(200);
    expect(detalhe.json<{ itens: unknown[] }>().itens).toHaveLength(1);

    const produto = await container.leitura.produtos.porSku("REF001");
    expect(produto).toBeDefined();
    if (produto === undefined) return;

    const extrato = await servidor.inject({
      method: "GET",
      url: `/api/estoque/produtos/${produto.id.valor}/movimentos`,
      headers: comoEstoquista,
    });

    expect(
      extrato.json<{ itens: { tipo: string }[] }>().itens.map((i) => i.tipo),
    ).toEqual(["AJUSTE_NEGATIVO", "ENTRADA"]);
  });

  it("🔑 cancelar libera a numeração para o relançamento correto", async () => {
    const id = await lancada();
    await cancelar(id, "Quantidade digitada errada");

    const relancada = await lancar(
      nota({
        itens: [{ produtoId, quantidade: "20000", unidade: "UN", custoUnitario: "300" }],
        totalDeclarado: "6000",
      }),
    );

    expect(relancada.statusCode).toBe(201);
    expect((await saldoAtual())?.milesimos).toBe(20_000n);
  });

  it("🔑 quem só dá entrada não cancela — cancelar estorna estoque", async () => {
    const id = await lancada();

    const resposta = await cancelar(id, "Duplicada", await comoSoEntrada());

    expect(resposta.statusCode).toBe(403);
    expect((await saldoAtual())?.milesimos).toBe(10_000n);
  });

  it("exige motivo e recusa cancelar duas vezes", async () => {
    const id = await lancada();

    expect((await cancelar(id, "  ")).statusCode).toBe(400);
    expect((await cancelar(id, "Duplicada")).statusCode).toBe(200);
    expect((await cancelar(id, "De novo")).statusCode).toBe(422);
  });

  it("recusa nota inexistente e identificador malformado", async () => {
    expect((await cancelar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999", "x")).statusCode).toBe(
      404,
    );
    expect((await cancelar("nao-e-uuid", "x")).statusCode).toBe(400);
  });
});

describe("GET /api/compras/notas", () => {
  function listar(consulta = "", headers = comoEstoquista) {
    return servidor.inject({
      method: "GET",
      url: `/api/compras/notas${consulta}`,
      headers,
    });
  }

  it("lista com fornecedor, total recalculado e quem lançou", async () => {
    await lancada();

    const itens = listar().then(
      (resposta) => resposta.json<{ itens: Record<string, unknown>[] }>().itens,
    );

    expect(await itens).toHaveLength(1);
    expect((await itens)[0]).toMatchObject({
      numero: "123456",
      fornecedorNome: "Distribuidora Central Ltda",
      total: "3000",
      quantidadeItens: 1,
      usuarioNome: "Bruno Estoquista",
    });
  });

  it("🔑 esconde as canceladas por padrão e mostra quando pedido", async () => {
    const id = await lancada();
    await servidor.inject({
      method: "POST",
      url: `/api/compras/notas/${id}/cancelamento`,
      headers: comoEstoquista,
      payload: { motivo: "Duplicada" },
    });

    expect((await listar()).json<{ itens: unknown[] }>().itens).toHaveLength(0);

    const comCanceladas = (await listar("?incluirCanceladas=true")).json<{
      itens: { status: string; motivoCancelamento?: string }[];
    }>().itens;

    expect(comCanceladas).toHaveLength(1);
    expect(comCanceladas[0]?.status).toBe("CANCELADA");
    expect(comCanceladas[0]?.motivoCancelamento).toBe("Duplicada");
  });

  it("procura por número e por nome do fornecedor", async () => {
    await lancada();

    expect((await listar("?termo=1234")).json<{ itens: unknown[] }>().itens).toHaveLength(
      1,
    );
    expect(
      (await listar("?termo=central")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(1);
    expect(
      (await listar("?termo=inexistente")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(0);
  });

  it("filtra por fornecedor e respeita o limite", async () => {
    await lancada();

    expect(
      (await listar(`?fornecedorId=${fornecedorId}`)).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(1);
    expect((await listar("?limite=0")).statusCode).toBe(400);
  });

  it("🔑 o operador de caixa não vê as notas — elas são documento de custo", async () => {
    await lancada();

    expect((await listar("", await autenticar("4", PIN_CAIXA))).statusCode).toBe(403);
  });
});

describe("GET /api/compras/permissoes", () => {
  it("diz à tela se o botão de cancelar deve aparecer", async () => {
    const comAjuste = await servidor.inject({
      method: "GET",
      url: "/api/compras/permissoes",
      headers: comoEstoquista,
    });

    expect(comAjuste.json()).toEqual({ podeCancelar: true });

    const semAjuste = await servidor.inject({
      method: "GET",
      url: "/api/compras/permissoes",
      headers: await comoSoEntrada(),
    });

    expect(semAjuste.json()).toEqual({ podeCancelar: false });
  });
});

describe("GET /api/compras/notas/:id", () => {
  it("devolve a nota com os itens", async () => {
    const id = await lancada();

    const resposta = await servidor.inject({
      method: "GET",
      url: `/api/compras/notas/${id}`,
      headers: comoEstoquista,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<{ itens: { descricao: string }[] }>().itens[0]?.descricao).toBe(
      "Refrigerante Cola 2 Litros",
    );
  });

  it("recusa identificador malformado e devolve 404 para nota inexistente", async () => {
    const malformado = await servidor.inject({
      method: "GET",
      url: "/api/compras/notas/nao-e-uuid",
      headers: comoEstoquista,
    });
    expect(malformado.statusCode).toBe(400);

    const ausente = await servidor.inject({
      method: "GET",
      url: "/api/compras/notas/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999",
      headers: comoEstoquista,
    });
    expect(ausente.statusCode).toBe(404);
  });
});
