import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { estoqueMovimentado } from "./eventos.js";

const MOVIMENTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a61").unwrap();
const PRODUTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a62").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

describe("estoqueMovimentado", () => {
  it("monta o evento com o delta, não com o saldo resultante", () => {
    // Carregar o delta é o que preserva a comutatividade: quem recebe soma,
    // não sobrescreve. Enviar o saldo faria a última mensagem vencer.
    const evento = estoqueMovimentado(MOVIMENTO, PRODUTO, "SAIDA", -3000n, "UN", AGORA);

    expect(evento.tipo).toBe("EstoqueMovimentado");
    expect(evento.delta).toBe(-3000n);
    expect(evento.tipoMovimento).toBe("SAIDA");
  });

  it("usa o movimento como agregado de origem", () => {
    const evento = estoqueMovimentado(MOVIMENTO, PRODUTO, "ENTRADA", 5000n, "UN", AGORA);

    expect(evento.agregadoId.equals(MOVIMENTO)).toBe(true);
    expect(evento.produtoId.equals(PRODUTO)).toBe(true);
  });

  it("carrega a unidade, para o destino validar antes de somar", () => {
    const evento = estoqueMovimentado(MOVIMENTO, PRODUTO, "ENTRADA", 1250n, "KG", AGORA);

    expect(evento.unidade).toBe("KG");
  });

  it("usa o instante recebido", () => {
    expect(
      estoqueMovimentado(MOVIMENTO, PRODUTO, "ENTRADA", 1n, "UN", AGORA).ocorridoEm,
    ).toBe(AGORA);
  });
});
