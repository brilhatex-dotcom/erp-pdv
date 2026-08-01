import { CodigoBarras, Dinheiro, Embalagem, Produto } from "@erp/domain";
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
 * Estoque pelo transporte real.
 *
 * O que estes casos protegem é a decisão de **quem pode o quê**: dar entrada de
 * mercadoria e baixar mercadoria são atos diferentes, e um cliente adulterado
 * que troque o tipo do movimento precisa esbarrar no servidor.
 */

let servidor: FastifyInstance;
let container: Container;
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

  const produto = Produto.criar({
    id: proximoId(),
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: Dinheiro.deReais("9,90").unwrap(),
    codigoBarras: CodigoBarras.criar("7891000315507").unwrap(),
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

/** Quem dá entrada de mercadoria mas não pode baixar nada. */
async function comoSoEntrada(): Promise<{ authorization: string }> {
  await cadastrarUsuarioComPermissoes(container, {
    matricula: "8",
    nome: "Íris Conferente",
    pin: PIN_SO_ENTRADA,
    permissoes: ["estoque:entrada"],
  });

  return autenticar("8", PIN_SO_ENTRADA);
}

function lancar(corpo: Record<string, unknown>, headers = comoEstoquista) {
  return servidor.inject({
    method: "POST",
    url: "/api/estoque/movimentos",
    headers,
    payload: corpo,
  });
}

function entrada(sobrescritas: Record<string, unknown> = {}) {
  return {
    produtoId,
    tipo: "ENTRADA",
    quantidade: "10000",
    unidade: "UN",
    ...sobrescritas,
  };
}

function saldos(consulta = "", headers = comoEstoquista) {
  return servidor.inject({
    method: "GET",
    url: `/api/estoque/saldos${consulta}`,
    headers,
  });
}

describe("POST /api/estoque/movimentos", () => {
  it("lança a entrada e o saldo passa a existir", async () => {
    const resposta = await lancar(entrada());

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ tipo: "ENTRADA", quantidade: "10000" });

    const itens = (await saldos()).json<{ itens: { milesimos: string }[] }>().itens;
    expect(itens[0]?.milesimos).toBe("10000");
  });

  it("🔑 recebeu 3 fardos, grava 36 unidades", async () => {
    const resposta = await lancar(entrada({ quantidade: "3000", unidade: "FD" }));

    expect(resposta.statusCode).toBe(201);
    // O movimento é gravado na unidade base, não na embalagem.
    expect(resposta.json()).toMatchObject({ quantidade: "36000", unidade: "UN" });
  });

  it("🔑 quantidade atravessa a fronteira como texto de milésimos", async () => {
    const corpo = (await lancar(entrada())).json<Record<string, unknown>>();

    // Peso de balança tem três casas; `number` devolveria 0.30000000000000004
    // no primeiro relatório somado.
    expect(typeof corpo["quantidade"]).toBe("string");
  });

  it("🔑 o operador de caixa não dá entrada de mercadoria", async () => {
    const resposta = await lancar(entrada(), await autenticar("4", PIN_CAIXA));

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json<{ erro: { detalhes?: unknown } }>().erro.detalhes).toEqual({
      permissaoNecessaria: "estoque:entrada",
    });
  });

  it("🔑 quem só dá entrada não lança perda", async () => {
    // Sem esta separação, a loja escolheria entre ninguém dar entrada e todo
    // mundo poder baixar mercadoria.
    const headers = await comoSoEntrada();

    expect((await lancar(entrada(), headers)).statusCode).toBe(201);

    const perda = await lancar(
      entrada({ tipo: "PERDA", observacao: "Quebrou" }),
      headers,
    );

    expect(perda.statusCode).toBe(403);
    expect(perda.json<{ erro: { detalhes?: unknown } }>().erro.detalhes).toEqual({
      permissaoNecessaria: "estoque:ajuste",
    });
  });

  it("🔑 saída manual é recusada na fronteira", async () => {
    // Saída é a venda. Lançá-la à mão seria mercadoria que sumiu do estoque sem
    // sair do caixa, indistinguível de furto na conferência do mês.
    for (const tipo of ["SAIDA", "TRANSFERENCIA_SAIDA", "TRANSFERENCIA_ENTRADA"]) {
      expect((await lancar(entrada({ tipo }))).statusCode).toBe(400);
    }
  });

  it("ajuste e perda exigem justificativa", async () => {
    const semMotivo = await lancar(entrada({ tipo: "AJUSTE_NEGATIVO" }));

    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.json<{ erro: { codigo: string } }>().erro.codigo).toBe(
      "MOVIMENTO_JUSTIFICATIVA_OBRIGATORIA",
    );

    const comMotivo = await lancar(
      entrada({ tipo: "AJUSTE_NEGATIVO", observacao: "Contagem encontrou a menos" }),
    );

    expect(comMotivo.statusCode).toBe(201);
  });

  it("🔑 o custo do fardo vira custo da unidade", async () => {
    // R$ 60,00 o fardo de 12 é R$ 5,00 a unidade.
    await lancar(entrada({ quantidade: "1000", unidade: "FD", custoUnitario: "6000" }));

    const itens = (await saldos()).json<{ itens: { custoMedio?: string }[] }>().itens;
    expect(itens[0]?.custoMedio).toBe("500");
  });

  it("🔑 o custo mandado por quem não pode vê-lo é descartado", async () => {
    const resposta = await lancar(
      entrada({ custoUnitario: "300" }),
      await comoSoEntrada(),
    );

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).not.toHaveProperty("custoUnitario");

    const produto = await container.leitura.produtos.porSku("REF001");
    expect(produto).toBeDefined();
    if (produto === undefined) return;

    const saldo = await container.leitura.estoque.saldo(produto.id, "UN");
    expect(saldo.custoMedio.ehZero()).toBe(true);
  });

  it("recusa embalagem que o produto não tem", async () => {
    const resposta = await lancar(entrada({ unidade: "CX" }));

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json<{ erro: { codigo: string } }>().erro.codigo).toBe(
      "PRODUTO_EMBALAGEM_NAO_CADASTRADA",
    );
  });

  it("recusa produto inexistente com 404", async () => {
    const resposta = await lancar(
      entrada({ produtoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999" }),
    );

    expect(resposta.statusCode).toBe(404);
  });

  it("recusa corpo malformado", async () => {
    expect((await lancar(entrada({ quantidade: "1,5" }))).statusCode).toBe(400);
    expect((await lancar(entrada({ produtoId: "nao-e-uuid" }))).statusCode).toBe(400);
    expect((await lancar(entrada({ unidade: "XX" }))).statusCode).toBe(400);
  });

  it("exige autenticação", async () => {
    expect((await lancar(entrada(), { authorization: "" })).statusCode).toBe(401);
  });
});

describe("GET /api/estoque/saldos", () => {
  it("🔑 produto sem movimento aparece zerado, não some da lista", async () => {
    // Listar só quem tem linha de saldo esconderia exatamente o item que
    // ninguém deu entrada — que é o que o lojista procura ao abrir a tela.
    const itens = (await saldos()).json<{ itens: { milesimos: string }[] }>().itens;

    expect(itens).toHaveLength(1);
    expect(itens[0]?.milesimos).toBe("0");
  });

  it("filtra por situação", async () => {
    await lancar(entrada());

    expect(
      (await saldos("?situacao=COM_SALDO")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(1);
    expect(
      (await saldos("?situacao=ZERADO")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(0);
    expect(
      (await saldos("?situacao=NEGATIVO")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(0);

    await lancar(
      entrada({ tipo: "AJUSTE_NEGATIVO", quantidade: "15000", observacao: "Sumiu" }),
    );

    expect(
      (await saldos("?situacao=NEGATIVO")).json<{ itens: { milesimos: string }[] }>()
        .itens[0]?.milesimos,
    ).toBe("-5000");
  });

  it("encontra pela descrição e pelo código bipado", async () => {
    expect((await saldos("?termo=cola")).json<{ itens: unknown[] }>().itens).toHaveLength(
      1,
    );
    expect(
      (await saldos("?termo=7891000315507")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(1);
    expect(
      (await saldos("?termo=inexistente")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(0);
  });

  it("🔑 não devolve custo médio nem valor imobilizado a quem não pode vê-los", async () => {
    await lancar(entrada({ custoUnitario: "300" }));

    const itens = (await saldos("", await autenticar("4", PIN_CAIXA))).json<{
      itens: Record<string, unknown>[];
    }>().itens;

    expect(itens[0]).not.toHaveProperty("custoMedio");
    expect(itens[0]).not.toHaveProperty("valorEmEstoque");
    // Nem escondido em outro campo: a margem da loja não sai por aqui.
    expect(JSON.stringify(itens)).not.toContain("300");
  });

  it("calcula o valor imobilizado para quem tem a permissão", async () => {
    await lancar(entrada({ custoUnitario: "300" }));

    const itens = (await saldos()).json<{ itens: Record<string, unknown>[] }>().itens;

    // 10 unidades a R$ 3,00.
    expect(itens[0]?.["valorEmEstoque"]).toBe("3000");
  });

  it("recusa limite fora da faixa e exige autenticação", async () => {
    expect((await saldos("?limite=0")).statusCode).toBe(400);
    expect((await saldos("", { authorization: "" })).statusCode).toBe(401);
  });
});

describe("GET /api/estoque/produtos/:id/movimentos", () => {
  function extrato(headers = comoEstoquista) {
    return servidor.inject({
      method: "GET",
      url: `/api/estoque/produtos/${produtoId}/movimentos`,
      headers,
    });
  }

  it("🔑 responde por que o saldo está assim", async () => {
    await lancar(entrada({ custoUnitario: "300" }));
    await lancar(entrada({ tipo: "PERDA", quantidade: "2000", observacao: "Quebrou" }));

    const itens = extratoDe(await extrato());

    // Mais recente primeiro: é o lançamento que se está conferindo agora.
    expect(itens.map((item) => item.tipo)).toEqual(["PERDA", "ENTRADA"]);
    expect(itens[0]?.efeito).toBe(-1);
    expect(itens[1]?.efeito).toBe(1);
    expect(itens[0]?.observacao).toBe("Quebrou");
  });

  it("mostra quem lançou, para a conferência ter a quem perguntar", async () => {
    await lancar(entrada());

    expect(extratoDe(await extrato())[0]?.usuarioNome).toBe("Bruno Estoquista");
  });

  it("🔑 não mostra o custo a quem não pode vê-lo", async () => {
    await lancar(entrada({ custoUnitario: "300" }));

    const itens = extratoDe(await extrato(await autenticar("4", PIN_CAIXA)));

    expect(itens[0]).not.toHaveProperty("custoUnitario");
  });

  it("produto sem movimento devolve lista vazia, não erro", async () => {
    expect(extratoDe(await extrato())).toHaveLength(0);
  });

  it("recusa identificador malformado", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/estoque/produtos/nao-e-uuid/movimentos",
      headers: comoEstoquista,
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa limite fora da faixa", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: `/api/estoque/produtos/${produtoId}/movimentos?limite=999`,
      headers: comoEstoquista,
    });

    expect(resposta.statusCode).toBe(400);
  });
});

interface ItemDoExtrato {
  readonly tipo: string;
  readonly efeito: number;
  readonly usuarioNome: string;
  readonly observacao?: string;
}

/** O tipo vem de `inject`, e não de `light-my-request`: o pacote é dependência
 *  do Fastify, não desta aplicação, e importá-lo direto amarraria o teste a uma
 *  árvore de dependências que o pnpm pode reorganizar. */
type RespostaInjetada = Awaited<ReturnType<FastifyInstance["inject"]>>;

function extratoDe(resposta: RespostaInjetada): readonly ItemDoExtrato[] {
  return resposta.json<{ itens: ItemDoExtrato[] }>().itens;
}
