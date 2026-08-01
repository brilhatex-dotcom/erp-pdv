import {
  CodigoBarras,
  Dinheiro,
  Embalagem,
  type EstoqueMovimentado,
  estoqueMovimentado,
  Identificador,
  MovimentoEstoque,
  Produto,
  Quantidade,
  ReferenciaProduto,
  SessaoCaixa,
  Venda,
  type VendaFinalizada,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { criarPrismaClient } from "../cliente.js";
import { serializarEvento } from "../mapeadores/eventoMapeador.js";
import {
  ouNulo,
  paraDinheiro,
  paraId,
  paraIdOpcional,
  paraQuantidade,
  paraUnidade,
} from "../mapeadores/comuns.js";
import { CaixaRepositorioPrisma } from "../repositorios/CaixaRepositorioPrisma.js";
import { EstoqueRepositorioPrisma } from "../repositorios/EstoqueRepositorioPrisma.js";
import { OutboxRepositorioPrisma } from "../repositorios/OutboxRepositorioPrisma.js";
import { ProdutoRepositorioPrisma } from "../repositorios/ProdutoRepositorioPrisma.js";
import { VendaRepositorioPrisma } from "../repositorios/VendaRepositorioPrisma.js";
import {
  criarClienteDeTeste,
  limparBanco,
  prepararBanco,
  urlBancoDeTeste,
} from "./banco.js";

const PARAFUSO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8001").unwrap();
const CARNE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8002").unwrap();
const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8003").unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8004").unwrap();
const GERENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8005").unwrap();
const CAIXA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8006").unwrap();
const VENDA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8007").unwrap();
const CLIENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f8008").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

let contador = 0;
function proximoId(): Identificador {
  contador += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-8${contador.toString().padStart(11, "0")}`,
  ).unwrap();
}

const prisma = criarClienteDeTeste();

/**
 * Parafuso de casa de construção: tem referência de fabricante e é vendido em
 * caixa fechada. É o cadastro que mais estressa o mapeador.
 */
function parafuso(): Produto {
  return Produto.criar({
    id: PARAFUSO,
    sku: "PAR-3/8",
    descricao: "Parafuso Sextavado 3/8 x 2",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: reais("1,20"),
    referencias: [
      ReferenciaProduto.criar("FABRICANTE", "CIS-338-2").unwrap(),
      ReferenciaProduto.criar("SIMILAR", "GER.338.2").unwrap(),
    ],
    embalagens: [
      Embalagem.criar("CX", 100n, CodigoBarras.criar("17891000315504").unwrap()).unwrap(),
      Embalagem.criar("FD", 500n).unwrap(),
    ],
  }).unwrap();
}

/** O mesmo parafuso, com código de barras — para as buscas por igualdade. */
function parafusoComCodigoDeBarras(): Produto {
  const produto = parafuso();
  produto.definirCodigoBarras(CodigoBarras.criar("7891000315507").unwrap());
  return produto;
}

function carne(): Produto {
  return Produto.criar({
    id: CARNE,
    sku: "CAR001",
    descricao: "Alcatra Bovina",
    tipo: "PESAVEL",
    unidadeBase: "KG",
    precoVenda: reais("49,90"),
    codigoBalanca: "000777",
  }).unwrap();
}

function sessaoAberta(): SessaoCaixa {
  return SessaoCaixa.abrir({
    id: CAIXA,
    estacaoId: ESTACAO,
    operadorId: OPERADOR,
    fundoTroco: reais("150,00"),
    abertaEm: AGORA,
  }).unwrap();
}

beforeAll(() => {
  prepararBanco();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
});

describe("Conversões entre domínio e banco", () => {
  // Estas funções são o ponto onde precisão de dinheiro e unidade se perdem
  // sem barulho — daí valerem teste próprio, sem banco.
  it("converte identificador, dinheiro, unidade e quantidade", () => {
    expect(paraId(PARAFUSO.valor).equals(PARAFUSO)).toBe(true);
    expect(paraIdOpcional(null)).toBeUndefined();
    expect(paraIdOpcional(PARAFUSO.valor)?.equals(PARAFUSO)).toBe(true);
    expect(paraDinheiro(1999n).formatar()).toBe("R$ 19,99");
    expect(paraUnidade("KG")).toBe("KG");
    expect(paraQuantidade(1500n, "KG").formatar()).toBe("1,5 kg");
    expect(ouNulo(undefined)).toBeNull();
    expect(ouNulo("x")).toBe("x");
  });

  it.each([
    ["identificador", () => paraId("não-é-uuid"), /Identificador inválido/],
    ["unidade", () => paraUnidade("XPTO"), /Unidade de medida desconhecida/],
    ["quantidade", () => paraQuantidade(1n, "XPTO"), /Unidade de medida desconhecida/],
  ])("lança quando o banco traz %s corrompido", (_descricao, acao, esperado) => {
    // Linha corrompida é bug ou corrupção, não regra de negócio: devolver
    // `Result` faria cada leitura carregar um tratamento que nunca acontece.
    expect(acao).toThrow(esperado);
  });

  it("lança quando o valor monetário no banco estoura o limite", () => {
    expect(() => paraDinheiro(10n ** 30n)).toThrow(/Valor monetário inválido/);
  });

  it("lança quando a quantidade no banco é inválida", () => {
    expect(() => paraQuantidade(10n ** 30n, "UN")).toThrow(/Quantidade inválida/);
  });
});

describe("Catálogo — ida e volta pelo banco", () => {
  it("🔑 devolve o produto com referências e embalagens intactas", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(parafuso());

    const lido = await produtos.porId(PARAFUSO);

    expect(lido?.referencias).toHaveLength(2);
    expect(lido?.embalagens).toHaveLength(2);

    const caixa = lido?.embalagens.find((e) => e.unidade.codigo === "CX");
    expect(caixa?.fator).toBe(100n);
    expect(caixa?.codigoBarras?.valor).toBe("17891000315504");

    const fardo = lido?.embalagens.find((e) => e.unidade.codigo === "FD");
    expect(fardo?.codigoBarras).toBeUndefined();
  });

  it("guarda categoria e perfil tributário quando informados", async () => {
    // O perfil tributário é opcional por decisão de arquitetura (ADR-0016):
    // com o módulo fiscal desligado o produto simplesmente não tem tributação.
    const categoria = proximoId();
    const perfil = proximoId();

    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(
      Produto.criar({
        id: PARAFUSO,
        sku: "PAR-3/8",
        descricao: "Parafuso Sextavado 3/8 x 2",
        tipo: "UNITARIO",
        unidadeBase: "UN",
        precoVenda: reais("1,20"),
        codigoBarras: CodigoBarras.criar("7891000315507").unwrap(),
        categoriaId: categoria,
        perfilTributarioId: perfil,
      }).unwrap(),
    );

    const lido = await produtos.porId(PARAFUSO);

    expect(lido?.categoriaId?.equals(categoria)).toBe(true);
    expect(lido?.perfilTributarioId?.equals(perfil)).toBe(true);
    expect(lido?.codigoBarras?.valor).toBe("7891000315507");
  });

  it("encontra o produto pela referência do fabricante", async () => {
    // O cliente de autopeças chega com o código escrito num papel — é por aqui
    // que o balconista acha a peça.
    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(parafuso());

    const achado = await produtos.porCodigo("cis 338 2");

    expect(achado?.id.equals(PARAFUSO)).toBe(true);
  });

  it("encontra o produto pelo código da balança", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(carne());

    expect((await produtos.porCodigoBalanca("000777"))?.id.equals(CARNE)).toBe(true);
    expect(await produtos.porCodigoBalanca("000999")).toBeUndefined();
  });

  it.each([[""], ["   "]])("devolve nada para o código vazio %p", async (codigo) => {
    expect(await new ProdutoRepositorioPrisma(prisma).porCodigo(codigo)).toBeUndefined();
  });

  it("devolve nada quando o produto não existe", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);

    expect(await produtos.porId(proximoId())).toBeUndefined();
    expect(await produtos.porCodigo("INEXISTENTE")).toBeUndefined();
  });

  it("encontra o produto pelo SKU e pelo código de barras, em igualdade exata", async () => {
    // Separado de `porCodigo` porque serve à conferência de unicidade do
    // cadastro: aceitar a referência de outro produto aqui acusaria conflito
    // onde não há.
    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(parafusoComCodigoDeBarras());

    expect((await produtos.porSku("  PAR-3/8  "))?.id.equals(PARAFUSO)).toBe(true);
    // A referência do fabricante **não** responde por SKU.
    expect(await produtos.porSku("CIS-338-2")).toBeUndefined();

    expect((await produtos.porCodigoBarras("7891000315507"))?.id.equals(PARAFUSO)).toBe(
      true,
    );
    expect(await produtos.porCodigoBarras("7891000100103")).toBeUndefined();
  });

  it("busca por parte da descrição, sem acento e sem caixa", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(parafuso());
    await produtos.salvar(carne());

    const achados = await produtos.buscar({ termo: "SEXTAVADO", limite: 20 });

    expect(achados.map((p) => p.id.valor)).toEqual([PARAFUSO.valor]);
  });

  it("busca também pelo código bipado e pela referência do fabricante", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(parafusoComCodigoDeBarras());

    expect(await produtos.buscar({ termo: "7891000315507", limite: 20 })).toHaveLength(1);
    expect(await produtos.buscar({ termo: "par-3/8", limite: 20 })).toHaveLength(1);
    expect(await produtos.buscar({ termo: "cis 338 2", limite: 20 })).toHaveLength(1);
  });

  it("termo vazio devolve os primeiros, e o limite é respeitado", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);
    await produtos.salvar(parafuso());
    await produtos.salvar(carne());

    expect(await produtos.buscar({ limite: 20 })).toHaveLength(2);
    expect(await produtos.buscar({ termo: "  ", limite: 1 })).toHaveLength(1);
  });

  it("filtra os inativos quando pedido", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);
    const inativo = parafuso();
    inativo.desativar(new Date());
    await produtos.salvar(inativo);

    expect(await produtos.buscar({ limite: 20, apenasAtivos: true })).toHaveLength(0);
    expect(await produtos.buscar({ limite: 20 })).toHaveLength(1);
  });

  it("regravar não duplica referências nem embalagens", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);

    await produtos.salvar(parafuso());
    await produtos.salvar(parafuso());

    expect(await prisma.referenciaProduto.count()).toBe(2);
    expect(await prisma.embalagem.count()).toBe(2);
  });
});

describe("Caixa — ida e volta pelo banco", () => {
  it("🔑 recompõe a gaveta com sangria e suprimento", async () => {
    const caixas = new CaixaRepositorioPrisma(prisma);
    const sessao = sessaoAberta();

    sessao
      .registrarSuprimento(proximoId(), reais("50,00"), "Troco do cofre", OPERADOR, AGORA)
      .unwrap();
    sessao
      .registrarSangria(
        proximoId(),
        reais("80,00"),
        "Retirada para o cofre",
        OPERADOR,
        AGORA,
        GERENTE,
      )
      .unwrap();

    await caixas.salvar(sessao);

    const lida = await caixas.porId(CAIXA);

    // 150 de fundo + 50 de suprimento − 80 de sangria.
    expect(lida?.esperadoEmDinheiro.formatar()).toBe("R$ 120,00");
    expect(lida?.movimentos).toHaveLength(2);
    expect(lida?.movimentos[1]?.autorizadoPorId?.equals(GERENTE)).toBe(true);
  });

  it("guarda os totais por forma e separa o crediário", async () => {
    const caixas = new CaixaRepositorioPrisma(prisma);
    const sessao = sessaoAberta();

    sessao
      .registrarVenda({
        vendaId: VENDA,
        total: reais("300,00"),
        pagamentos: [
          { forma: "DINHEIRO", valor: reais("100,00") },
          { forma: "CARTAO_CREDITO", valor: reais("120,00") },
          { forma: "CREDIARIO", valor: reais("80,00") },
        ],
        troco: Dinheiro.zero(),
      })
      .unwrap();

    await caixas.salvar(sessao);

    const lida = await caixas.porId(CAIXA);

    expect(lida?.totalVendido.formatar()).toBe("R$ 300,00");
    expect(lida?.quantidadeVendas).toBe(1);
    expect(lida?.recebidoEm("CARTAO_CREDITO").formatar()).toBe("R$ 120,00");
    // Crediário não passa pela gaveta: 150 de fundo + 100 em dinheiro.
    expect(lida?.esperadoEmDinheiro.formatar()).toBe("R$ 250,00");
    expect(lida?.totalAReceber.formatar()).toBe("R$ 80,00");
  });

  it("localiza a sessão aberta da estação e nenhuma depois de fechada", async () => {
    const caixas = new CaixaRepositorioPrisma(prisma);
    const sessao = sessaoAberta();
    await caixas.salvar(sessao);

    expect((await caixas.abertaNaEstacao(ESTACAO))?.id.equals(CAIXA)).toBe(true);

    sessao.fechar(reais("150,00"), new Date("2026-07-30T18:00:00.000Z")).unwrap();
    await caixas.salvar(sessao);

    expect(await caixas.abertaNaEstacao(ESTACAO)).toBeUndefined();

    const fechada = await caixas.porId(CAIXA);
    expect(fechada?.estaAberta).toBe(false);
    expect(fechada?.fechadaEm?.toISOString()).toBe("2026-07-30T18:00:00.000Z");
  });

  it("devolve nada quando a sessão não existe", async () => {
    const caixas = new CaixaRepositorioPrisma(prisma);

    expect(await caixas.porId(proximoId())).toBeUndefined();
    expect(await caixas.abertaNaEstacao(proximoId())).toBeUndefined();
  });
});

describe("Venda — ida e volta pelo banco", () => {
  async function vendaComItens(): Promise<Venda> {
    await new ProdutoRepositorioPrisma(prisma).salvar(parafuso());
    await new CaixaRepositorioPrisma(prisma).salvar(sessaoAberta());

    const venda = Venda.iniciar({
      id: VENDA,
      numero: 1,
      sessaoCaixaId: CAIXA,
      operadorId: OPERADOR,
      estacaoId: ESTACAO,
      clienteId: CLIENTE,
      abertaEm: AGORA,
    }).unwrap();

    venda
      .adicionarItem({
        produtoId: PARAFUSO,
        descricao: "PARAFUSO 3/8",
        quantidade: Quantidade.de("10", "UN").unwrap(),
        precoUnitario: reais("1,20"),
      })
      .unwrap();

    return venda;
  }

  it("🔑 devolve itens, pagamentos e cliente como foram gravados", async () => {
    const vendas = new VendaRepositorioPrisma(prisma);
    const venda = await vendaComItens();

    venda.aplicarDescontoVenda(reais("2,00")).unwrap();
    venda
      .registrarPagamento("CARTAO_CREDITO", reais("10,00"), {
        parcelas: 2,
        autorizacao: "NSU123",
      })
      .unwrap();

    await vendas.salvar(venda);

    const lida = await vendas.porId(VENDA);

    expect(lida?.clienteId?.equals(CLIENTE)).toBe(true);
    expect(lida?.itens).toHaveLength(1);
    expect(lida?.itens[0]?.descricao).toBe("PARAFUSO 3/8");
    expect(lida?.itens[0]?.quantidade.formatar()).toBe("10 un");
    expect(lida?.total.formatar()).toBe("R$ 10,00");
    expect(lida?.pagamentos[0]?.parcelas).toBe(2);
    expect(lida?.pagamentos[0]?.autorizacao).toBe("NSU123");
  });

  it("regravar a venda não duplica item nem pagamento", async () => {
    const vendas = new VendaRepositorioPrisma(prisma);
    const venda = await vendaComItens();
    venda.registrarPagamento("PIX", reais("12,00")).unwrap();

    await vendas.salvar(venda);
    await vendas.salvar(venda);

    expect(await prisma.vendaItem.count()).toBe(1);
    expect(await prisma.pagamento.count()).toBe(1);
  });

  it("numera a partir de 1 na estação sem venda alguma", async () => {
    expect(await new VendaRepositorioPrisma(prisma).proximoNumero(ESTACAO)).toBe(1);
  });

  it("devolve nada quando a venda não existe", async () => {
    expect(await new VendaRepositorioPrisma(prisma).porId(proximoId())).toBeUndefined();
  });
});

describe("Estoque — projeção e movimentos", () => {
  it("devolve saldo vazio para produto que nunca se moveu", async () => {
    await new ProdutoRepositorioPrisma(prisma).salvar(parafuso());

    const saldo = await new EstoqueRepositorioPrisma(prisma).saldo(PARAFUSO, "UN");

    expect(saldo.estaZerado).toBe(true);
    expect(saldo.custoMedio.ehZero()).toBe(true);
  });

  it("guarda lote, observação e documento de origem do movimento", async () => {
    await new ProdutoRepositorioPrisma(prisma).salvar(parafuso());
    const estoque = new EstoqueRepositorioPrisma(prisma);

    const perda = MovimentoEstoque.criar({
      id: proximoId(),
      produtoId: PARAFUSO,
      tipo: "PERDA",
      quantidade: Quantidade.de("3", "UN").unwrap(),
      origem: { tipo: "INVENTARIO", documentoId: VENDA },
      usuarioId: OPERADOR,
      ocorridoEm: AGORA,
      lote: "L-2026-07",
      observacao: "Caixa danificada no transporte",
    }).unwrap();

    await estoque.registrar(perda);

    const linha = await prisma.movimentoEstoque.findFirstOrThrow();
    expect(linha.lote).toBe("L-2026-07");
    expect(linha.observacao).toBe("Caixa danificada no transporte");
    expect(linha.origemDocumentoId).toBe(VENDA.valor);

    expect((await estoque.saldo(PARAFUSO, "UN")).quantidade.formatar()).toBe("-3 un");
  });
});

describe("Outbox", () => {
  it("não grava nada quando não há evento", async () => {
    await new OutboxRepositorioPrisma(prisma).enfileirar([]);

    expect(await prisma.eventoOutbox.count()).toBe(0);
  });

  it("🔑 preserva dinheiro e quantidade sem perder centavo nem milésimo", async () => {
    // O worker fiscal lê daqui para montar a nota. Um valor que chegue como
    // `{}` — que é o que `JSON.stringify` faz com objeto de campo privado —
    // viraria nota emitida com valor zerado.
    const evento: VendaFinalizada = {
      tipo: "VendaFinalizada",
      agregadoId: VENDA,
      ocorridoEm: AGORA,
      numero: 7,
      sessaoCaixaId: CAIXA,
      operadorId: OPERADOR,
      total: reais("1234,56"),
      itens: [{ produtoId: PARAFUSO, quantidade: Quantidade.de("1,250", "KG").unwrap() }],
      valorAReceber: Dinheiro.zero(),
    };

    await new OutboxRepositorioPrisma(prisma).enfileirar([evento]);

    const linha = await prisma.eventoOutbox.findFirstOrThrow();
    const payload = linha.payload as Record<string, unknown>;

    expect(linha.tipo).toBe("VendaFinalizada");
    expect(linha.agregadoId).toBe(VENDA.valor);
    expect(payload["total"]).toBe("123456");
    expect(payload["operadorId"]).toBe(OPERADOR.valor);
    expect(payload["ocorridoEm"]).toBe(AGORA.toISOString());
    expect(payload["itens"]).toEqual([
      { produtoId: PARAFUSO.valor, quantidade: { milesimos: "1250", unidade: "KG" } },
    ]);
  });

  it("serializa bigint solto e omite campo ausente", () => {
    const evento: EstoqueMovimentado = estoqueMovimentado(
      proximoId(),
      PARAFUSO,
      "SAIDA",
      -2000n,
      "UN",
      AGORA,
    );

    const payload = serializarEvento(evento) as Record<string, unknown>;

    expect(payload["delta"]).toBe("-2000");
    expect(payload["unidade"]).toBe("UN");
  });

  it("omite campo opcional ausente em vez de gravar nulo", () => {
    const payload = serializarEvento({
      tipo: "Teste",
      agregadoId: VENDA,
      ocorridoEm: AGORA,
      opcional: undefined,
      texto: "valor",
    } as never) as Record<string, unknown>;

    expect(Object.hasOwn(payload, "opcional")).toBe(false);
    expect(payload["texto"]).toBe("valor");
  });
});

describe("Cliente do banco", () => {
  it("é criado por função, não por instância de módulo", async () => {
    // Instância exportada abriria conexão no `import`, o que torna a ordem dos
    // imports parte do comportamento.
    const cliente = criarPrismaClient({ urlBanco: urlBancoDeTeste() });

    await expect(cliente.produto.count()).resolves.toBe(0);
    await cliente.$disconnect();
  });

  it("aceita ligar o registro de consultas para diagnóstico", async () => {
    const cliente = criarPrismaClient({
      urlBanco: urlBancoDeTeste(),
      registrarConsultas: true,
    });

    await cliente.$disconnect();
    expect(cliente).toBeDefined();
  });
});
