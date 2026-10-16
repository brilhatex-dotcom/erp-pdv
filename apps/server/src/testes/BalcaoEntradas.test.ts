import { Dinheiro, Matricula, SessaoCaixa } from "@erp/domain";
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
 * O que o balcão recusa antes de chegar à regra de negócio.
 *
 * Cada linha da tabela é uma requisição que um cliente quebrado, uma tela
 * desatualizada ou alguém mexendo na rede pode mandar. O que se exige de todas
 * é a mesma coisa: resposta 4xx com mensagem para o operador, nunca 500 e
 * nunca efeito colateral.
 */

const ESTACAO = proximoId();
const OUTRA_ESTACAO = proximoId();
/** Texto que nem tem cara de identificador: o Zod recusa na entrada. */
const NAO_E_UUID = "nao-e-um-identificador";
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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

type Cabecalho = { readonly authorization: string };

interface Cenario {
  readonly operador: Cabecalho;
  readonly supervisor: Cabecalho;
  readonly gerente: Cabecalho;
  readonly aberta: string;
  readonly concluida: string;
}

let cenario: Cenario;

async function entrar(
  matricula: string,
  pin: string,
  papel: "OPERADOR_CAIXA" | "SUPERVISOR" | "GERENTE",
): Promise<Cabecalho> {
  await cadastrarUsuario(container, { matricula, nome: papel, papel, pin });
  const { token } = await logar(servidor, matricula, pin);
  return { authorization: `Bearer ${token}` };
}

async function chamar(
  cabecalho: Cabecalho | undefined,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const resposta = await servidor.inject({
    method,
    url,
    ...(cabecalho === undefined ? {} : { headers: cabecalho }),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

  return { status: resposta.statusCode, corpo: resposta.json<Record<string, unknown>>() };
}

beforeEach(async () => {
  await limparBanco(container);

  const operador = await entrar("42", "482913", "OPERADOR_CAIXA");
  const supervisor = await entrar("7", "860412", "SUPERVISOR");
  const gerente = await entrar("1", "573914", "GERENTE");
  const usuario = await container.leitura.usuarios.porMatricula(
    Matricula.criar("42").unwrap(),
  );

  await container.leitura.caixas.salvar(
    SessaoCaixa.abrir({
      id: proximoId(),
      estacaoId: ESTACAO,
      operadorId: usuario!.id,
      fundoTroco: Dinheiro.deReais("100,00").unwrap(),
      abertaEm: new Date(),
    }).unwrap(),
  );
  await cadastrarProduto(container);

  async function vendaComRefri(): Promise<string> {
    const venda = await chamar(operador, "POST", "/api/vendas", {
      estacaoId: ESTACAO.valor,
    });
    const id = venda.corpo["id"] as string;
    await chamar(operador, "POST", `/api/vendas/${id}/itens`, {
      codigo: "7891000315507",
    });
    return id;
  }

  const concluida = await vendaComRefri();
  await chamar(operador, "POST", `/api/vendas/${concluida}/pagamentos`, {
    forma: "PIX",
    valor: "990",
  });
  await chamar(operador, "POST", `/api/vendas/${concluida}/finalizar`, {});

  cenario = { operador, supervisor, gerente, aberta: await vendaComRefri(), concluida };
});

describe("Entradas que o balcão recusa", () => {
  type Caso = readonly [
    nome: string,
    quem: keyof Pick<Cenario, "operador" | "supervisor" | "gerente">,
    method: "GET" | "POST" | "PUT",
    url: (c: Cenario) => string,
    payload: unknown,
    status: number,
  ];

  const quantidade = { milesimos: "1000", unidade: "UN" };

  const casos: readonly Caso[] = [
    // Venda
    [
      "id de venda fora do padrão",
      "operador",
      "POST",
      () => "/api/vendas",
      { estacaoId: ESTACAO.valor, id: NAO_E_UUID },
      400,
    ],
    [
      "abertas sem estação",
      "operador",
      "GET",
      () => "/api/vendas/abertas",
      undefined,
      400,
    ],
    [
      "quantidade em venda que não é venda",
      "operador",
      "PUT",
      () => "/api/vendas/abc/itens/1",
      { quantidade },
      400,
    ],
    [
      "quantidade sem corpo",
      "operador",
      "PUT",
      (c) => `/api/vendas/${c.aberta}/itens/1`,
      {},
      400,
    ],
    [
      "unidade desconhecida",
      "operador",
      "PUT",
      (c) => `/api/vendas/${c.aberta}/itens/1`,
      { quantidade: { milesimos: "1000", unidade: "XX" } },
      400,
    ],
    [
      "meia unidade de refrigerante",
      "operador",
      "PUT",
      (c) => `/api/vendas/${c.aberta}/itens/1`,
      { quantidade: { milesimos: "1500", unidade: "UN" } },
      400,
    ],
    [
      "item que não existe",
      "operador",
      "PUT",
      (c) => `/api/vendas/${c.aberta}/itens/9`,
      { quantidade },
      400,
    ],
    [
      "remover item que não é número",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/itens/abc/remover`,
      {},
      400,
    ],
    [
      "supervisor sem matrícula",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/itens/1/remover`,
      { supervisor: { matricula: "", pin: "1234" } },
      400,
    ],
    [
      "desconto em venda que não é venda",
      "operador",
      "POST",
      () => "/api/vendas/abc/desconto",
      { valor: "10" },
      400,
    ],
    [
      "cliente em venda que não é venda",
      "operador",
      "PUT",
      () => "/api/vendas/abc/cliente",
      { clienteId: null },
      400,
    ],
    [
      "cliente que não é texto",
      "operador",
      "PUT",
      (c) => `/api/vendas/${c.aberta}/cliente`,
      { clienteId: 123 },
      400,
    ],
    [
      "cliente fora do padrão",
      "operador",
      "PUT",
      (c) => `/api/vendas/${c.aberta}/cliente`,
      { clienteId: NAO_E_UUID },
      400,
    ],
    [
      "cliente que não existe",
      "operador",
      "PUT",
      (c) => `/api/vendas/${c.aberta}/cliente`,
      { clienteId: proximoId().valor },
      404,
    ],
    [
      "remover pagamento que não é número",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/pagamentos/x/remover`,
      undefined,
      400,
    ],
    [
      "remover pagamento que não existe",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/pagamentos/5/remover`,
      undefined,
      400,
    ],
    [
      "guardar venda que não é venda",
      "operador",
      "POST",
      () => "/api/vendas/abc/suspender",
      {},
      400,
    ],
    [
      "nome de venda guardada comprido",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/suspender`,
      { rotulo: "x".repeat(41) },
      400,
    ],
    [
      "guardar venda concluída",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.concluida}/suspender`,
      {},
      422,
    ],
    [
      "retomar venda que não é venda",
      "operador",
      "POST",
      () => "/api/vendas/abc/retomar",
      { estacaoId: ESTACAO.valor },
      400,
    ],
    [
      "retomar sem estação",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/retomar`,
      {},
      400,
    ],
    [
      "retomar em outro caixa",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/retomar`,
      { estacaoId: OUTRA_ESTACAO.valor },
      422,
    ],
    [
      "cancelar venda que não é venda",
      "operador",
      "POST",
      () => "/api/vendas/abc/cancelar",
      { motivo: "Desistiu" },
      400,
    ],
    [
      "crediário em 99 vezes",
      "operador",
      "POST",
      (c) => `/api/vendas/${c.aberta}/finalizar`,
      { crediario: { parcelas: 99 } },
      400,
    ],
    // Pós-venda
    [
      "número de cupom que não é número",
      "operador",
      "GET",
      () => "/api/vendas/recentes?numero=abc",
      undefined,
      400,
    ],
    [
      "comprovante de venda que não é venda",
      "operador",
      "GET",
      () => "/api/vendas/abc/comprovante",
      undefined,
      400,
    ],
    [
      "comprovante de venda que não existe",
      "operador",
      "GET",
      () => `/api/vendas/${proximoId().valor}/comprovante`,
      undefined,
      404,
    ],
    [
      "devoluções de venda que não é venda",
      "supervisor",
      "GET",
      () => "/api/vendas/abc/devolucoes",
      undefined,
      400,
    ],
    [
      "devoluções de venda que não existe",
      "supervisor",
      "GET",
      () => `/api/vendas/${proximoId().valor}/devolucoes`,
      undefined,
      404,
    ],
    [
      "devolver em venda que não é venda",
      "supervisor",
      "POST",
      () => "/api/vendas/abc/devolucoes",
      {},
      400,
    ],
    [
      "devolução sem itens",
      "supervisor",
      "POST",
      (c) => `/api/vendas/${c.concluida}/devolucoes`,
      {},
      400,
    ],
    [
      "devolução com unidade desconhecida",
      "supervisor",
      "POST",
      (c) => `/api/vendas/${c.concluida}/devolucoes`,
      {
        estacaoId: ESTACAO.valor,
        itens: [
          {
            numeroItem: 1,
            quantidade: { milesimos: "1000", unidade: "XX" },
            destino: "ESTOQUE",
          },
        ],
        formaReembolso: "PIX",
        motivo: "Teste",
      },
      400,
    ],
    [
      "devolver mais do que foi vendido",
      "supervisor",
      "POST",
      (c) => `/api/vendas/${c.concluida}/devolucoes`,
      {
        estacaoId: ESTACAO.valor,
        itens: [
          {
            numeroItem: 1,
            quantidade: { milesimos: "5000", unidade: "UN" },
            destino: "ESTOQUE",
          },
        ],
        formaReembolso: "PIX",
        motivo: "Teste",
      },
      422,
    ],
    // PDV
    [
      "busca com limite absurdo",
      "operador",
      "GET",
      () => "/api/pdv/produtos?termo=a&limite=999",
      undefined,
      400,
    ],
    // Configuração
    [
      "segmento que não existe",
      "gerente",
      "PUT",
      () => "/api/configuracao",
      { segmento: "OFICINA" },
      400,
    ],
    [
      "logotipo fora do padrão",
      "gerente",
      "PUT",
      () => "/api/configuracao",
      { logoId: NAO_E_UUID },
      400,
    ],
    [
      "teste de balança sem formato",
      "gerente",
      "POST",
      () => "/api/configuracao/balanca/testar",
      {},
      400,
    ],
    // Imagens e auditoria
    [
      "imagem que não é identificador",
      "operador",
      "GET",
      () => "/api/imagens/abc",
      undefined,
      400,
    ],
    [
      "foto que não é base64",
      "gerente",
      "POST",
      () => "/api/imagens",
      { conteudo: "isto não é base64!" },
      400,
    ],
    [
      "auditoria com ação em minúsculas",
      "gerente",
      "GET",
      () => "/api/auditoria?acao=sangria",
      undefined,
      400,
    ],
    // Produtos
    [
      "categoria fora do padrão",
      "gerente",
      "POST",
      () => "/api/produtos",
      {
        sku: "X1",
        descricao: "X",
        precoVenda: "100",
        tipo: "UNITARIO",
        unidadeBase: "UN",
        categoriaId: NAO_E_UUID,
      },
      400,
    ],
    [
      "fornecedor fora do padrão",
      "gerente",
      "POST",
      () => "/api/produtos",
      {
        sku: "X1",
        descricao: "X",
        precoVenda: "100",
        tipo: "UNITARIO",
        unidadeBase: "UN",
        fornecedorId: NAO_E_UUID,
      },
      400,
    ],
  ];

  it.each(casos)("%s", async (_nome, quem, method, url, payload, status) => {
    const resposta = await chamar(cenario[quem], method, url(cenario), payload);

    expect(resposta.status).toBe(status);
    // Toda recusa tem código e mensagem para o operador — nunca um 500 cru.
    expect(resposta.corpo["erro"]).toMatchObject({
      codigo: expect.any(String) as string,
      mensagem: expect.any(String) as string,
    });
  });

  it("produto: categoria e fornecedor fora do padrão também na alteração", async () => {
    const lista = await chamar(cenario.gerente, "GET", "/api/produtos");
    const [produto] = lista.corpo["itens"] as { id: string }[];
    const base = {
      sku: "REF001",
      descricao: "Refrigerante",
      precoVenda: "990",
      ativo: true,
    };

    const categoria = await chamar(
      cenario.gerente,
      "PUT",
      `/api/produtos/${produto!.id}`,
      {
        ...base,
        categoriaId: NAO_E_UUID,
      },
    );
    const fornecedor = await chamar(
      cenario.gerente,
      "PUT",
      `/api/produtos/${produto!.id}`,
      {
        ...base,
        imagemId: NAO_E_UUID,
      },
    );

    expect(categoria.status).toBe(400);
    expect(fornecedor.status).toBe(400);
  });
});

describe("Ramos de apresentação", () => {
  it("🔑 o produto volta com estoque mínimo, fornecedor, foto e embalagem", async () => {
    const imagem = await chamar(cenario.gerente, "POST", "/api/imagens", {
      conteudo: PNG_1X1,
    });
    const fornecedor = await container.cadastrarFornecedor.executar({
      razaoSocial: "Moinho Bom Grão Ltda",
      documento: "11.222.333/0001-81",
    });

    const criado = await chamar(cenario.gerente, "POST", "/api/produtos", {
      sku: "FAR001",
      descricao: "Farinha de Trigo 1 kg",
      precoVenda: "650",
      tipo: "UNITARIO",
      unidadeBase: "UN",
      estoqueMinimo: "12000",
      fornecedorId: fornecedor.unwrap().id.valor,
      imagemId: imagem.corpo["id"],
      botaoRapido: true,
      embalagens: [{ unidade: "FD", fator: "10", codigoBarras: "17891000315504" }],
    });

    expect(criado.status).toBe(201);
    expect(criado.corpo).toMatchObject({
      estoqueMinimo: "12000",
      fornecedorId: fornecedor.unwrap().id.valor,
      imagemId: imagem.corpo["id"],
      botaoRapido: true,
      embalagens: [{ unidade: "FD", fator: "10", codigoBarras: "17891000315504" }],
    });
  });

  it("🔑 o contexto e o comprovante mostram a loja, o logotipo e o cliente", async () => {
    const imagem = await chamar(cenario.gerente, "POST", "/api/imagens", {
      conteudo: PNG_1X1,
    });
    await chamar(cenario.gerente, "PUT", "/api/configuracao", {
      logoId: imagem.corpo["id"],
    });
    await container.definirEmpresa.executar({
      razaoSocial: "Padaria Pão Quente Ltda",
      cnpj: "11.222.333/0001-81",
      regimeTributario: "SIMPLES_NACIONAL",
      endereco: {
        logradouro: "Rua das Flores",
        numero: "120",
        bairro: "Centro",
        municipio: "Campinas",
        uf: "SP",
        cep: "13010000",
      },
    });
    const cliente = await container.cadastrarCliente.executar({
      nome: "Dona Cida",
      tipoPessoa: "FISICA",
    });
    await chamar(cenario.operador, "PUT", `/api/vendas/${cenario.aberta}/cliente`, {
      clienteId: cliente.unwrap().id.valor,
    });
    await chamar(cenario.operador, "POST", `/api/vendas/${cenario.aberta}/pagamentos`, {
      forma: "DINHEIRO",
      valor: "990",
    });
    await chamar(cenario.operador, "POST", `/api/vendas/${cenario.aberta}/finalizar`, {});

    const contexto = await chamar(cenario.operador, "GET", "/api/pdv/contexto");
    expect(contexto.corpo).toMatchObject({
      loja: { nome: "Padaria Pão Quente Ltda" },
      configuracao: { logoId: imagem.corpo["id"], gravada: true },
    });

    const comprovante = await chamar(
      cenario.operador,
      "GET",
      `/api/vendas/${cenario.aberta}/comprovante`,
    );
    expect(comprovante.corpo).toMatchObject({
      clienteNome: "Dona Cida",
      logoId: imagem.corpo["id"],
    });

    // `null` tira o logotipo.
    const semLogo = await chamar(cenario.gerente, "PUT", "/api/configuracao", {
      logoId: null,
    });
    expect(semLogo.corpo["logoId"]).toBeUndefined();
  });

  it("guardar sem nome é guardar sem rótulo", async () => {
    const guardada = await chamar(
      cenario.operador,
      "POST",
      `/api/vendas/${cenario.aberta}/suspender`,
      { rotulo: "" },
    );

    expect(guardada.status).toBe(200);
    expect(guardada.corpo["suspensao"]).toMatchObject({});
    expect((guardada.corpo["suspensao"] as { rotulo?: string }).rotulo).toBeUndefined();
  });

  it("🔑 etiqueta com preço embutido: o exemplo e a leitura falam em reais", async () => {
    const layout = {
      prefixos: ["2"],
      tamanhoCodigoProduto: 6,
      conteudo: "PRECO",
      casasDecimais: 2,
    };

    const exemplo = await chamar(
      cenario.gerente,
      "POST",
      "/api/configuracao/balanca/testar",
      {
        layout,
      },
    );
    const etiqueta = (
      exemplo.corpo["exemplo"] as { etiqueta: string; significado: string }
    ).etiqueta;
    expect((exemplo.corpo["exemplo"] as { significado: string }).significado).toBe(
      "produto 12, R$ 7,00",
    );

    const lida = await chamar(
      cenario.gerente,
      "POST",
      "/api/configuracao/balanca/testar",
      {
        layout,
        etiqueta,
      },
    );
    expect(lida.corpo["leitura"]).toMatchObject({ valida: true, preco: "700" });
    expect((lida.corpo["leitura"] as { peso?: unknown }).peso).toBeUndefined();
  });
});
