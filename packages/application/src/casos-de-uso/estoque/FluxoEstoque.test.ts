import {
  CodigoBarras,
  Dinheiro,
  Embalagem,
  Identificador,
  Produto,
  type Quantidade,
} from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";

import { RegistrarMovimento } from "./RegistrarMovimento.js";

const PRODUTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002").unwrap();
const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001").unwrap();
const AUSENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999").unwrap();

function montar() {
  const ambiente = montarAmbiente();

  return {
    ...ambiente,
    registrar: new RegistrarMovimento(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
  };
}

let cenario: ReturnType<typeof montar>;

/** Refrigerante em unidade, com fardo de 12 — o caso da mercearia. */
function refrigerante(): Produto {
  return Produto.criar({
    id: PRODUTO,
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: Dinheiro.deReais("9,90").unwrap(),
    codigoBarras: CodigoBarras.criar("7891000315507").unwrap(),
    embalagens: [Embalagem.criar("FD", 12n).unwrap()],
  }).unwrap();
}

beforeEach(() => {
  cenario = montar();
  cenario.produtos.adicionar(refrigerante());
});

function saldo(): Promise<Quantidade> {
  return cenario.estoque.saldo(PRODUTO, "UN").then((atual) => atual.quantidade);
}

describe("Entrada de mercadoria", () => {
  it("lança a entrada e o saldo sobe", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 10_000n,
      unidade: "UN",
      usuarioId: USUARIO,
    });

    expect(resultado.isOk()).toBe(true);
    expect((await saldo()).milesimos).toBe(10_000n);
  });

  it("🔑 recebeu 3 fardos, lança 36 unidades", async () => {
    // É a conta que o dono faz de cabeça na entrada da mercadoria — e é por
    // errá-la que o estoque nunca fecha.
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 3_000n,
      unidade: "FD",
      usuarioId: USUARIO,
    });

    expect(resultado.isOk()).toBe(true);
    expect((await saldo()).milesimos).toBe(36_000n);
    // O movimento gravado fica na unidade base, não na embalagem.
    expect(resultado.unwrap().quantidade.unidade.codigo).toBe("UN");
  });

  it("🔑 o custo do fardo vira custo da unidade", async () => {
    // R$ 60,00 o fardo de 12 é R$ 5,00 a unidade. Sem converter, o custo médio
    // do produto passaria a ser o preço do fardo, e a margem de todo relatório
    // iria junto.
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 1_000n,
      unidade: "FD",
      custoUnitario: 6000n,
      usuarioId: USUARIO,
    });

    const atual = await cenario.estoque.saldo(PRODUTO, "UN");
    expect(atual.custoMedio.centavos).toBe(500n);
  });

  it("calcula o custo médio ponderado entre duas entradas", async () => {
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 10_000n,
      unidade: "UN",
      custoUnitario: 300n,
      usuarioId: USUARIO,
    });
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 5_000n,
      unidade: "UN",
      custoUnitario: 400n,
      usuarioId: USUARIO,
    });

    const atual = await cenario.estoque.saldo(PRODUTO, "UN");
    expect(atual.custoMedio.centavos).toBe(333n);
  });

  it("🔑 entrada sem custo não zera o custo médio já formado", async () => {
    // É o lançamento de quem não pode ver custo. Recalcular com zero apagaria a
    // margem de um produto que ninguém mexeu de propósito.
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 10_000n,
      unidade: "UN",
      custoUnitario: 300n,
      usuarioId: USUARIO,
    });
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 5_000n,
      unidade: "UN",
      usuarioId: USUARIO,
    });

    const atual = await cenario.estoque.saldo(PRODUTO, "UN");
    expect(atual.custoMedio.centavos).toBe(300n);
    expect(atual.milesimos).toBe(15_000n);
  });

  it("recusa embalagem que o produto não tem cadastrada", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 1_000n,
      unidade: "CX",
      usuarioId: USUARIO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_EMBALAGEM_NAO_CADASTRADA");
    }
  });

  it("recusa produto que não existe", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: AUSENTE,
      tipo: "ENTRADA",
      quantidade: 1_000n,
      unidade: "UN",
      usuarioId: USUARIO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_NAO_ENCONTRADO");
    }
  });

  it("🔑 aceita movimento em produto inativo", async () => {
    // É como se dá baixa no que sobrou de um item que saiu de linha. Bloquear
    // deixaria saldo preso num produto que ninguém mais consegue mexer.
    const produto = refrigerante();
    produto.desativar(cenario.relogio.agora());
    cenario.produtos.adicionar(produto);

    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "DEVOLUCAO_FORNECEDOR",
      quantidade: 2_000n,
      unidade: "UN",
      observacao: "Resto do lote devolvido",
      usuarioId: USUARIO,
    });

    expect(resultado.isOk()).toBe(true);
  });
});

describe("Ajuste e perda", () => {
  beforeEach(async () => {
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 10_000n,
      unidade: "UN",
      usuarioId: USUARIO,
    });
  });

  it("perda desce o saldo", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "PERDA",
      quantidade: 2_000n,
      unidade: "UN",
      observacao: "Garrafas quebradas na descarga",
      usuarioId: USUARIO,
    });

    expect(resultado.isOk()).toBe(true);
    expect((await saldo()).milesimos).toBe(8_000n);
  });

  it("🔑 ajuste e perda exigem justificativa", async () => {
    // Ajuste sem motivo é a porta de saída preferida de quem desvia mercadoria.
    for (const tipo of ["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PERDA"] as const) {
      const resultado = await cenario.registrar.executar({
        produtoId: PRODUTO,
        tipo,
        quantidade: 1_000n,
        unidade: "UN",
        usuarioId: USUARIO,
      });

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("MOVIMENTO_JUSTIFICATIVA_OBRIGATORIA");
      }
    }
  });

  it("ajuste positivo não mexe no custo médio", async () => {
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 10_000n,
      unidade: "UN",
      custoUnitario: 300n,
      usuarioId: USUARIO,
    });

    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "AJUSTE_POSITIVO",
      quantidade: 5_000n,
      unidade: "UN",
      observacao: "Contagem encontrou a mais",
      usuarioId: USUARIO,
    });

    // Inventário corrige quantidade, não valor.
    const atual = await cenario.estoque.saldo(PRODUTO, "UN");
    expect(atual.custoMedio.centavos).toBe(300n);
    expect(atual.milesimos).toBe(25_000n);
  });

  it("🔑 saldo pode ficar negativo — a venda antes da nota é rotina", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "AJUSTE_NEGATIVO",
      quantidade: 15_000n,
      unidade: "UN",
      observacao: "Contagem encontrou a menos",
      usuarioId: USUARIO,
    });

    expect(resultado.isOk()).toBe(true);
    expect((await saldo()).milesimos).toBe(-5_000n);
  });

  it("guarda lote e observação para a rastreabilidade", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "PERDA",
      quantidade: 1_000n,
      unidade: "UN",
      lote: "L2026-07",
      observacao: "Vencido",
      usuarioId: USUARIO,
    });

    expect(resultado.unwrap().lote).toBe("L2026-07");
    expect(resultado.unwrap().observacao).toBe("Vencido");
    expect(resultado.unwrap().usuarioId.equals(USUARIO)).toBe(true);
  });

  it("recusa quantidade zero e negativa", async () => {
    const zero = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 0n,
      unidade: "UN",
      usuarioId: USUARIO,
    });

    expect(zero.isErr()).toBe(true);
    if (zero.isErr()) expect(zero.error.codigo).toBe("MOVIMENTO_QUANTIDADE_ZERO");

    const negativa = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: -1_000n,
      unidade: "UN",
      usuarioId: USUARIO,
    });

    expect(negativa.isErr()).toBe(true);
  });

  it("recusa custo que estoura o limite de dinheiro", async () => {
    const antes = cenario.estoque.movimentos.length;

    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 1_000n,
      unidade: "UN",
      custoUnitario: 10n ** 20n,
      usuarioId: USUARIO,
    });

    expect(resultado.isErr()).toBe(true);
    expect(cenario.estoque.movimentos).toHaveLength(antes);
  });

  it("recusa custo negativo", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 1_000n,
      unidade: "UN",
      custoUnitario: -100n,
      usuarioId: USUARIO,
    });

    expect(resultado.isErr()).toBe(true);
  });
});

describe("Movimentos que o sistema gera sozinho", () => {
  it.each(["SAIDA", "TRANSFERENCIA_ENTRADA", "TRANSFERENCIA_SAIDA"] as const)(
    "🔑 recusa %s por lançamento manual",
    async (tipo) => {
      // Saída manual seria mercadoria que sumiu do estoque sem sair do caixa —
      // e a conferência do mês não distinguiria isso de furto.
      const resultado = await cenario.registrar.executar({
        produtoId: PRODUTO,
        tipo,
        quantidade: 1_000n,
        unidade: "UN",
        observacao: "tentativa",
        usuarioId: USUARIO,
      });

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("MOVIMENTO_NAO_MANUAL");
      }
      expect(cenario.estoque.movimentos).toHaveLength(0);
    },
  );

  it("devolução de cliente entra e não mexe no custo", async () => {
    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 10_000n,
      unidade: "UN",
      custoUnitario: 300n,
      usuarioId: USUARIO,
    });

    await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "DEVOLUCAO_CLIENTE",
      quantidade: 1_000n,
      unidade: "UN",
      usuarioId: USUARIO,
    });

    const atual = await cenario.estoque.saldo(PRODUTO, "UN");
    expect(atual.milesimos).toBe(11_000n);
    expect(atual.custoMedio.centavos).toBe(300n);
  });

  it("guarda a origem quando ela vem informada", async () => {
    const documento = Identificador.criar(
      "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0055",
    ).unwrap();

    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 1_000n,
      unidade: "UN",
      origem: { tipo: "COMPRA", documentoId: documento },
      usuarioId: USUARIO,
    });

    expect(resultado.unwrap().origem.tipo).toBe("COMPRA");
    expect(resultado.unwrap().origem.documentoId?.equals(documento)).toBe(true);
  });

  it("sem origem informada, o movimento é manual", async () => {
    const resultado = await cenario.registrar.executar({
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: 1_000n,
      unidade: "UN",
      usuarioId: USUARIO,
    });

    expect(resultado.unwrap().origem.tipo).toBe("MANUAL");
  });
});
