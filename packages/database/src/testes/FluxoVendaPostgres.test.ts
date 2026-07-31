import {
  AdicionarItemPorCodigo,
  FinalizarVenda,
  type GeradorId,
  IniciarVenda,
  RegistrarPagamento,
  type Relogio,
} from "@erp/application";
import {
  CodigoBarras,
  Dinheiro,
  Identificador,
  LAYOUT_BALANCA_PADRAO,
  MovimentoEstoque,
  Produto,
  Quantidade,
  SessaoCaixa,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CaixaRepositorioPrisma } from "../repositorios/CaixaRepositorioPrisma.js";
import { EstoqueRepositorioPrisma } from "../repositorios/EstoqueRepositorioPrisma.js";
import { ProdutoRepositorioPrisma } from "../repositorios/ProdutoRepositorioPrisma.js";
import { UnitOfWorkPrisma } from "../UnitOfWorkPrisma.js";
import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7001").unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7002").unwrap();
const CAIXA_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7003").unwrap();
const REFRI_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7005").unwrap();
const PICANHA_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7006").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

const prisma = criarClienteDeTeste();
const unitOfWork = new UnitOfWorkPrisma(prisma);

const relogio: Relogio = { agora: () => AGORA };

/** Sequencial e determinístico: o teste precisa saber que id foi gerado. */
function geradorSequencial(): GeradorId {
  let contador = 0;
  return {
    proximo: () => {
      contador += 1;
      const sufixo = contador.toString().padStart(12, "0");
      return Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-${sufixo}`).unwrap();
    },
  };
}

const iniciarVenda = new IniciarVenda(unitOfWork, relogio, geradorSequencial());
const adicionarItem = new AdicionarItemPorCodigo(unitOfWork, LAYOUT_BALANCA_PADRAO);
const registrarPagamento = new RegistrarPagamento(unitOfWork);
const finalizarVenda = new FinalizarVenda(unitOfWork, relogio, geradorSequencial());

function refrigerante(): Produto {
  return Produto.criar({
    id: REFRI_ID,
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    descricaoPdv: "REFRI COLA 2L",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: reais("9,90"),
    custo: reais("6,50"),
    codigoBarras: CodigoBarras.criar("7891000315507").unwrap(),
  }).unwrap();
}

function picanha(): Produto {
  return Produto.criar({
    id: PICANHA_ID,
    sku: "CAR010",
    descricao: "Picanha Bovina",
    tipo: "PESAVEL",
    unidadeBase: "KG",
    precoVenda: reais("79,90"),
    codigoBalanca: "012345",
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

  const produtos = new ProdutoRepositorioPrisma(prisma);
  await produtos.salvar(refrigerante());
  await produtos.salvar(picanha());

  await new CaixaRepositorioPrisma(prisma).salvar(
    SessaoCaixa.abrir({
      id: CAIXA_ID,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
      abertaEm: AGORA,
    }).unwrap(),
  );
});

describe("Fluxo de venda contra PostgreSQL", () => {
  it("🔑 roda o mesmo fluxo do balcão sem mudar uma linha do caso de uso", async () => {
    // É o teste que cobra a promessa da arquitetura hexagonal. Os mesmos casos
    // de uso que rodam contra repositórios em memória em `@erp/application`
    // rodam aqui contra Postgres, transação e gatilho de verdade. Se a
    // abstração vazasse, seria aqui que apareceria.
    const venda = (
      await iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    await adicionarItem.executar({ vendaId: venda.id, codigo: "7891000315507" });
    await adicionarItem.executar({ vendaId: venda.id, codigo: "7891000315507" });

    const pago = (
      await registrarPagamento.executar({
        vendaId: venda.id,
        forma: "DINHEIRO",
        valor: reais("20,00"),
      })
    ).unwrap();

    expect(pago.troco.formatar()).toBe("R$ 0,20");

    const fechada = (await finalizarVenda.executar({ vendaId: venda.id })).unwrap();

    expect(fechada.venda.status).toBe("FINALIZADA");
    expect(fechada.venda.total.formatar()).toBe("R$ 19,80");

    // O estado ficou **no banco**, não só na memória do processo.
    const gravada = await prisma.venda.findUniqueOrThrow({
      where: { id: venda.id.valor },
      include: { itens: true, pagamentos: true },
    });

    expect(gravada.status).toBe("FINALIZADA");
    expect(gravada.itens).toHaveLength(2);
    expect(gravada.pagamentos).toHaveLength(1);
    expect(gravada.troco).toBe(20n);

    // Estoque baixado e projeção atualizada.
    const movimentos = await prisma.movimentoEstoque.findMany({
      where: { produtoId: REFRI_ID.valor },
    });
    expect(movimentos).toHaveLength(2);
    expect(movimentos.every((m) => m.tipo === "SAIDA")).toBe(true);

    const saldo = await prisma.saldoEstoque.findUniqueOrThrow({
      where: { produtoId: REFRI_ID.valor },
    });
    expect(saldo.milesimos).toBe(-2000n);

    // Caixa creditado, já descontado o troco.
    const caixa = await new CaixaRepositorioPrisma(prisma).porId(CAIXA_ID);
    expect(caixa?.esperadoEmDinheiro.formatar()).toBe("R$ 119,80");
    expect(caixa?.quantidadeVendas).toBe(1);

    // Evento na fila, gravado na mesma transação da venda.
    const outbox = await prisma.eventoOutbox.findMany();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.tipo).toBe("VendaFinalizada");
    expect(outbox[0]?.status).toBe("PENDENTE");
  });

  it("🔑 desfaz tudo quando o caso de uso devolve erro", async () => {
    // O que a transação protege é exatamente isto: nada de estoque baixado de
    // venda que não existe, nada de nota fiscal de venda revertida.
    const venda = (
      await iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    await adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });

    // Sem pagamento suficiente, `finalizar` recusa.
    const resultado = await finalizarVenda.executar({ vendaId: venda.id });

    expect(resultado.isErr()).toBe(true);

    const gravada = await prisma.venda.findUniqueOrThrow({
      where: { id: venda.id.valor },
    });
    expect(gravada.status).toBe("ABERTA");

    expect(await prisma.movimentoEstoque.count()).toBe(0);
    expect(await prisma.eventoOutbox.count()).toBe(0);
  });

  it("lê o produto pela etiqueta da balança gravada no cadastro", async () => {
    const venda = (
      await iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    // 2 · 012345 · 01250 · 9 → picanha, 1,250 kg
    const item = (
      await adicionarItem.executar({ vendaId: venda.id, codigo: "2012345012509" })
    ).unwrap();

    expect(item.descricao).toBe("Picanha Bovina");
    expect(item.quantidade.formatar()).toBe("1,25 kg");
    expect(item.total.formatar()).toBe("R$ 99,88");
  });

  it("numera as vendas em sequência dentro da série da estação", async () => {
    const primeira = (
      await iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    const segunda = (
      await iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    expect(primeira.numero).toBe(1);
    expect(segunda.numero).toBe(2);
  });
});

describe("Garantias que só o banco oferece", () => {
  it("🔑 recusa alterar um movimento de estoque já gravado", async () => {
    const venda = (
      await iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    await adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });
    await registrarPagamento.executar({
      vendaId: venda.id,
      forma: "PIX",
      valor: reais("9,90"),
    });
    await finalizarVenda.executar({ vendaId: venda.id });

    const movimento = await prisma.movimentoEstoque.findFirstOrThrow();

    // Append-only não é convenção: é gatilho. Um script de correção mal escrito
    // esbarra nele antes de destruir o histórico do inventário.
    await expect(
      prisma.movimentoEstoque.update({
        where: { id: movimento.id },
        data: { quantidade: 1n },
      }),
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.movimentoEstoque.delete({ where: { id: movimento.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it("🔑 recusa duas sessões de caixa abertas na mesma estação", async () => {
    const outra = SessaoCaixa.abrir({
      id: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7009").unwrap(),
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("50,00"),
      abertaEm: AGORA,
    }).unwrap();

    await expect(new CaixaRepositorioPrisma(prisma).salvar(outra)).rejects.toThrow();
  });

  it("recusa pagamento com valor zero", async () => {
    const venda = (
      await iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    await expect(
      prisma.pagamento.create({
        data: { vendaId: venda.id.valor, ordem: 1, forma: "DINHEIRO", valor: 0n },
      }),
    ).rejects.toThrow();
  });
});

describe("Persistência do catálogo", () => {
  it("volta com o produto idêntico ao que foi gravado", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);
    const lido = await produtos.porId(REFRI_ID);

    expect(lido?.sku).toBe("REF001");
    expect(lido?.descricaoPdv).toBe("REFRI COLA 2L");
    expect(lido?.precoVenda.formatar()).toBe("R$ 9,90");
    expect(lido?.custo.formatar()).toBe("R$ 6,50");
    expect(lido?.codigoBarras?.valor).toBe("7891000315507");
  });

  it.each([
    ["código de barras", "7891000315507"],
    ["SKU", "REF001"],
    ["SKU em minúsculas", "ref001"],
  ])("encontra o produto por %s", async (_descricao, codigo) => {
    const encontrado = await new ProdutoRepositorioPrisma(prisma).porCodigo(codigo);
    expect(encontrado?.id.equals(REFRI_ID)).toBe(true);
  });

  it("regrava referências e embalagens sem duplicar", async () => {
    const produtos = new ProdutoRepositorioPrisma(prisma);

    await produtos.salvar(refrigerante());
    await produtos.salvar(refrigerante());

    expect(
      await prisma.referenciaProduto.count({ where: { produtoId: REFRI_ID.valor } }),
    ).toBe(0);
    expect(await prisma.embalagem.count({ where: { produtoId: REFRI_ID.valor } })).toBe(
      0,
    );
  });
});

describe("Projeção de saldo", () => {
  it("acumula os movimentos em vez de sobrescrever o saldo", async () => {
    const estoque = new EstoqueRepositorioPrisma(prisma);

    const entrada = (
      sufixo: string,
      quantidade: string,
      custo: string,
    ): MovimentoEstoque =>
      MovimentoEstoque.criar({
        id: Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7${sufixo}`).unwrap(),
        produtoId: REFRI_ID,
        tipo: "ENTRADA",
        quantidade: Quantidade.de(quantidade, "UN").unwrap(),
        origem: { tipo: "COMPRA" },
        usuarioId: OPERADOR,
        ocorridoEm: AGORA,
        custoUnitario: reais(custo),
      }).unwrap();

    await estoque.registrar(entrada("101", "10", "3,00"));
    await estoque.registrar(entrada("102", "5", "4,00"));

    const saldo = await estoque.saldo(REFRI_ID, "UN");

    expect(saldo.quantidade.formatar()).toBe("15 un");
    // 10 a R$ 3,00 e 5 a R$ 4,00 → 50 ÷ 15 = R$ 3,33.
    expect(saldo.custoMedio.formatar()).toBe("R$ 3,33");
  });
});
