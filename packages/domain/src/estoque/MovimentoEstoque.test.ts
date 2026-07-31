import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import { type DadosMovimento, MovimentoEstoque } from "./MovimentoEstoque.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a61").unwrap();
const PRODUTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a62").unwrap();
const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a63").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

function qtd(valor: string, unidade: "UN" | "KG" = "UN"): Quantidade {
  return Quantidade.de(valor, unidade).unwrap();
}

function dados(sobrescritas: Partial<DadosMovimento> = {}): DadosMovimento {
  return {
    id: ID,
    produtoId: PRODUTO,
    tipo: "ENTRADA",
    quantidade: qtd("10"),
    origem: { tipo: "COMPRA" },
    usuarioId: USUARIO,
    ocorridoEm: AGORA,
    ...sobrescritas,
  };
}

function criar(sobrescritas: Partial<DadosMovimento> = {}): MovimentoEstoque {
  const resultado = MovimentoEstoque.criar(dados(sobrescritas));
  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

describe("MovimentoEstoque — criação", () => {
  it("cria entrada de compra", () => {
    const movimento = criar();

    expect(movimento.tipo).toBe("ENTRADA");
    expect(movimento.quantidade.milesimos).toBe(10000n);
    expect(movimento.origem.tipo).toBe("COMPRA");
  });

  it("guarda o documento de origem para rastreio", () => {
    const vendaId = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a64").unwrap();

    const movimento = criar({
      tipo: "SAIDA",
      origem: { tipo: "VENDA", documentoId: vendaId },
    });

    expect(movimento.origem.documentoId?.equals(vendaId)).toBe(true);
  });

  it("aceita lote, necessário para perecível", () => {
    expect(criar({ lote: "L20260730" }).lote).toBe("L20260730");
  });

  it("trata lote em branco como ausente", () => {
    expect(criar({ lote: "   " }).lote).toBeUndefined();
  });

  it("rejeita quantidade negativa — o sinal vem do tipo, não do número", () => {
    const resultado = MovimentoEstoque.criar(dados({ quantidade: qtd("5").negar() }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("MOVIMENTO_QUANTIDADE_NEGATIVA");
      expect(resultado.error.mensagem).toContain("entrada ou saída");
    }
  });

  it("rejeita quantidade zero", () => {
    const resultado = MovimentoEstoque.criar(dados({ quantidade: qtd("0") }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("MOVIMENTO_QUANTIDADE_ZERO");
    }
  });

  it("rejeita custo unitário negativo", () => {
    const resultado = MovimentoEstoque.criar(
      dados({ custoUnitario: Dinheiro.deReais("-1,00").unwrap() }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("MOVIMENTO_CUSTO_NEGATIVO");
    }
  });
});

describe("MovimentoEstoque — justificativa obrigatória", () => {
  it.each(["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PERDA"] as const)(
    "exige motivo em %s — ajuste sem justificativa é rota de desvio",
    (tipo) => {
      const resultado = MovimentoEstoque.criar(dados({ tipo }));

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("MOVIMENTO_JUSTIFICATIVA_OBRIGATORIA");
      }
    },
  );

  it("rejeita motivo em branco", () => {
    const resultado = MovimentoEstoque.criar(dados({ tipo: "PERDA", observacao: "   " }));

    expect(resultado.isErr()).toBe(true);
  });

  it("aceita ajuste com motivo informado", () => {
    const movimento = criar({
      tipo: "AJUSTE_NEGATIVO",
      observacao: "Contagem de inventário de julho",
    });

    expect(movimento.observacao).toBe("Contagem de inventário de julho");
  });

  it("não exige motivo em entrada e saída normais", () => {
    expect(MovimentoEstoque.criar(dados({ tipo: "ENTRADA" })).isOk()).toBe(true);
    expect(MovimentoEstoque.criar(dados({ tipo: "SAIDA" })).isOk()).toBe(true);
  });

  it("trata observação em branco como ausente quando não é obrigatória", () => {
    expect(criar({ observacao: "   " }).observacao).toBeUndefined();
  });
});

describe("MovimentoEstoque — delta", () => {
  it.each([
    ["ENTRADA", 10000n],
    ["DEVOLUCAO_CLIENTE", 10000n],
    ["TRANSFERENCIA_ENTRADA", 10000n],
  ] as const)("%s soma ao saldo", (tipo, esperado) => {
    expect(criar({ tipo }).delta).toBe(esperado);
  });

  it.each([
    ["SAIDA", -10000n],
    ["DEVOLUCAO_FORNECEDOR", -10000n],
    ["TRANSFERENCIA_SAIDA", -10000n],
  ] as const)("%s subtrai do saldo", (tipo, esperado) => {
    expect(criar({ tipo }).delta).toBe(esperado);
  });

  it("ajuste positivo soma", () => {
    expect(criar({ tipo: "AJUSTE_POSITIVO", observacao: "inventário" }).delta).toBe(
      10000n,
    );
  });

  it("ajuste negativo e perda subtraem", () => {
    expect(criar({ tipo: "AJUSTE_NEGATIVO", observacao: "inventário" }).delta).toBe(
      -10000n,
    );
    expect(criar({ tipo: "PERDA", observacao: "vencimento" }).delta).toBe(-10000n);
  });

  it("classifica saída", () => {
    expect(criar({ tipo: "SAIDA" }).ehSaida).toBe(true);
    expect(criar({ tipo: "ENTRADA" }).ehSaida).toBe(false);
  });

  it("calcula delta fracionado para produto pesável", () => {
    const movimento = criar({ tipo: "SAIDA", quantidade: qtd("1,250", "KG") });

    expect(movimento.delta).toBe(-1250n);
  });
});

describe("MovimentoEstoque — custo médio", () => {
  it("entrada com custo atualiza o custo médio", () => {
    const movimento = criar({ custoUnitario: Dinheiro.deReais("3,00").unwrap() });

    expect(movimento.atualizaCustoMedio).toBe(true);
  });

  it("entrada sem custo informado não atualiza", () => {
    expect(criar().atualizaCustoMedio).toBe(false);
  });

  it.each(["DEVOLUCAO_CLIENTE", "AJUSTE_POSITIVO", "TRANSFERENCIA_ENTRADA"] as const)(
    "%s não atualiza o custo médio, mesmo com custo informado",
    (tipo) => {
      // Devolução retorna mercadoria já custeada; ajuste corrige quantidade,
      // não valor. Tratá-los como compra distorceria a margem.
      const sobrescritas: Partial<DadosMovimento> = {
        tipo,
        custoUnitario: Dinheiro.deReais("3,00").unwrap(),
      };
      const movimento = criar(
        tipo === "AJUSTE_POSITIVO"
          ? { ...sobrescritas, observacao: "inventário" }
          : sobrescritas,
      );

      expect(movimento.atualizaCustoMedio).toBe(false);
    },
  );
});

describe("MovimentoEstoque — identidade", () => {
  it("é imutável: não expõe forma de alterar o fato registrado", () => {
    const movimento = criar();

    expect(movimento.quantidade.milesimos).toBe(10000n);
    expect(movimento.ocorridoEm).toBe(AGORA);
  });

  it("compara por identificador", () => {
    expect(criar().equals(criar({ tipo: "SAIDA" }))).toBe(true);
  });
});

describe("MovimentoEstoque — rastreabilidade", () => {
  it("guarda quem fez o movimento", () => {
    // Auditoria: ajuste de estoque sem autor é ajuste sem responsável.
    expect(criar().usuarioId.equals(USUARIO)).toBe(true);
  });

  it("guarda quando ocorreu, segundo o relógio injetado", () => {
    expect(criar().ocorridoEm).toBe(AGORA);
  });

  it("guarda a qual produto pertence", () => {
    expect(criar().produtoId.equals(PRODUTO)).toBe(true);
  });

  it("expõe o custo unitário registrado", () => {
    const custo = Dinheiro.deReais("3,00").unwrap();

    expect(criar({ custoUnitario: custo }).custoUnitario?.formatar()).toBe("R$ 3,00");
  });

  it("não tem custo quando não foi informado", () => {
    expect(criar().custoUnitario).toBeUndefined();
  });
});
