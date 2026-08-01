import { Categoria } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarProduto,
  cadastrarUsuario,
  cadastrarUsuarioComPermissoes,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
  proximoId,
} from "./apoio.js";

/**
 * Cadastro de produto pelo transporte real.
 *
 * O que estes casos protegem não é o formato do JSON: é a decisão de
 * autorização, que **acontece no servidor**. Um cliente adulterado que mande
 * `custo` ou `precoVenda` sem ter a permissão precisa esbarrar aqui, e não na
 * interface — que ele controla.
 */

let servidor: FastifyInstance;
let container: Container;

const PIN_GERENTE = "419273";
const PIN_ESTOQUISTA = "550284";
const PIN_SUPERVISOR = "731905";
const PIN_CAIXA = "884016";

let comoGerente: { authorization: string };

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

  await cadastrarUsuario(container, {
    matricula: "1",
    nome: "Ana Gerente",
    papel: "GERENTE",
    pin: PIN_GERENTE,
  });
  await cadastrarUsuario(container, {
    matricula: "2",
    nome: "Bruno Estoquista",
    papel: "ESTOQUISTA",
    pin: PIN_ESTOQUISTA,
  });
  await cadastrarUsuario(container, {
    matricula: "3",
    nome: "Célia Supervisora",
    papel: "SUPERVISOR",
    pin: PIN_SUPERVISOR,
  });
  await cadastrarUsuario(container, {
    matricula: "4",
    nome: "Davi Caixa",
    papel: "OPERADOR_CAIXA",
    pin: PIN_CAIXA,
  });

  comoGerente = await autenticar("1", PIN_GERENTE);
});

async function autenticar(
  matricula: string,
  pin: string,
): Promise<{ authorization: string }> {
  const { token } = await logar(servidor, matricula, pin);
  return { authorization: `Bearer ${token}` };
}

const PIN_SEM_CUSTO = "290371";

/**
 * Alguém que cadastra e edita produto **sem** poder ver custo.
 *
 * Não está entre os papéis de fábrica de propósito — é a combinação que a loja
 * monta quando põe um balconista para cadastrar produto novo, e é justamente
 * ela que revela se o custo vaza na resposta ou é zerado na gravação.
 */
async function comoSemCusto(): Promise<{ authorization: string }> {
  await cadastrarUsuarioComPermissoes(container, {
    matricula: "9",
    nome: "Eva Balconista",
    pin: PIN_SEM_CUSTO,
    permissoes: ["produto:criar", "produto:editar"],
  });

  return autenticar("9", PIN_SEM_CUSTO);
}

const NOVO = {
  sku: "REF001",
  descricao: "Refrigerante Cola 2 Litros",
  tipo: "UNITARIO",
  unidadeBase: "UN",
  precoVenda: "990",
  custo: "650",
};

function criar(corpo: Record<string, unknown>, headers = comoGerente) {
  return servidor.inject({
    method: "POST",
    url: "/api/produtos",
    headers,
    payload: corpo,
  });
}

function alterar(id: string, corpo: Record<string, unknown>, headers = comoGerente) {
  return servidor.inject({
    method: "PUT",
    url: `/api/produtos/${id}`,
    headers,
    payload: corpo,
  });
}

async function criado(sobrescritas: Record<string, unknown> = {}): Promise<string> {
  const resposta = await criar({ ...NOVO, ...sobrescritas });

  if (resposta.statusCode !== 201) {
    throw new Error(`fixture falhou: ${resposta.body}`);
  }

  return resposta.json<{ id: string }>().id;
}

describe("POST /api/produtos", () => {
  it("cadastra e devolve 201 com o produto gravado", async () => {
    const resposta = await criar(NOVO);

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({
      sku: "REF001",
      precoVenda: "990",
      custo: "650",
      ativo: true,
    });

    expect(await container.leitura.produtos.porSku("REF001")).toBeDefined();
  });

  it("🔑 dinheiro atravessa a fronteira como texto de centavos", async () => {
    const corpo = (await criar(NOVO)).json<Record<string, unknown>>();

    // `JSON.parse` transforma número em `double`, e o centavo some no
    // fechamento do caixa (ADR-0019).
    expect(typeof corpo["precoVenda"]).toBe("string");
    expect(typeof corpo["custo"]).toBe("string");
  });

  it("🔑 recusa quem não tem produto:criar", async () => {
    const resposta = await criar(NOVO, await autenticar("4", PIN_CAIXA));

    expect(resposta.statusCode).toBe(403);
  });

  it("exige autenticação", async () => {
    const resposta = await criar(NOVO, { authorization: "" });

    expect(resposta.statusCode).toBe(401);
  });

  it("cadastra o produto de autopeças com referências", async () => {
    const resposta = await criar({
      ...NOVO,
      sku: "VELA-F7",
      descricao: "Vela de Ignição",
      referencias: [{ tipo: "ORIGINAL", valor: "90919-01210" }],
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json<{ referencias: unknown[] }>().referencias).toHaveLength(1);
  });

  it("cadastra o produto do depósito com embalagem, e o fator volta em texto", async () => {
    const resposta = await criar({
      ...NOVO,
      embalagens: [{ unidade: "FD", fator: "12" }],
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json<{ embalagens: { fator: unknown }[] }>().embalagens[0]).toEqual({
      unidade: "FD",
      fator: "12",
      codigoBarras: undefined,
    });
  });

  it("cadastra o pesável do açougue com código de balança", async () => {
    const resposta = await criar({
      ...NOVO,
      sku: "PIC001",
      descricao: "Picanha Bovina",
      tipo: "PESAVEL",
      unidadeBase: "KG",
      codigoBalanca: "421",
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ tipo: "PESAVEL", codigoBalanca: "421" });
  });

  it("aceita a categoria existente", async () => {
    const categoria = Categoria.criar({ id: proximoId(), nome: "Bebidas" }).unwrap();
    await container.leitura.categorias.salvar(categoria);

    const resposta = await criar({ ...NOVO, categoriaId: categoria.id.valor });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ categoriaId: categoria.id.valor });
  });

  it("recusa SKU repetido com 409 e diz de quem ele é", async () => {
    await criado();

    const resposta = await criar({ ...NOVO, descricao: "Outro produto" });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json<{ erro: { mensagem: string } }>().erro.mensagem).toContain(
      "Refrigerante Cola 2 Litros",
    );
  });

  it("recusa corpo sem descrição com 400", async () => {
    const resposta = await criar({ ...NOVO, descricao: "" });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa categoria que não é identificador", async () => {
    const resposta = await criar({ ...NOVO, categoriaId: "nao-e-uuid" });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa categoria inexistente com mensagem de operador", async () => {
    const resposta = await criar({
      ...NOVO,
      categoriaId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999",
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json<{ erro: { mensagem: string } }>().erro.mensagem).not.toContain(
      "constraint",
    );
  });

  it("🔑 devolve a lista de erros do formulário, não só o primeiro", async () => {
    const resposta = await criar({
      ...NOVO,
      codigoBarras: "7891000100104",
      embalagens: [{ unidade: "CX", fator: "1" }],
    });

    expect(resposta.statusCode).toBe(400);

    const erro = resposta.json<{
      erro: { codigo: string; detalhes?: { erros?: unknown[] } };
    }>().erro;

    // Sem isto, quem cadastra cem itens corrige um campo por gravação.
    expect(erro.codigo).toBe("DADOS_INVALIDOS");
    expect(erro.detalhes?.erros).toHaveLength(2);
  });

  it("🔑 ignora o custo mandado por quem não pode vê-lo", async () => {
    const resposta = await criar(NOVO, await comoSemCusto());

    expect(resposta.statusCode).toBe(201);
    // Aceitar o número seria confiar num campo que a tela dele nem mostra —
    // e é por aí que alguém grava uma margem que não deveria conhecer.
    expect(resposta.json()).not.toHaveProperty("custo");
    expect((await container.leitura.produtos.porSku("REF001"))?.custo.ehZero()).toBe(
      true,
    );
  });
});

describe("PUT /api/produtos/:id", () => {
  it("altera descrição e preço", async () => {
    const id = await criado();

    const resposta = await alterar(id, {
      ...NOVO,
      descricao: "Refrigerante Cola 2L Retornável",
      precoVenda: "1090",
      ativo: true,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      descricao: "Refrigerante Cola 2L Retornável",
      precoVenda: "1090",
    });
  });

  it("🔑 recusa mudança de preço de quem não tem produto:alterar_preco", async () => {
    const id = await criado();

    // O estoquista cadastra e edita produto, mas não decide margem.
    const resposta = await alterar(
      id,
      { ...NOVO, precoVenda: "1090", ativo: true },
      await autenticar("2", PIN_ESTOQUISTA),
    );

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json<{ erro: { codigo: string } }>().erro.codigo).toBe(
      "SEM_PERMISSAO_PARA_PRECO",
    );
  });

  it("🔑 deixa o estoquista corrigir a descrição devolvendo o mesmo preço", async () => {
    const id = await criado();

    const resposta = await alterar(
      id,
      { ...NOVO, descricao: "Refrigerante Cola 2L Garrafa", ativo: true },
      await autenticar("2", PIN_ESTOQUISTA),
    );

    expect(resposta.statusCode).toBe(200);
  });

  it("🔑 preserva o custo quando quem salva não pode vê-lo", async () => {
    const id = await criado();

    const resposta = await alterar(
      id,
      // O formulário dele não traz o campo — e não pode zerar a margem da loja.
      { ...NOVO, custo: undefined, ativo: true },
      await comoSemCusto(),
    );

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).not.toHaveProperty("custo");

    const gravado = await container.leitura.produtos.porSku("REF001");
    expect(gravado?.custo.centavos).toBe(650n);
  });

  it("🔑 descarta o custo que veio de quem não pode vê-lo", async () => {
    const id = await criado();

    // Cliente adulterado mandando o campo que a tela dele não mostra.
    const resposta = await alterar(
      id,
      { ...NOVO, custo: "1", ativo: true },
      await comoSemCusto(),
    );

    expect(resposta.statusCode).toBe(200);
    expect((await container.leitura.produtos.porSku("REF001"))?.custo.centavos).toBe(
      650n,
    );
  });

  it("desativa sem apagar", async () => {
    const id = await criado();

    const resposta = await alterar(id, { ...NOVO, ativo: false });

    expect(resposta.json()).toMatchObject({ ativo: false });
    expect(await container.leitura.produtos.porSku("REF001")).toBeDefined();
  });

  it("recusa identificador malformado", async () => {
    const resposta = await alterar("nao-e-uuid", { ...NOVO, ativo: true });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa produto inexistente com 404", async () => {
    const resposta = await alterar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999", {
      ...NOVO,
      ativo: true,
    });

    expect(resposta.statusCode).toBe(404);
  });

  it("recusa corpo sem o campo ativo", async () => {
    const id = await criado();

    const resposta = await alterar(id, NOVO);

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa quem não tem produto:editar", async () => {
    const id = await criado();

    const resposta = await alterar(
      id,
      { ...NOVO, ativo: true },
      await autenticar("4", PIN_CAIXA),
    );

    expect(resposta.statusCode).toBe(403);
  });
});

describe("PUT /api/produtos/:id/preco", () => {
  function mudarPreco(id: string, precoVenda: string, headers = comoGerente) {
    return servidor.inject({
      method: "PUT",
      url: `/api/produtos/${id}/preco`,
      headers,
      payload: { precoVenda },
    });
  }

  it("🔑 deixa o supervisor acertar a etiqueta sem poder editar o cadastro", async () => {
    const id = await criado();
    const comoSupervisor = await autenticar("3", PIN_SUPERVISOR);

    const resposta = await mudarPreco(id, "490", comoSupervisor);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ precoVenda: "490" });

    // E continua sem poder mexer no resto.
    const cadastro = await alterar(id, { ...NOVO, ativo: true }, comoSupervisor);
    expect(cadastro.statusCode).toBe(403);
  });

  it("não expõe o custo a quem não pode vê-lo", async () => {
    const id = await criado();

    const resposta = await mudarPreco(id, "490", await autenticar("3", PIN_SUPERVISOR));

    expect(resposta.json()).not.toHaveProperty("custo");
  });

  it("recusa o operador de caixa", async () => {
    const id = await criado();

    const resposta = await mudarPreco(id, "490", await autenticar("4", PIN_CAIXA));

    expect(resposta.statusCode).toBe(403);
  });

  it("recusa preço malformado", async () => {
    const id = await criado();

    const resposta = await mudarPreco(id, "4,90");

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa identificador malformado", async () => {
    expect((await mudarPreco("nao-e-uuid", "490")).statusCode).toBe(400);
  });

  it("recusa produto inexistente", async () => {
    const resposta = await mudarPreco("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999", "490");

    expect(resposta.statusCode).toBe(404);
  });
});

describe("GET /api/produtos", () => {
  function listar(consulta = "", headers = comoGerente) {
    return servidor.inject({ method: "GET", url: `/api/produtos${consulta}`, headers });
  }

  it("lista os produtos", async () => {
    await criado();

    const resposta = await listar();

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<{ itens: unknown[] }>().itens).toHaveLength(1);
  });

  it("encontra por parte da descrição, sem acento e sem caixa", async () => {
    await criado({ sku: "PAO001", descricao: "Pão Francês" });
    await criado();

    const resposta = await listar("?termo=pao");

    expect(resposta.json<{ itens: { sku: string }[] }>().itens.map((i) => i.sku)).toEqual(
      ["PAO001"],
    );
  });

  it("encontra pelo código de barras bipado", async () => {
    await criado({ codigoBarras: "7891000315507" });

    const resposta = await listar("?termo=7891000315507");

    expect(resposta.json<{ itens: unknown[] }>().itens).toHaveLength(1);
  });

  it("esconde os inativos por padrão e mostra quando pedido", async () => {
    const id = await criado();
    await alterar(id, { ...NOVO, ativo: false });

    expect((await listar()).json<{ itens: unknown[] }>().itens).toHaveLength(0);
    expect(
      (await listar("?apenasAtivos=false")).json<{ itens: unknown[] }>().itens,
    ).toHaveLength(1);
  });

  it("🔑 não devolve o custo a quem não tem produto:ver_custo", async () => {
    await criado();

    const resposta = await listar("", await autenticar("4", PIN_CAIXA));

    const itens = resposta.json<{ itens: Record<string, unknown>[] }>().itens;
    expect(itens[0]).not.toHaveProperty("custo");
    // Nem escondido em outro campo: a margem da loja não sai por aqui.
    expect(JSON.stringify(itens)).not.toContain("650");
  });

  it("devolve o custo a quem tem a permissão", async () => {
    await criado();

    const itens = (await listar()).json<{ itens: Record<string, unknown>[] }>().itens;

    expect(itens[0]?.["custo"]).toBe("650");
  });

  it("recusa limite fora da faixa", async () => {
    expect((await listar("?limite=0")).statusCode).toBe(400);
    expect((await listar("?limite=9999")).statusCode).toBe(400);
  });

  it("exige autenticação", async () => {
    expect((await listar("", { authorization: "" })).statusCode).toBe(401);
  });
});

describe("GET /api/produtos/:id", () => {
  it("devolve o produto", async () => {
    const id = await criado();

    const resposta = await servidor.inject({
      method: "GET",
      url: `/api/produtos/${id}`,
      headers: comoGerente,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ sku: "REF001" });
  });

  it("recusa identificador malformado", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/nao-e-uuid",
      headers: comoGerente,
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("devolve 404 para produto inexistente", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999",
      headers: comoGerente,
    });

    expect(resposta.statusCode).toBe(404);
  });
});

describe("GET /api/produtos/buscar", () => {
  it("continua servindo a bipada do balcão", async () => {
    await cadastrarProduto(container);

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar?codigo=7891000315507",
      headers: await autenticar("4", PIN_CAIXA),
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ sku: "REF001" });
  });

  it("devolve 404 com mensagem que o operador entende", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar?codigo=0000000000000",
      headers: comoGerente,
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json<{ erro: { mensagem: string } }>().erro.mensagem).toContain(
      "Confira o código",
    );
  });

  it("recusa consulta sem código", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar",
      headers: comoGerente,
    });

    expect(resposta.statusCode).toBe(400);
  });
});
