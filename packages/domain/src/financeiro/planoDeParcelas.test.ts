import { describe, expect, it } from "vitest";

import { Dinheiro } from "../valores/Dinheiro.js";
import {
  DIAS_ENTRE_PARCELAS_PADRAO,
  DIAS_PRIMEIRO_VENCIMENTO_PADRAO,
  montarPlanoDeParcelas,
} from "./planoDeParcelas.js";

/**
 * A divisão da venda a prazo.
 *
 * O erro que importa aqui é de um centavo — e um centavo é exatamente o que o
 * cliente encontra somando as parcelas do carnê e comparando com o total da
 * nota. Divergência de centavo em documento de cobrança destrói a confiança no
 * sistema inteiro, porque quem a encontra não tem como saber se é só ali.
 */

const EMISSAO = new Date("2026-08-01T14:30:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function plano(total: string, parcelas: number, extras = {}) {
  return montarPlanoDeParcelas({
    total: reais(total),
    parcelas,
    emitidoEm: EMISSAO,
    ...extras,
  }).unwrap();
}

describe("divisão do valor", () => {
  it("🔑 a soma das parcelas bate exatamente com o total", () => {
    // É a propriedade que o cliente confere no carnê. Arredondar cada parcela
    // por conta própria perderia centavos e criaria uma dívida que não fecha.
    for (const [total, partes] of [
      ["100,00", 3],
      ["10,00", 3],
      ["0,01", 1],
      ["999,99", 7],
      ["1,00", 6],
    ] as const) {
      const parcelas = plano(total, partes);

      const soma = parcelas.reduce(
        (acumulado, parcela) => acumulado.somar(parcela.valor),
        Dinheiro.zero(),
      );

      expect(soma.paraDecimal()).toBe(reais(total).paraDecimal());
    }
  });

  it("🔑 a sobra vai para as primeiras parcelas", () => {
    // R$ 100,00 em 3 é 33,34 · 33,33 · 33,33. A primeira paga o centavo a mais
    // porque é a que o cliente já vai pagar — e não a última, que ele só veria
    // meses depois.
    const parcelas = plano("100,00", 3);

    expect(parcelas.map((parcela) => parcela.valor.paraDecimal())).toEqual([
      "33.34",
      "33.33",
      "33.33",
    ]);
  });

  it("uma parcela devolve o total inteiro", () => {
    const [unica] = plano("250,00", 1);

    expect(unica?.valor.paraDecimal()).toBe("250.00");
    expect(unica?.numero).toBe(1);
    expect(unica?.de).toBe(1);
  });

  it("numera as parcelas para o carnê", () => {
    const parcelas = plano("300,00", 3);

    expect(
      parcelas.map((parcela) => `${String(parcela.numero)}/${String(parcela.de)}`),
    ).toEqual(["1/3", "2/3", "3/3"]);
  });
});

describe("vencimentos", () => {
  it("🔑 o fiado de uma parcela vence em trinta dias", () => {
    // É o "acerto no mês que vem" do bairro. Sem prazo padrão, cada operador
    // escolheria um, e a cobrança viraria adivinhação.
    const [unica] = plano("100,00", 1);

    expect(DIAS_PRIMEIRO_VENCIMENTO_PADRAO).toBe(30);
    expect(unica?.vencimento.toISOString()).toBe("2026-08-31T14:30:00.000Z");
  });

  it("as parcelas seguintes vêm de trinta em trinta", () => {
    const parcelas = plano("300,00", 3);

    expect(DIAS_ENTRE_PARCELAS_PADRAO).toBe(30);
    expect(parcelas.map((parcela) => parcela.vencimento.toISOString())).toEqual([
      "2026-08-31T14:30:00.000Z",
      "2026-09-30T14:30:00.000Z",
      "2026-10-30T14:30:00.000Z",
    ]);
  });

  it("aceita prazo e intervalo combinados na venda", () => {
    const parcelas = plano("200,00", 2, {
      diasParaPrimeiroVencimento: 15,
      diasEntreParcelas: 15,
    });

    expect(parcelas.map((parcela) => parcela.vencimento.toISOString())).toEqual([
      "2026-08-16T14:30:00.000Z",
      "2026-08-31T14:30:00.000Z",
    ]);
  });

  it("aceita vencimento no mesmo dia — é a venda que já nasce vencida a acertar", () => {
    const [unica] = plano("50,00", 1, { diasParaPrimeiroVencimento: 0 });

    expect(unica?.vencimento.toISOString()).toBe(EMISSAO.toISOString());
  });

  it("🔑 somar dias não erra no horário de verão", () => {
    // A conta é feita em UTC. Com `setDate` no fuso local, a virada do horário
    // de verão adiantaria o vencimento em um dia — e o relatório de cobrança
    // chamaria quem está em dia.
    const outubro = montarPlanoDeParcelas({
      total: reais("100,00"),
      parcelas: 1,
      emitidoEm: new Date("2026-10-10T12:00:00.000Z"),
      diasParaPrimeiroVencimento: 30,
    }).unwrap();

    expect(outubro[0]?.vencimento.toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });
});

describe("recusas", () => {
  it("zero parcelas é recusado", () => {
    const resultado = montarPlanoDeParcelas({
      total: reais("100,00"),
      parcelas: 0,
      emitidoEm: EMISSAO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("PARCELAS_INVALIDAS");
  });

  it("parcela fracionária é recusada", () => {
    const resultado = montarPlanoDeParcelas({
      total: reais("100,00"),
      parcelas: 2.5,
      emitidoEm: EMISSAO,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("🔑 acima de trinta e seis parcelas não é mais varejo de bairro", () => {
    const resultado = montarPlanoDeParcelas({
      total: reais("100,00"),
      parcelas: 37,
      emitidoEm: EMISSAO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("PARCELAS_DEMAIS");
  });

  it("valor zero ou negativo é recusado", () => {
    expect(
      montarPlanoDeParcelas({
        total: Dinheiro.zero(),
        parcelas: 1,
        emitidoEm: EMISSAO,
      }).isErr(),
    ).toBe(true);
  });

  it("prazo negativo é recusado", () => {
    const resultado = montarPlanoDeParcelas({
      total: reais("100,00"),
      parcelas: 1,
      emitidoEm: EMISSAO,
      diasParaPrimeiroVencimento: -5,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("PRAZO_INVALIDO");
  });

  it("🔑 intervalo zero entre parcelas é recusado", () => {
    // Duas parcelas vencendo no mesmo dia não é parcelamento: é uma cobrança
    // dobrada que o cliente vai contestar com razão.
    const resultado = montarPlanoDeParcelas({
      total: reais("100,00"),
      parcelas: 2,
      emitidoEm: EMISSAO,
      diasEntreParcelas: 0,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("INTERVALO_INVALIDO");
  });
});
