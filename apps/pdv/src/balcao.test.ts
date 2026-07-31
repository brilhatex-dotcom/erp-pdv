import type { DadosCupom } from "@erp/printing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Balcao, balcao, imprimirCupomDaVenda } from "./balcao.js";

const CUPOM: DadosCupom = {
  loja: { nome: "MERCADINHO" },
  numero: 1,
  emitidoEm: new Date("2026-07-31T14:35:00"),
  operador: "Maria",
  itens: [],
  subtotal: "0",
  descontoTotal: "0",
  total: "990",
  pagamentos: [],
  troco: "0",
  semValorFiscal: true,
};

function instalarPonte(ponte: Partial<Balcao>): void {
  Object.defineProperty(globalThis.window, "balcao", {
    value: ponte,
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis.window, "balcao");
});

describe("Fora do Electron", () => {
  it("🔑 a tela funciona sem a ponte — a venda não depende de impressora", () => {
    // É o princípio 1. Amarrar a tela ao Electron também impediria de
    // desenvolvê-la no navegador.
    expect(balcao()).toBeUndefined();
  });

  it("🔑 sem ponte não há aviso — avisar toda venda ensina a ignorar avisos", async () => {
    expect(
      await imprimirCupomDaVenda({ cupom: CUPOM, houveDinheiro: true }),
    ).toBeUndefined();
  });
});

describe("Com a ponte", () => {
  it("imprimiu: nada a avisar", async () => {
    const imprimirCupom = vi.fn().mockResolvedValue({ tipo: "IMPRESSO" });
    instalarPonte({ imprimirCupom });

    expect(
      await imprimirCupomDaVenda({ cupom: CUPOM, houveDinheiro: false }),
    ).toBeUndefined();
    expect(imprimirCupom).toHaveBeenCalledWith({
      cupom: CUPOM,
      houveDinheiro: false,
    });
  });

  it("não imprimiu: devolve a mensagem que o operador lê", async () => {
    instalarPonte({
      imprimirCupom: vi.fn().mockResolvedValue({
        tipo: "NAO_IMPRESSO",
        mensagem: "Cupom não impresso. A venda foi registrada normalmente.",
      }),
    });

    const aviso = await imprimirCupomDaVenda({ cupom: CUPOM, houveDinheiro: true });

    expect(aviso).toContain("venda foi registrada");
  });

  it("🔑 ponte quebrada não derruba a tela — a venda já está gravada", async () => {
    instalarPonte({
      imprimirCupom: vi.fn().mockRejectedValue(new Error("IPC morreu")),
    });

    const aviso = await imprimirCupomDaVenda({ cupom: CUPOM, houveDinheiro: true });

    expect(aviso).toContain("venda foi registrada");
    // O detalhe técnico não chega ao operador.
    expect(aviso).not.toContain("IPC");
  });
});
