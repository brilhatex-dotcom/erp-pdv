import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import { type DadosMovimento, MovimentoEstoque } from "./MovimentoEstoque.js";
import { SaldoEstoque } from "./SaldoEstoque.js";
import type { TipoMovimento } from "./TipoMovimento.js";

const PRODUTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a62").unwrap();
const OUTRO_PRODUTO = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a65",
).unwrap();
const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a63").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

let contador = 0;

/** Cada movimento precisa de identificador próprio. */
function proximoId(): Identificador {
  contador += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-${contador.toString().padStart(12, "0")}`,
  ).unwrap();
}

function movimento(
  tipo: TipoMovimento,
  quantidade: string,
  extras: Partial<DadosMovimento> = {},
): MovimentoEstoque {
  const precisaMotivo =
    tipo === "AJUSTE_POSITIVO" || tipo === "AJUSTE_NEGATIVO" || tipo === "PERDA";

  const resultado = MovimentoEstoque.criar({
    id: proximoId(),
    produtoId: PRODUTO,
    tipo,
    quantidade: Quantidade.de(quantidade, "UN").unwrap(),
    origem: { tipo: "MANUAL" },
    usuarioId: USUARIO,
    ocorridoEm: AGORA,
    ...(precisaMotivo ? { observacao: "teste" } : {}),
    ...extras,
  });

  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

/** Todas as permutações de uma lista — para provar independência de ordem. */
function permutacoes<T>(itens: readonly T[]): T[][] {
  if (itens.length <= 1) return [[...itens]];

  const resultado: T[][] = [];
  for (const [indice, item] of itens.entries()) {
    const restantes = [...itens.slice(0, indice), ...itens.slice(indice + 1)];
    for (const permutacao of permutacoes(restantes)) {
      resultado.push([item, ...permutacao]);
    }
  }
  return resultado;
}

describe("SaldoEstoque — projeção", () => {
  it("começa zerado", () => {
    const saldo = SaldoEstoque.vazio(PRODUTO, "UN");

    expect(saldo.estaZerado).toBe(true);
    expect(saldo.milesimos).toBe(0n);
    expect(saldo.custoMedio.ehZero()).toBe(true);
  });

  it("soma uma entrada", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10"),
    ]).unwrap();

    expect(saldo.quantidade.formatar()).toBe("10 un");
  });

  it("subtrai uma saída", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10"),
      movimento("SAIDA", "3"),
    ]).unwrap();

    expect(saldo.quantidade.formatar()).toBe("7 un");
  });

  it("projeta lista vazia como saldo zerado", () => {
    expect(SaldoEstoque.projetar(PRODUTO, "UN", []).unwrap().estaZerado).toBe(true);
  });

  it("combina todos os tipos de movimento", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "100"),
      movimento("SAIDA", "30"),
      movimento("DEVOLUCAO_CLIENTE", "5"),
      movimento("PERDA", "2"),
      movimento("AJUSTE_NEGATIVO", "3"),
      movimento("TRANSFERENCIA_SAIDA", "10"),
      movimento("TRANSFERENCIA_ENTRADA", "4"),
      movimento("DEVOLUCAO_FORNECEDOR", "1"),
      movimento("AJUSTE_POSITIVO", "7"),
    ]).unwrap();

    // 100 − 30 + 5 − 2 − 3 − 10 + 4 − 1 + 7 = 70
    expect(saldo.quantidade.formatar()).toBe("70 un");
  });
});

describe("SaldoEstoque — comutatividade (ADR-0007)", () => {
  it("🔑 produz o mesmo saldo em QUALQUER ordem dos movimentos", () => {
    // Esta é a garantia central: é ela que permite duas estações de PDV
    // convergirem sem trava distribuída. Com saldo mutável, uma venda
    // sobrescreveria a outra e a loja perderia estoque sem perceber.
    const movimentos = [
      movimento("ENTRADA", "100"),
      movimento("SAIDA", "30"),
      movimento("SAIDA", "20"),
      movimento("DEVOLUCAO_CLIENTE", "5"),
      movimento("PERDA", "2"),
    ];

    const ordens = permutacoes(movimentos);
    expect(ordens).toHaveLength(120);

    const saldos = ordens.map(
      (ordem) => SaldoEstoque.projetar(PRODUTO, "UN", ordem).unwrap().milesimos,
    );

    // 100 − 30 − 20 + 5 − 2 = 53
    expect(new Set(saldos.map(String)).size).toBe(1);
    expect(saldos[0]).toBe(53000n);
  });

  it("converge mesmo quando duas estações vendem ao mesmo tempo", () => {
    // PDV 1 vende 3, PDV 2 vende 2, e os movimentos chegam fora de ordem.
    const entrada = movimento("ENTRADA", "10");
    const vendaPdv1 = movimento("SAIDA", "3");
    const vendaPdv2 = movimento("SAIDA", "2");

    const ordemA = SaldoEstoque.projetar(PRODUTO, "UN", [
      entrada,
      vendaPdv1,
      vendaPdv2,
    ]).unwrap();

    const ordemB = SaldoEstoque.projetar(PRODUTO, "UN", [
      entrada,
      vendaPdv2,
      vendaPdv1,
    ]).unwrap();

    expect(ordemA.milesimos).toBe(ordemB.milesimos);
    expect(ordemA.quantidade.formatar()).toBe("5 un");
  });

  it("aplicar um a um dá o mesmo que projetar de uma vez", () => {
    const movimentos = [
      movimento("ENTRADA", "50"),
      movimento("SAIDA", "12"),
      movimento("SAIDA", "8"),
    ];

    const deUmaVez = SaldoEstoque.projetar(PRODUTO, "UN", movimentos).unwrap();

    let umAUm = SaldoEstoque.vazio(PRODUTO, "UN");
    for (const atual of movimentos) {
      umAUm = umAUm.aplicar(atual).unwrap();
    }

    expect(umAUm.milesimos).toBe(deUmaVez.milesimos);
  });
});

describe("SaldoEstoque — saldo negativo", () => {
  it("permite saldo negativo — venda lançada antes da nota de compra", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("SAIDA", "5"),
    ]).unwrap();

    expect(saldo.estaNegativo).toBe(true);
    expect(saldo.quantidade.formatar()).toBe("-5 un");
  });

  it("volta ao positivo quando a entrada é lançada depois", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("SAIDA", "5"),
      movimento("ENTRADA", "12"),
    ]).unwrap();

    expect(saldo.estaNegativo).toBe(false);
    expect(saldo.quantidade.formatar()).toBe("7 un");
  });
});

describe("SaldoEstoque — disponibilidade", () => {
  const saldoDez = SaldoEstoque.projetar(PRODUTO, "UN", [
    movimento("ENTRADA", "10"),
  ]).unwrap();

  it("permite retirada por padrão, mesmo sem saldo — o PDV nunca para", () => {
    expect(saldoDez.podeRetirar(Quantidade.de("50", "UN").unwrap()).isOk()).toBe(true);
  });

  it("bloqueia quando a loja exige controle rigoroso", () => {
    const resultado = saldoDez.podeRetirar(Quantidade.de("50", "UN").unwrap(), false);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ESTOQUE_INSUFICIENTE");
      // Mensagem informa o disponível, para o operador decidir na hora.
      expect(resultado.error.mensagem).toContain("10 un");
    }
  });

  it("permite retirar exatamente o disponível com bloqueio ligado", () => {
    expect(saldoDez.podeRetirar(Quantidade.de("10", "UN").unwrap(), false).isOk()).toBe(
      true,
    );
  });

  it("recusa quantidade em unidade diferente", () => {
    const resultado = saldoDez.podeRetirar(Quantidade.de("1", "KG").unwrap());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ESTOQUE_UNIDADE_DIFERENTE");
    }
  });
});

describe("SaldoEstoque — estoque mínimo", () => {
  it("acusa necessidade de reposição no limite", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "5"),
    ]).unwrap();

    expect(saldo.precisaRepor(Quantidade.de("5", "UN").unwrap())).toBe(true);
    expect(saldo.precisaRepor(Quantidade.de("4", "UN").unwrap())).toBe(false);
  });

  it("acusa reposição com saldo negativo", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("SAIDA", "1"),
    ]).unwrap();

    expect(saldo.precisaRepor(Quantidade.de("0", "UN").unwrap())).toBe(true);
  });
});

describe("SaldoEstoque — custo médio ponderado móvel", () => {
  it("assume o custo da primeira entrada", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 3,00");
  });

  it("pondera pela quantidade nas entradas seguintes", () => {
    // 10 a R$ 3,00 + 5 a R$ 4,00 → (30 + 20) / 15 = R$ 3,33
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
      movimento("ENTRADA", "5", { custoUnitario: reais("4,00") }),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 3,33");
  });

  it("saída não altera o custo médio", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
      movimento("SAIDA", "4"),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 3,00");
    expect(saldo.quantidade.formatar()).toBe("6 un");
  });

  it("devolução de cliente não altera o custo — mercadoria já custeada", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
      movimento("DEVOLUCAO_CLIENTE", "5", { custoUnitario: reais("99,00") }),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 3,00");
  });

  it("ajuste de inventário não altera o custo — corrige quantidade, não valor", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
      movimento("AJUSTE_POSITIVO", "2", { custoUnitario: reais("99,00") }),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 3,00");
  });

  it("entrada sem custo informado preserva o custo vigente", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
      movimento("ENTRADA", "5"),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 3,00");
  });

  it("🔑 assume o custo da entrada quando o custo anterior nunca foi informado", () => {
    // Zero significa "não informado", não "de graça". Ponderar 10 unidades a
    // custo zero contra 10 a R$ 3,00 daria R$ 1,50 — metade do que a loja
    // pagou. O relatório mostraria o dobro da margem real, que é o pior tipo
    // de erro: o que faz o número parecer melhor.
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10"),
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 3,00");
    expect(saldo.quantidade.formatar()).toBe("20 un");
  });

  it("assume o custo da entrada quando o saldo estava negativo", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("SAIDA", "5"),
      movimento("ENTRADA", "10", { custoUnitario: reais("7,50") }),
    ]).unwrap();

    expect(saldo.custoMedio.formatar()).toBe("R$ 7,50");
  });

  it("calcula o valor imobilizado em estoque", () => {
    const saldo = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10", { custoUnitario: reais("3,00") }),
    ]).unwrap();

    expect(saldo.valorEmEstoque.formatar()).toBe("R$ 30,00");
  });
});

describe("SaldoEstoque — validação", () => {
  it("recusa movimento de outro produto", () => {
    const alheio = MovimentoEstoque.criar({
      id: proximoId(),
      produtoId: OUTRO_PRODUTO,
      tipo: "ENTRADA",
      quantidade: Quantidade.de("5", "UN").unwrap(),
      origem: { tipo: "MANUAL" },
      usuarioId: USUARIO,
      ocorridoEm: AGORA,
    }).unwrap();

    const resultado = SaldoEstoque.vazio(PRODUTO, "UN").aplicar(alheio);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("SALDO_PRODUTO_DIFERENTE");
    }
  });

  it("recusa movimento em unidade diferente da do produto", () => {
    const emQuilos = MovimentoEstoque.criar({
      id: proximoId(),
      produtoId: PRODUTO,
      tipo: "ENTRADA",
      quantidade: Quantidade.de("5", "KG").unwrap(),
      origem: { tipo: "MANUAL" },
      usuarioId: USUARIO,
      ocorridoEm: AGORA,
    }).unwrap();

    const resultado = SaldoEstoque.vazio(PRODUTO, "UN").aplicar(emQuilos);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("SALDO_UNIDADE_DIFERENTE");
    }
  });

  it("propaga o erro ao projetar lista com movimento inválido", () => {
    const alheio = MovimentoEstoque.criar({
      id: proximoId(),
      produtoId: OUTRO_PRODUTO,
      tipo: "ENTRADA",
      quantidade: Quantidade.de("5", "UN").unwrap(),
      origem: { tipo: "MANUAL" },
      usuarioId: USUARIO,
      ocorridoEm: AGORA,
    }).unwrap();

    expect(
      SaldoEstoque.projetar(PRODUTO, "UN", [movimento("ENTRADA", "1"), alheio]).isErr(),
    ).toBe(true);
  });

  it("expõe o produto ao qual pertence", () => {
    expect(SaldoEstoque.vazio(PRODUTO, "UN").produtoId.equals(PRODUTO)).toBe(true);
  });

  it("é imutável: aplicar devolve novo saldo sem alterar o anterior", () => {
    const inicial = SaldoEstoque.projetar(PRODUTO, "UN", [
      movimento("ENTRADA", "10"),
    ]).unwrap();

    inicial.aplicar(movimento("SAIDA", "4"));

    expect(inicial.quantidade.formatar()).toBe("10 un");
  });
});

describe("SaldoEstoque — reconstituição", () => {
  // A projeção materializada existe para não somar milhões de movimentos a
  // cada bipada (RNF-02). Reconstituir é o caminho que torna isso possível.
  it("volta com quantidade e custo médio exatamente como foram gravados", () => {
    const saldo = SaldoEstoque.reconstituir(PRODUTO, "UN", 15_000n, reais("3,33"));

    expect(saldo.produtoId.equals(PRODUTO)).toBe(true);
    expect(saldo.quantidade.formatar()).toBe("15 un");
    expect(saldo.custoMedio.formatar()).toBe("R$ 3,33");
  });

  it("aceita saldo negativo — venda lançada antes da nota de compra", () => {
    const saldo = SaldoEstoque.reconstituir(PRODUTO, "UN", -2000n, Dinheiro.zero());

    expect(saldo.estaNegativo).toBe(true);
  });

  it("continua somando a partir do saldo reconstituído", () => {
    const saldo = SaldoEstoque.reconstituir(PRODUTO, "UN", 10_000n, reais("3,00"));

    const atualizado = saldo
      .aplicar(
        MovimentoEstoque.criar({
          id: proximoId(),
          produtoId: PRODUTO,
          tipo: "SAIDA",
          quantidade: Quantidade.de("4", "UN").unwrap(),
          origem: { tipo: "VENDA" },
          usuarioId: USUARIO,
          ocorridoEm: AGORA,
        }).unwrap(),
      )
      .unwrap();

    expect(atualizado.quantidade.formatar()).toBe("6 un");
  });
});
