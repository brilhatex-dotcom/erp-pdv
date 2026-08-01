import { type ClienteApi, ErroDaApi } from "@erp/cliente-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Balcao } from "./balcao.js";
import {
  biparItem,
  ehQuedaDeServidor,
  finalizar,
  pagar,
  VendaIndisponivel,
} from "./vendaComQueda.js";

/**
 * A decisão deste módulo é uma só: **isto é queda ou é recusa?**
 *
 * Errar para o lado permissivo enche a fila de vendas que o servidor vai
 * rejeitar na importação — e o operador descobre no dia seguinte, com o cliente
 * longe. Errar para o lado restritivo para a venda quando ela poderia
 * continuar, que é o princípio 1 sendo violado.
 */

const CONTEXTO_BASE = { estacaoId: "estacao-1", operadorId: "operador-1" };

function clienteFalso(requisitar: unknown): ClienteApi {
  return { requisitar } as unknown as ClienteApi;
}

function ponteFalsa(sobrescritas: Partial<Balcao> = {}): Balcao {
  const base = {
    imprimirCupom: vi.fn(),
    abrirGaveta: vi.fn(),
    configuracao: vi.fn(),
    estadoConexao: vi.fn(),
    iniciarVendaLocal: vi.fn().mockResolvedValue({
      id: "local-1",
      offline: true,
      total: "0",
      faltaPagar: "0",
      itens: [],
    }),
    itemLocal: vi.fn().mockResolvedValue({
      tipo: "OK",
      venda: {
        id: "local-1",
        offline: true,
        total: "1990",
        faltaPagar: "1990",
        itens: [
          {
            numero: 1,
            codigo: "789",
            descricao: "CAFE 500G",
            quantidade: { milesimos: "1000", unidade: "UN" },
            precoUnitario: "1990",
            total: "1990",
          },
        ],
      },
    }),
    pagamentoLocal: vi.fn().mockResolvedValue({ tipo: "OK", faltaPagar: "0" }),
    finalizarVendaLocal: vi.fn().mockResolvedValue({ tipo: "OK", troco: "10" }),
    cancelarVendaLocal: vi.fn().mockResolvedValue(null),
    sincronizarAgora: vi.fn(),
    ...sobrescritas,
  };

  return base;
}

function instalarPonte(ponte: Balcao | undefined): void {
  Object.defineProperty(globalThis.window, "balcao", {
    value: ponte,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  instalarPonte(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ehQuedaDeServidor", () => {
  it("🔑 reconhece falha de transporte", () => {
    // `TypeError` é o que `fetch` lança quando não falou com ninguém: cabo
    // solto, servidor desligado, DNS.
    expect(ehQuedaDeServidor(new TypeError("Failed to fetch"))).toBe(true);
  });

  it.each([502, 503, 504])("reconhece %i como servidor indisponível", (status) => {
    expect(ehQuedaDeServidor(new ErroDaApi("X", "y", status))).toBe(true);
  });

  it("🔑 não confunde recusa de negócio com queda", () => {
    // Cair para a fila num 400 gravaria localmente uma venda que o servidor vai
    // rejeitar na importação. O operador só descobriria no dia seguinte.
    expect(ehQuedaDeServidor(new ErroDaApi("X", "y", 400))).toBe(false);
    expect(ehQuedaDeServidor(new ErroDaApi("X", "y", 404))).toBe(false);
    expect(ehQuedaDeServidor(new ErroDaApi("X", "y", 409))).toBe(false);
  });

  it("🔑 não trata sessão expirada como queda", () => {
    // 401 é o cliente precisando renovar o token, não o servidor sumindo.
    expect(ehQuedaDeServidor(new ErroDaApi("X", "y", 401))).toBe(false);
  });

  it("não trata erro interno do servidor como retentável", () => {
    // 500 é defeito de programação no servidor: reenviar colhe o mesmo erro.
    expect(ehQuedaDeServidor(new ErroDaApi("X", "y", 500))).toBe(false);
  });
});

describe("bipar com o servidor no ar", () => {
  it("usa o servidor e não toca na ponte", async () => {
    const iniciarVendaLocal = vi.fn();
    instalarPonte(ponteFalsa({ iniciarVendaLocal }));

    const requisitar = vi
      .fn()
      .mockResolvedValueOnce({ id: "v1", numero: 42 })
      .mockResolvedValueOnce({
        venda: { id: "v1", numero: 42, total: "1990", faltaPagar: "1990", itens: [] },
      });

    const resultado = await biparItem(
      { ...CONTEXTO_BASE, cliente: clienteFalso(requisitar) },
      "SERVIDOR",
      undefined,
      "789",
    );

    expect(resultado.origem).toBe("SERVIDOR");
    expect(resultado.venda.numero).toBe(42);
    expect(iniciarVendaLocal).not.toHaveBeenCalled();
  });

  it("🔑 propaga recusa de negócio em vez de enfileirar", async () => {
    const itemLocal = vi.fn();
    instalarPonte(ponteFalsa({ itemLocal }));

    const requisitar = vi
      .fn()
      .mockRejectedValue(new ErroDaApi("PRODUTO_NAO_ENCONTRADO", "Não achei", 404));

    await expect(
      biparItem(
        { ...CONTEXTO_BASE, cliente: clienteFalso(requisitar) },
        "SERVIDOR",
        undefined,
        "789",
      ),
    ).rejects.toThrow("Não achei");

    expect(itemLocal).not.toHaveBeenCalled();
  });
});

describe("bipar com o servidor fora", () => {
  it("🔑 cai para a fila e continua vendendo", async () => {
    const ponte = ponteFalsa();
    instalarPonte(ponte);

    const requisitar = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const resultado = await biparItem(
      { ...CONTEXTO_BASE, cliente: clienteFalso(requisitar) },
      "SERVIDOR",
      undefined,
      "789",
    );

    expect(resultado.origem).toBe("FILA");
    expect(resultado.venda.total).toBe("1990");
    // Sem número: quem numera é o servidor, e ele não respondeu.
    expect(resultado.venda.numero).toBeUndefined();
  });

  it("🔑 uma vez na fila, não volta ao servidor no mesmo atendimento", async () => {
    // Metade dos itens no servidor e metade aqui produziria duas vendas
    // parciais, nenhuma das duas cobrável.
    const ponte = ponteFalsa();
    instalarPonte(ponte);

    const requisitar = vi.fn();

    await biparItem(
      { ...CONTEXTO_BASE, cliente: clienteFalso(requisitar) },
      "FILA",
      { id: "local-1", total: "0", faltaPagar: "0", itens: [] },
      "789",
    );

    expect(requisitar).not.toHaveBeenCalled();
  });

  it("no navegador, sem ponte, a venda para com mensagem clara", async () => {
    instalarPonte(undefined);

    const requisitar = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      biparItem(
        { ...CONTEXTO_BASE, cliente: clienteFalso(requisitar) },
        "SERVIDOR",
        undefined,
        "789",
      ),
    ).rejects.toBeInstanceOf(VendaIndisponivel);
  });

  it("erro do catálogo local chega ao operador", async () => {
    const ponte = ponteFalsa({
      itemLocal: vi.fn().mockResolvedValue({
        tipo: "ERRO",
        mensagem: "Produto não encontrado no catálogo local.",
      }),
    });
    instalarPonte(ponte);

    await expect(
      biparItem(
        { ...CONTEXTO_BASE, cliente: clienteFalso(vi.fn()) },
        "FILA",
        undefined,
        "789",
      ),
    ).rejects.toThrow("catálogo local");
  });
});

describe("pagamento e fechamento seguem a origem da venda", () => {
  it("venda do servidor paga no servidor", async () => {
    const pagamentoLocal = vi.fn();
    instalarPonte(ponteFalsa({ pagamentoLocal }));

    const requisitar = vi.fn().mockResolvedValue({ faltaPagar: "0" });

    await pagar(
      { ...CONTEXTO_BASE, cliente: clienteFalso(requisitar) },
      "SERVIDOR",
      "v1",
      "DINHEIRO",
      "2000",
    );

    expect(requisitar).toHaveBeenCalledOnce();
    expect(pagamentoLocal).not.toHaveBeenCalled();
  });

  it("🔑 venda da fila paga na fila, mesmo se o servidor voltar", async () => {
    // O servidor voltar no meio do atendimento não muda onde os itens estão.
    const ponte = ponteFalsa();
    instalarPonte(ponte);

    const requisitar = vi.fn();

    const resposta = await pagar(
      { ...CONTEXTO_BASE, cliente: clienteFalso(requisitar) },
      "FILA",
      "local-1",
      "DINHEIRO",
      "2000",
    );

    expect(resposta.faltaPagar).toBe("0");
    expect(requisitar).not.toHaveBeenCalled();
  });

  it("fechamento na fila devolve o troco calculado localmente", async () => {
    const finalizarVendaLocal = vi.fn().mockResolvedValue({ tipo: "OK", troco: "10" });
    instalarPonte(ponteFalsa({ finalizarVendaLocal }));

    const resultado = await finalizar(
      { ...CONTEXTO_BASE, cliente: clienteFalso(vi.fn()) },
      "FILA",
      "local-1",
    );

    expect(resultado.troco).toBe("10");
    expect(finalizarVendaLocal).toHaveBeenCalledOnce();
  });

  it("falha ao fechar na fila vira mensagem, não exceção técnica", async () => {
    const ponte = ponteFalsa({
      finalizarVendaLocal: vi
        .fn()
        .mockResolvedValue({ tipo: "ERRO", mensagem: "Ainda falta receber." }),
    });
    instalarPonte(ponte);

    await expect(
      finalizar({ ...CONTEXTO_BASE, cliente: clienteFalso(vi.fn()) }, "FILA", "local-1"),
    ).rejects.toThrow("Ainda falta receber.");
  });
});
