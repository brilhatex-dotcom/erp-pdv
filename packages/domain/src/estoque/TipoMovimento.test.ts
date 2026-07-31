import { describe, expect, it } from "vitest";

import {
  afetaCustoMedio,
  efeitoDoTipo,
  ehEntrada,
  ehSaida,
  type TipoMovimento,
} from "./TipoMovimento.js";

const ENTRADAS: readonly TipoMovimento[] = [
  "ENTRADA",
  "DEVOLUCAO_CLIENTE",
  "AJUSTE_POSITIVO",
  "TRANSFERENCIA_ENTRADA",
];

const SAIDAS: readonly TipoMovimento[] = [
  "SAIDA",
  "PERDA",
  "DEVOLUCAO_FORNECEDOR",
  "AJUSTE_NEGATIVO",
  "TRANSFERENCIA_SAIDA",
];

describe("TipoMovimento", () => {
  it.each(ENTRADAS)("%s soma ao saldo", (tipo) => {
    expect(efeitoDoTipo(tipo)).toBe(1n);
    expect(ehEntrada(tipo)).toBe(true);
    expect(ehSaida(tipo)).toBe(false);
  });

  it.each(SAIDAS)("%s subtrai do saldo", (tipo) => {
    expect(efeitoDoTipo(tipo)).toBe(-1n);
    expect(ehSaida(tipo)).toBe(true);
    expect(ehEntrada(tipo)).toBe(false);
  });

  it("cobre todos os tipos declarados", () => {
    // Se um tipo novo for adicionado sem direção, este teste falha.
    expect(ENTRADAS.length + SAIDAS.length).toBe(9);
  });

  it("apenas ENTRADA afeta o custo médio", () => {
    expect(afetaCustoMedio("ENTRADA")).toBe(true);

    for (const tipo of [...ENTRADAS, ...SAIDAS].filter((t) => t !== "ENTRADA")) {
      expect(afetaCustoMedio(tipo)).toBe(false);
    }
  });
});
