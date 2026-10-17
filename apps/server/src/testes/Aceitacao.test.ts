import {
  CodigoBarras,
  Dinheiro,
  gerarEtiquetaBalanca,
  type Identificador,
  LAYOUT_BALANCA_PADRAO,
  Matricula,
  Produto,
} from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarUsuario,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
  proximoId,
} from "./apoio.js";

/**
 * Os cenários de aceitação da V1 — os que o pedido do produto manda validar
 * "no mínimo" —, ponta a ponta: HTTP de verdade, PostgreSQL de verdade, as
 * mesmas rotas que a tela do caixa chama.
 *
 * Cada `describe` é um cenário, com os números do pedido. A regra de cada um
 * tem teste de unidade no domínio; aqui se prova que ela chega inteira ao
 * balcão — pelo fio, gravada no banco, e de volta.
 */

const ESTACAO = proximoId();

const OPERADOR = { matricula: "42", pin: "482913" } as const;
const SUPERVISOR = { matricula: "7", pin: "860412" } as const;

type Cabecalho = { readonly authorization: string };

interface VendaNoFio {
  readonly id: string;
  readonly numero: number;
  readonly status: string;
  readonly total: string;
  readonly totalPago: string;
  readonly faltaPagar: string;
  readonly troco: string;
  readonly descontoTotal: string;
  readonly itens: readonly {
    readonly numero: number;
    readonly total: string;
    readonly quantidade: { readonly milesimos: string; readonly unidade: string };
  }[];
  readonly pagamentos: readonly { readonly forma: string; readonly valor: string }[];
}

/** Os produtos da loja dos cenários, com o estoque com que o dia começa. */
interface Loja {
  readonly refrigerante: Identificador;
  readonly contrafile: Identificador;
  readonly bolo: Identificador;
  readonly cesta: Identificador;
}

const CODIGO = {
  refrigerante: "7891000315507",
  bolo: "7890000001014",
  cesta: "7890000001021",
  /** O código do contrafilé dentro da etiqueta da balança. */
  contrafileNaBalanca: "000123",
} as const;

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

async function chamar(
  cabecalho: Cabecalho,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
  alvo: FastifyInstance = servidor,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const resposta = await alvo.inject({
    method,
    url,
    headers: cabecalho,
    ...(payload === undefined ? {} : { payload }),
  });

  return {
    status: resposta.statusCode,
    corpo: resposta.body === "" ? {} : resposta.json<Record<string, unknown>>(),
  };
}

function produto(dados: {
  readonly sku: string;
  readonly descricao: string;
  readonly preco: string;
  readonly codigoBarras?: string;
  readonly pesavel?: { readonly codigoBalanca: string };
}): Produto {
  return Produto.criar({
    id: proximoId(),
    sku: dados.sku,
    descricao: dados.descricao,
    tipo: dados.pesavel === undefined ? "UNITARIO" : "PESAVEL",
    unidadeBase: dados.pesavel === undefined ? "UN" : "KG",
    precoVenda: Dinheiro.deReais(dados.preco).unwrap(),
    custo: Dinheiro.deReais("1,00").unwrap(),
    codigoBarras:
      dados.codigoBarras === undefined
        ? undefined
        : CodigoBarras.criar(dados.codigoBarras).unwrap(),
    codigoBalanca: dados.pesavel?.codigoBalanca,
  }).unwrap();
}

/**
 * A loja aberta: operador e supervisor cadastrados, catálogo com estoque, e o
 * caixa aberto **pela rota**, com R$ 100,00 de fundo de troco.
 */
async function abrirALoja(): Promise<{
  readonly operador: Cabecalho;
  readonly supervisor: Cabecalho;
  readonly loja: Loja;
}> {
  await cadastrarUsuario(container, {
    ...OPERADOR,
    nome: "Maria",
    papel: "OPERADOR_CAIXA",
  });
  await cadastrarUsuario(container, {
    ...SUPERVISOR,
    nome: "João",
    papel: "SUPERVISOR",
  });
  const operador = {
    authorization: `Bearer ${(await logar(servidor, OPERADOR.matricula, OPERADOR.pin)).token}`,
  };
  const supervisor = {
    authorization: `Bearer ${(await logar(servidor, SUPERVISOR.matricula, SUPERVISOR.pin)).token}`,
  };

  const catalogo = [
    produto({
      sku: "REFRI",
      descricao: "Refrigerante cola 2 L",
      preco: "9,90",
      codigoBarras: CODIGO.refrigerante,
    }),
    produto({
      sku: "CONTRAFILE",
      descricao: "Contrafilé",
      preco: "20,00",
      pesavel: { codigoBalanca: CODIGO.contrafileNaBalanca },
    }),
    produto({
      sku: "BOLO",
      descricao: "Bolo de fubá",
      preco: "12,50",
      codigoBarras: CODIGO.bolo,
    }),
    produto({
      sku: "CESTA",
      descricao: "Cesta de café",
      preco: "50,00",
      codigoBarras: CODIGO.cesta,
    }),
  ];

  const maria = await container.leitura.usuarios.porMatricula(
    Matricula.criar(OPERADOR.matricula).unwrap(),
  );
  const usuarioId = maria?.id ?? proximoId();

  for (const item of catalogo) {
    await container.leitura.produtos.salvar(item);
    const entrada = await container.registrarMovimento.executar({
      produtoId: item.id,
      tipo: "ENTRADA",
      // 10 unidades, ou 10 kg do contrafilé.
      quantidade: 10_000n,
      unidade: item.ehPesavel ? "KG" : "UN",
      usuarioId,
    });
    expect(entrada.isOk()).toBe(true);
  }

  const abertura = await chamar(operador, "POST", "/api/caixa/abrir", {
    estacaoId: ESTACAO.valor,
    fundoTroco: "10000",
  });
  expect(abertura.status).toBe(201);

  const [refrigerante, contrafile, bolo, cesta] = catalogo.map((item) => item.id) as [
    Identificador,
    Identificador,
    Identificador,
    Identificador,
  ];

  return { operador, supervisor, loja: { refrigerante, contrafile, bolo, cesta } };
}

async function abrirVenda(operador: Cabecalho, id?: string): Promise<VendaNoFio> {
  const aberta = await chamar(operador, "POST", "/api/vendas", {
    estacaoId: ESTACAO.valor,
    ...(id === undefined ? {} : { id }),
  });
  expect(aberta.status).toBe(201);

  return aberta.corpo as unknown as VendaNoFio;
}

async function bipar(
  operador: Cabecalho,
  venda: VendaNoFio,
  codigo: string,
  quantidade?: { readonly milesimos: string; readonly unidade?: string },
): Promise<VendaNoFio> {
  const bipada = await chamar(operador, "POST", `/api/vendas/${venda.id}/itens`, {
    codigo,
    ...(quantidade === undefined ? {} : { quantidade }),
  });
  expect(bipada.status).toBe(201);

  return bipada.corpo["venda"] as VendaNoFio;
}

async function pagar(
  operador: Cabecalho,
  venda: VendaNoFio,
  forma: string,
  valor: string,
  extras: Record<string, unknown> = {},
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  return chamar(operador, "POST", `/api/vendas/${venda.id}/pagamentos`, {
    forma,
    valor,
    ...extras,
  });
}

async function finalizar(operador: Cabecalho, venda: VendaNoFio): Promise<VendaNoFio> {
  const finalizada = await chamar(
    operador,
    "POST",
    `/api/vendas/${venda.id}/finalizar`,
    {},
  );
  expect(finalizada.status).toBe(200);

  return finalizada.corpo as unknown as VendaNoFio;
}

/** Saldo do produto, em milésimos da unidade dele, como o banco projetou. */
async function saldo(produtoId: Identificador, unidade: "UN" | "KG"): Promise<bigint> {
  return (await container.leitura.estoque.saldo(produtoId, unidade)).milesimos;
}

describe("1. Venda por unidade", () => {
  it("🔑 bipar duas vezes soma na mesma linha: 2 × R$ 9,90 = R$ 19,80", async () => {
    const { operador } = await abrirALoja();
    const venda = await abrirVenda(operador);

    await bipar(operador, venda, CODIGO.refrigerante);
    const somada = await bipar(operador, venda, CODIGO.refrigerante);

    expect(somada.itens).toHaveLength(1);
    expect(somada.itens[0]?.quantidade).toEqual({ milesimos: "2000", unidade: "UN" });
    expect(somada.total).toBe("1980");
  });
});

describe("2 e 3. Venda por peso e conversão g/kg", () => {
  it("🔑 exemplo do pedido: R$ 20,00/kg × 350 g = R$ 7,00", async () => {
    const { operador } = await abrirALoja();
    const venda = await abrirVenda(operador);

    // O operador digita 350 no campo do peso, em gramas.
    const pesada = await bipar(operador, venda, "CONTRAFILE", {
      milesimos: "350000",
      unidade: "G",
    });

    expect(pesada.total).toBe("700");
    // Guardado na unidade do produto: 0,350 kg.
    expect(pesada.itens[0]?.quantidade).toEqual({ milesimos: "350", unidade: "KG" });
  });

  it("🔑 350 g e 0,350 kg são o mesmo peso, e o mesmo preço", async () => {
    const { operador } = await abrirALoja();

    const emGramas = await bipar(operador, await abrirVenda(operador), "CONTRAFILE", {
      milesimos: "350000",
      unidade: "G",
    });
    const emQuilos = await bipar(
      operador,
      await abrirVenda(operador, proximoId().valor),
      "CONTRAFILE",
      { milesimos: "350", unidade: "KG" },
    );

    expect(emQuilos.itens[0]?.quantidade).toEqual(emGramas.itens[0]?.quantidade);
    expect(emQuilos.total).toBe(emGramas.total);
  });

  it("🔑 a etiqueta da balança traz o peso dentro: 350 g lidos do código", async () => {
    const { operador } = await abrirALoja();
    const etiqueta = gerarEtiquetaBalanca(
      LAYOUT_BALANCA_PADRAO,
      CODIGO.contrafileNaBalanca,
      350n,
    ).unwrap();

    const lida = await bipar(operador, await abrirVenda(operador), etiqueta);

    expect(lida.itens[0]?.quantidade).toEqual({ milesimos: "350", unidade: "KG" });
    expect(lida.total).toBe("700");
  });

  it("1,5 kg a R$ 20,00/kg são R$ 30,00", async () => {
    const { operador } = await abrirALoja();

    const pesada = await bipar(operador, await abrirVenda(operador), "CONTRAFILE", {
      milesimos: "1500",
      unidade: "KG",
    });

    expect(pesada.total).toBe("3000");
  });
});

describe("4 e 5. Pagamento misto e troco", () => {
  it("🔑 exemplo do pedido: R$ 12,50 pagos com R$ 20,00 deixam R$ 7,50 de troco", async () => {
    const { operador } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.bolo);

    const paga = await pagar(operador, venda, "DINHEIRO", "2000");

    expect(paga.status).toBe(201);
    const depois = paga.corpo["venda"] as VendaNoFio;
    expect(depois.faltaPagar).toBe("0");
    expect(depois.troco).toBe("750");
    expect((await finalizar(operador, depois)).troco).toBe("750");
  });

  it("🔑 exemplo do pedido: R$ 50,00 = R$ 20,00 em dinheiro + R$ 30,00 no Pix — saldo zero, sem troco", async () => {
    const { operador } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.cesta);

    await pagar(operador, venda, "DINHEIRO", "2000");
    const paga = await pagar(operador, venda, "PIX", "3000", { confirmacao: "MANUAL" });

    const depois = paga.corpo["venda"] as VendaNoFio;
    expect(depois.totalPago).toBe("5000");
    expect(depois.faltaPagar).toBe("0");
    expect(depois.troco).toBe("0");

    const finalizada = await finalizar(operador, depois);
    expect(finalizada.status).toBe("FINALIZADA");
    expect(finalizada.pagamentos.map((p) => [p.forma, p.valor])).toEqual([
      ["DINHEIRO", "2000"],
      ["PIX", "3000"],
    ]);
  });

  it("🔑 troco só sai em dinheiro: Pix acima do que falta é recusado", async () => {
    const { operador } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.bolo);

    const recusado = await pagar(operador, venda, "PIX", "2000", {
      confirmacao: "MANUAL",
    });

    expect(recusado.status).toBe(422);
    expect((recusado.corpo["erro"] as { codigo: string }).codigo).toBe(
      "PAGAMENTO_ACIMA_DO_RESTANTE",
    );
  });

  it("🔑 número de cartão no campo da autorização é recusado, e não é gravado", async () => {
    const { operador } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.bolo);

    const recusado = await pagar(operador, venda, "CARTAO_DEBITO", "1250", {
      confirmacao: "MANUAL",
      autorizacao: "4111111111111111",
    });

    expect((recusado.corpo["erro"] as { codigo: string }).codigo).toBe(
      "PAGAMENTO_NUMERO_DE_CARTAO",
    );
    expect(await container.prisma.pagamento.count()).toBe(0);
  });
});

describe("6. Desconto autorizado", () => {
  it("🔑 acima do teto do operador pede o supervisor; com o PIN dele, passa — e fica na auditoria", async () => {
    const { operador } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.cesta);

    // O teto do operador de caixa é 3% na venda; 10% pede liberação.
    const pedido = await chamar(operador, "POST", `/api/vendas/${venda.id}/desconto`, {
      percentualBps: 1000,
    });
    expect(pedido.status).toBe(403);
    expect((pedido.corpo["erro"] as { codigo: string }).codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );

    const liberado = await chamar(operador, "POST", `/api/vendas/${venda.id}/desconto`, {
      percentualBps: 1000,
      supervisor: SUPERVISOR,
    });
    expect(liberado.status).toBe(200);
    const comDesconto = liberado.corpo as unknown as VendaNoFio;
    expect(comDesconto.descontoTotal).toBe("500");
    expect(comDesconto.total).toBe("4500");

    const registros = await container.prisma.registroAuditoria.findMany({
      where: { acao: "DESCONTO_VENDA" },
    });
    expect(registros).toHaveLength(1);
    expect(registros[0]?.autorizadoPorId).not.toBeNull();
  });
});

describe("7. Cancelamento", () => {
  it("🔑 venda concluída cancelada com motivo e supervisor: o estoque volta", async () => {
    const { operador, loja } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.refrigerante);
    await pagar(operador, venda, "DINHEIRO", "990");
    await finalizar(operador, venda);
    expect(await saldo(loja.refrigerante, "UN")).toBe(9000n);

    const cancelada = await chamar(operador, "POST", `/api/vendas/${venda.id}/cancelar`, {
      motivo: "Cliente desistiu na porta",
      supervisor: SUPERVISOR,
    });

    expect(cancelada.status).toBe(200);
    expect((cancelada.corpo["venda"] as VendaNoFio).status).toBe("CANCELADA");
    expect(await saldo(loja.refrigerante, "UN")).toBe(10_000n);
  });

  it("motivo é obrigatório", async () => {
    const { operador } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.refrigerante);

    const sem = await chamar(operador, "POST", `/api/vendas/${venda.id}/cancelar`, {
      motivo: "",
    });

    expect(sem.status).toBe(400);
  });
});

describe("8. Devolução parcial", () => {
  it("🔑 de 3 refrigerantes, devolve 1 em dinheiro: R$ 9,90 de volta, e ele volta ao estoque", async () => {
    const { operador, supervisor, loja } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.refrigerante, {
      milesimos: "3000",
    });
    await pagar(operador, venda, "DINHEIRO", "2970");
    await finalizar(operador, venda);
    expect(await saldo(loja.refrigerante, "UN")).toBe(7000n);

    const devolucao = await chamar(
      supervisor,
      "POST",
      `/api/vendas/${venda.id}/devolucoes`,
      {
        estacaoId: ESTACAO.valor,
        itens: [
          {
            numeroItem: 1,
            quantidade: { milesimos: "1000", unidade: "UN" },
            destino: "ESTOQUE",
          },
        ],
        formaReembolso: "DINHEIRO",
        motivo: "Embalagem amassada",
      },
    );

    expect(devolucao.status).toBe(201);
    expect(devolucao.corpo["valorTotal"]).toBe("990");
    expect(await saldo(loja.refrigerante, "UN")).toBe(8000n);

    const situacao = await chamar(
      supervisor,
      "GET",
      `/api/vendas/${venda.id}/devolucoes`,
    );
    expect(situacao.corpo["restante"]).toEqual([
      { numeroItem: 1, milesimos: "2000", unidade: "UN" },
    ]);
  });

  it("🔑 não devolve mais do que foi vendido", async () => {
    const { operador, supervisor } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.refrigerante);
    await pagar(operador, venda, "DINHEIRO", "990");
    await finalizar(operador, venda);

    const demais = await chamar(
      supervisor,
      "POST",
      `/api/vendas/${venda.id}/devolucoes`,
      {
        estacaoId: ESTACAO.valor,
        itens: [
          {
            numeroItem: 1,
            quantidade: { milesimos: "2000", unidade: "UN" },
            destino: "ESTOQUE",
          },
        ],
        formaReembolso: "DINHEIRO",
        motivo: "Tentativa de devolver em dobro",
      },
    );

    expect(demais.status).toBe(422);
  });
});

describe("9. Estoque depois da venda", () => {
  it("🔑 a venda baixa o estoque só ao concluir: 10 un − 2 un = 8 un; 10 kg − 0,350 kg = 9,650 kg", async () => {
    const { operador, loja } = await abrirALoja();
    const venda = await abrirVenda(operador);
    await bipar(operador, venda, CODIGO.refrigerante, { milesimos: "2000" });
    const comPeso = await bipar(operador, venda, "CONTRAFILE", {
      milesimos: "350000",
      unidade: "G",
    });

    // Bipar reserva nada: venda aberta não mexe no estoque.
    expect(await saldo(loja.refrigerante, "UN")).toBe(10_000n);

    await pagar(operador, comPeso, "DINHEIRO", comPeso.total);
    await finalizar(operador, comPeso);

    expect(await saldo(loja.refrigerante, "UN")).toBe(8000n);
    expect(await saldo(loja.contrafile, "KG")).toBe(9650n);
  });
});

describe("10. Fechamento de caixa", () => {
  it("🔑 fundo + dinheiro recebido − troco = o que a gaveta deve ter; contado igual, diferença zero", async () => {
    const { operador } = await abrirALoja();
    // R$ 12,50 pagos com R$ 20,00: entram R$ 20,00, saem R$ 7,50 de troco.
    const bolo = await bipar(operador, await abrirVenda(operador), CODIGO.bolo);
    await pagar(operador, bolo, "DINHEIRO", "2000");
    await finalizar(operador, bolo);
    // R$ 50,00 misto: só os R$ 20,00 em dinheiro vão para a gaveta.
    const cesta = await bipar(operador, await abrirVenda(operador), CODIGO.cesta);
    await pagar(operador, cesta, "DINHEIRO", "2000");
    await pagar(operador, cesta, "PIX", "3000", { confirmacao: "MANUAL" });
    await finalizar(operador, cesta);

    // 100,00 + 20,00 − 7,50 + 20,00 = 132,50
    const fechamento = await chamar(operador, "POST", "/api/caixa/fechar", {
      estacaoId: ESTACAO.valor,
      contadoEmDinheiro: "13250",
    });

    expect(fechamento.status).toBe(200);
    expect(fechamento.corpo).toMatchObject({
      fundoTroco: "10000",
      esperadoEmDinheiro: "13250",
      contadoEmDinheiro: "13250",
      divergenciaEmDinheiro: "0",
      totalVendido: "6250",
      quantidadeVendas: 2,
    });

    const aberto = await servidor.inject({
      method: "GET",
      url: `/api/caixa/aberto?estacaoId=${ESTACAO.valor}`,
      headers: operador,
    });
    expect(aberto.statusCode).toBe(204);
  });

  it("🔑 contado a menos: o caixa fecha, e a falta fica registrada", async () => {
    const { operador } = await abrirALoja();

    const fechamento = await chamar(operador, "POST", "/api/caixa/fechar", {
      estacaoId: ESTACAO.valor,
      contadoEmDinheiro: "9500",
    });

    expect(fechamento.status).toBe(200);
    expect(fechamento.corpo["divergenciaEmDinheiro"]).toBe("-500");
  });
});

describe("11. Prevenção de venda duplicada", () => {
  it("🔑 o primeiro bipe repetido não abre uma segunda venda", async () => {
    const { operador } = await abrirALoja();
    const id = proximoId().valor;

    const primeira = await abrirVenda(operador, id);
    const repetida = await chamar(operador, "POST", "/api/vendas", {
      estacaoId: ESTACAO.valor,
      id,
    });

    expect((repetida.corpo as unknown as VendaNoFio).id).toBe(primeira.id);
    expect(await container.prisma.venda.count()).toBe(1);
  });

  it("🔑 o Enter repetido no pagamento não cobra duas vezes", async () => {
    const { operador } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.cesta);
    const chave = "pagamento-0001";

    await pagar(operador, venda, "DINHEIRO", "2000", { chave });
    const repetido = await pagar(operador, venda, "DINHEIRO", "2000", { chave });

    expect((repetido.corpo["venda"] as VendaNoFio).totalPago).toBe("2000");
    expect(await container.prisma.pagamento.count()).toBe(1);
  });

  it("🔑 concluir de novo devolve a mesma venda, sem baixar o estoque nem contar no caixa duas vezes", async () => {
    // A resposta da conclusão pode se perder na rede, e a estação pede de novo:
    // recusar faria o operador refazer uma venda que deu certo.
    const { operador, loja } = await abrirALoja();
    const venda = await bipar(operador, await abrirVenda(operador), CODIGO.refrigerante);
    await pagar(operador, venda, "DINHEIRO", "2000");
    const primeira = await finalizar(operador, venda);

    const segunda = await finalizar(operador, venda);

    expect(segunda).toEqual(primeira);
    expect(segunda.troco).toBe("1010");
    expect(await saldo(loja.refrigerante, "UN")).toBe(9000n);
    const caixa = await chamar(
      operador,
      "GET",
      `/api/caixa/aberto?estacaoId=${ESTACAO.valor}`,
    );
    expect(caixa.corpo).toMatchObject({ quantidadeVendas: 1, totalVendido: "990" });
  });

  it("🔑 a venda feita sem servidor, enviada duas vezes pela estação, entra uma vez", async () => {
    const { operador, loja } = await abrirALoja();
    const offline = {
      chave: "offline-estacao-0001",
      estacaoId: ESTACAO.valor,
      registradaEm: new Date().toISOString(),
      itens: [{ codigo: CODIGO.refrigerante }],
      pagamentos: [{ forma: "DINHEIRO", valor: "990" }],
    };

    const primeira = await chamar(operador, "POST", "/api/sincronizacao/vendas", offline);
    const segunda = await chamar(operador, "POST", "/api/sincronizacao/vendas", offline);

    expect(primeira.status).toBe(201);
    expect(segunda.corpo["jaExistia"]).toBe(true);
    expect(await container.prisma.venda.count()).toBe(1);
    expect(await saldo(loja.refrigerante, "UN")).toBe(9000n);
  });
});

describe("12. Persistência depois de reiniciar", () => {
  it("🔑 servidor desligado e religado: caixa aberto, venda em andamento e venda concluída continuam lá", async () => {
    const { operador, loja } = await abrirALoja();
    const concluida = await bipar(operador, await abrirVenda(operador), CODIGO.bolo);
    await pagar(operador, concluida, "DINHEIRO", "2000");
    await finalizar(operador, concluida);
    const emAndamento = await bipar(
      operador,
      await abrirVenda(operador),
      CODIGO.refrigerante,
    );

    // Desliga de verdade: o servidor e as conexões com o banco.
    await servidor.close();
    await container.encerrar();
    ({ servidor, container } = await montarServidorDeTeste());

    // Entra de novo e encontra tudo como estava.
    const novo = {
      authorization: `Bearer ${(await logar(servidor, OPERADOR.matricula, OPERADOR.pin)).token}`,
    };

    const caixa = await chamar(
      novo,
      "GET",
      `/api/caixa/aberto?estacaoId=${ESTACAO.valor}`,
    );
    expect(caixa.status).toBe(200);
    expect(caixa.corpo["fundoTroco"]).toBe("10000");

    const abertas = await chamar(
      novo,
      "GET",
      `/api/vendas/abertas?estacaoId=${ESTACAO.valor}`,
    );
    expect(abertas.corpo["vendas"]).toEqual([
      expect.objectContaining({ id: emAndamento.id, total: "990" }),
    ]);

    const relida = await chamar(novo, "GET", `/api/vendas/${concluida.id}`);
    expect(relida.corpo).toMatchObject({
      status: "FINALIZADA",
      total: "1250",
      troco: "750",
    });
    expect(await saldo(loja.bolo, "UN")).toBe(9000n);
  });
});

describe("13. Cópia de segurança e restauração", () => {
  it("🔑 a cópia guarda o dia; restaurar volta o banco ao momento dela — e a venda feita depois sai", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "erp-aceitacao-copias-"));
    const comCopias = await montarServidorDeTeste({
      PASTA_COPIAS: pasta,
      PASTA_BINARIOS_POSTGRES: process.env["PASTA_BINARIOS_POSTGRES"] ?? "",
    });

    try {
      const { operador, loja } = await abrirALoja();
      const antes = await bipar(operador, await abrirVenda(operador), CODIGO.bolo);
      await pagar(operador, antes, "DINHEIRO", "1250");
      await finalizar(operador, antes);

      await cadastrarUsuario(comCopias.container, {
        matricula: "1",
        nome: "Dona da loja",
        papel: "ADMIN",
        pin: "719264",
      });
      const dona = {
        authorization: `Bearer ${(await logar(comCopias.servidor, "1", "719264")).token}`,
      };

      const copia = await chamar(
        dona,
        "POST",
        "/api/copias-de-seguranca",
        {},
        comCopias.servidor,
      );
      expect(copia.status).toBe(201);
      const { nome, conferida } = copia.corpo["copia"] as {
        nome: string;
        conferida: boolean;
      };
      // Toda cópia é provada por restauração numa base à parte.
      expect(conferida).toBe(true);

      // Depois da cópia, uma venda que a restauração vai levar embora.
      const depois = await bipar(operador, await abrirVenda(operador), CODIGO.cesta);
      await pagar(operador, depois, "DINHEIRO", "5000");
      await finalizar(operador, depois);
      expect(await saldo(loja.cesta, "UN")).toBe(9000n);

      const restaurada = await chamar(
        dona,
        "POST",
        `/api/copias-de-seguranca/${nome}/restauracao`,
        { confirmacao: "restaurar", comCaixasAbertos: true },
        comCopias.servidor,
      );
      expect(restaurada.status).toBe(200);

      expect(await comCopias.container.prisma.venda.count()).toBe(1);
      expect(
        await comCopias.container.prisma.venda.findUnique({ where: { id: antes.id } }),
      ).not.toBeNull();
      expect(
        (await comCopias.container.leitura.estoque.saldo(loja.cesta, "UN")).milesimos,
      ).toBe(10_000n);
    } finally {
      await comCopias.servidor.close();
      await comCopias.container.encerrar();
      await rm(pasta, { recursive: true, force: true });
    }
  });
});
