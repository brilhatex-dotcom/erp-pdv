import type { ClienteAgente } from "@erp/agente-contrato";
import { ErroDaApi } from "@erp/cliente-api";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { ApiDoBalcao } from "./api/servidor.js";
import type { VendaNoFio } from "./api/tipos.js";
import { definirAgenteParaTeste } from "./balcao.js";
import {
  biparItem,
  type ContextoVenda,
  descartarNaFila,
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

const VENDA: VendaNoFio = {
  id: "venda-1",
  numero: 7,
  status: "ABERTA",
  estacaoId: "estacao-1",
  operadorId: "operador-1",
  abertaEm: "2026-10-17T12:00:00.000Z",
  subtotal: "0",
  descontoItens: "0",
  descontoVenda: "0",
  descontoTotal: "0",
  total: "0",
  totalPago: "0",
  faltaPagar: "0",
  troco: "0",
  itens: [],
  pagamentos: [],
};

const ITEM = {
  numero: 1,
  produtoId: "produto-1",
  descricao: "CAFE 500G",
  quantidade: { milesimos: "1000", unidade: "UN" },
  precoUnitario: "1990",
  totalBruto: "1990",
  desconto: "0",
  descontoRateado: "0",
  total: "1990",
};

function apiFalsa(metodos: Partial<Record<keyof ApiDoBalcao, unknown>>): ApiDoBalcao {
  return metodos as unknown as ApiDoBalcao;
}

function contexto(api: ApiDoBalcao): ContextoVenda {
  return { api, estacaoId: "estacao-1", operadorId: "operador-1" };
}

type PonteFalsa = Record<
  | "disponivel"
  | "iniciarVenda"
  | "adicionarItem"
  | "registrarPagamento"
  | "finalizar"
  | "cancelar",
  Mock
>;

function instalar(ponte: PonteFalsa): void {
  definirAgenteParaTeste(ponte as unknown as ClienteAgente);
}

function ponteFalsa(sobrescritas: Partial<PonteFalsa> = {}): PonteFalsa {
  return {
    disponivel: vi.fn().mockResolvedValue(true),
    iniciarVenda: vi.fn().mockResolvedValue({
      id: "local-1",
      offline: true,
      total: "0",
      faltaPagar: "0",
      itens: [],
    }),
    adicionarItem: vi.fn().mockResolvedValue({
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
    registrarPagamento: vi.fn().mockResolvedValue({ tipo: "OK", faltaPagar: "0" }),
    finalizar: vi.fn().mockResolvedValue({ tipo: "OK", troco: "10" }),
    cancelar: vi.fn().mockResolvedValue(undefined),
    ...sobrescritas,
  };
}

const QUEDA = new TypeError("Failed to fetch");

beforeEach(() => {
  definirAgenteParaTeste(undefined);
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
  vi.restoreAllMocks();
});

describe("ehQuedaDeServidor", () => {
  it("🔑 reconhece falha de transporte", () => {
    expect(ehQuedaDeServidor(QUEDA)).toBe(true);
    expect(ehQuedaDeServidor(new ErroDaApi("X", "x", 502))).toBe(true);
    expect(ehQuedaDeServidor(new ErroDaApi("X", "x", 503))).toBe(true);
    expect(ehQuedaDeServidor(new ErroDaApi("X", "x", 504))).toBe(true);
  });

  it("🔑 não confunde recusa de negócio, sessão expirada ou defeito com queda", () => {
    expect(ehQuedaDeServidor(new ErroDaApi("PRODUTO_NAO_ENCONTRADO", "x", 404))).toBe(
      false,
    );
    expect(ehQuedaDeServidor(new ErroDaApi("TOKEN_INVALIDO", "x", 401))).toBe(false);
    expect(ehQuedaDeServidor(new ErroDaApi("FALHA", "x", 500))).toBe(false);
    expect(ehQuedaDeServidor(new Error("qualquer"))).toBe(false);
  });
});

describe("bipar com o servidor no ar", () => {
  it("abre a venda, avisa antes do item e não toca na ponte", async () => {
    const ponte = ponteFalsa();
    instalar(ponte);
    const aberta = { ...VENDA };
    const api = apiFalsa({
      iniciarVenda: vi.fn().mockResolvedValue(aberta),
      adicionarItem: vi.fn().mockResolvedValue({
        item: ITEM,
        somado: false,
        venda: { ...aberta, itens: [ITEM] },
      }),
    });
    const aoAbrir = vi.fn();

    const bipado = await biparItem(
      contexto(api),
      "SERVIDOR",
      undefined,
      { codigo: "789" },
      aoAbrir,
    );

    expect(bipado).toMatchObject({ origem: "SERVIDOR", item: ITEM, somado: false });
    expect(aoAbrir).toHaveBeenCalledWith(aberta);
    expect(ponte.adicionarItem).not.toHaveBeenCalled();
  });

  it("🔑 o multiplicador vai sem unidade, e o peso vai com a dele", async () => {
    const adicionarItem = vi
      .fn()
      .mockResolvedValue({ item: ITEM, somado: true, venda: VENDA });
    const api = apiFalsa({ adicionarItem });

    await biparItem(contexto(api), "SERVIDOR", VENDA, {
      codigo: "789",
      multiplicador: "3000",
    });
    await biparItem(contexto(api), "SERVIDOR", VENDA, {
      codigo: "102",
      quantidade: { milesimos: "350000", unidade: "G" },
    });
    await biparItem(contexto(api), "SERVIDOR", VENDA, { codigo: "101" });

    expect(
      adicionarItem.mock.calls.map(
        ([, dados]) => (dados as { quantidade?: unknown }).quantidade,
      ),
    ).toEqual([{ milesimos: "3000" }, { milesimos: "350000", unidade: "G" }, undefined]);
  });

  it("🔑 propaga a recusa de negócio em vez de enfileirar", async () => {
    const ponte = ponteFalsa();
    instalar(ponte);
    const recusa = new ErroDaApi(
      "PRODUTO_NAO_ENCONTRADO",
      "Produto não encontrado.",
      404,
    );
    const api = apiFalsa({ adicionarItem: vi.fn().mockRejectedValue(recusa) });

    await expect(
      biparItem(contexto(api), "SERVIDOR", VENDA, { codigo: "999" }),
    ).rejects.toBe(recusa);
    expect(ponte.adicionarItem).not.toHaveBeenCalled();
  });
});

describe("bipar com o servidor fora", () => {
  it("🔑 cai para a fila e continua vendendo, com a venda no formato da tela", async () => {
    const ponte = ponteFalsa();
    instalar(ponte);
    const api = apiFalsa({ iniciarVenda: vi.fn().mockRejectedValue(QUEDA) });

    const bipado = await biparItem(contexto(api), "SERVIDOR", undefined, {
      codigo: "789",
    });

    expect(bipado.origem).toBe("FILA");
    expect(bipado.venda).toMatchObject({
      numero: 0,
      total: "1990",
      faltaPagar: "1990",
      totalPago: "0",
      troco: "0",
      itens: [{ descricao: "CAFE 500G", total: "1990", desconto: "0" }],
    });
    expect(ponte.iniciarVenda).toHaveBeenCalledWith({
      estacaoId: "estacao-1",
      operadorId: "operador-1",
    });
  });

  it("🔑 uma vez na fila, não volta ao servidor no mesmo atendimento", async () => {
    const ponte = ponteFalsa();
    instalar(ponte);
    const adicionarItem = vi.fn();
    const api = apiFalsa({ adicionarItem });

    const bipado = await biparItem(contexto(api), "FILA", VENDA, { codigo: "789" });

    expect(bipado.origem).toBe("FILA");
    expect(adicionarItem).not.toHaveBeenCalled();
    // A venda já existia na fila: não se abre outra.
    expect(ponte.iniciarVenda).not.toHaveBeenCalled();
  });

  it("o multiplicador inteiro vira bipadas repetidas; o resto é recusado com orientação", async () => {
    const ponte = ponteFalsa();
    instalar(ponte);
    const api = apiFalsa({});

    await biparItem(contexto(api), "FILA", VENDA, {
      codigo: "789",
      multiplicador: "3000",
    });
    expect(ponte.adicionarItem).toHaveBeenCalledTimes(3);

    await expect(
      biparItem(contexto(api), "FILA", VENDA, { codigo: "789", multiplicador: "1500" }),
    ).rejects.toThrow("a quantidade precisa ser inteira e até 99");
    await expect(
      biparItem(contexto(api), "FILA", VENDA, { codigo: "789", multiplicador: "100000" }),
    ).rejects.toThrow("a quantidade precisa ser inteira e até 99");
    await expect(
      biparItem(contexto(api), "FILA", VENDA, {
        codigo: "102",
        quantidade: { milesimos: "350", unidade: "KG" },
      }),
    ).rejects.toThrow("o peso digitado não entra. Use a etiqueta da balança");
  });

  it("a repetição para no primeiro erro da fila", async () => {
    const adicionarItem = vi
      .fn()
      .mockResolvedValueOnce({
        tipo: "OK",
        venda: { id: "l", offline: true, total: "0", faltaPagar: "0", itens: [] },
      })
      .mockResolvedValueOnce({ tipo: "ERRO", mensagem: "Estoque local esgotado." });
    instalar(ponteFalsa({ adicionarItem }));

    await expect(
      biparItem(contexto(apiFalsa({})), "FILA", VENDA, {
        codigo: "789",
        multiplicador: "5000",
      }),
    ).rejects.toThrow("Estoque local esgotado.");
    expect(adicionarItem).toHaveBeenCalledTimes(2);
  });

  it("no navegador, sem ponte, a venda para com mensagem clara", async () => {
    const api = apiFalsa({ iniciarVenda: vi.fn().mockRejectedValue(QUEDA) });

    const falha = biparItem(contexto(api), "SERVIDOR", undefined, { codigo: "789" });

    await expect(falha).rejects.toBeInstanceOf(VendaIndisponivel);
    await expect(falha).rejects.toThrow("Sem conexão com o servidor da loja.");
  });
});

describe("pagamento e fechamento seguem a origem da venda", () => {
  it("venda do servidor paga no servidor, com a chave e a confirmação", async () => {
    const registrarPagamento = vi
      .fn()
      .mockResolvedValue({ venda: { ...VENDA, totalPago: "1000" } });
    const api = apiFalsa({ registrarPagamento });

    const paga = await pagar(contexto(api), "SERVIDOR", VENDA, {
      forma: "PIX",
      descricao: "Pix",
      valor: "1000",
      chave: "chave-1",
      confirmacao: "MANUAL",
    });

    expect(paga.totalPago).toBe("1000");
    expect(registrarPagamento).toHaveBeenCalledWith(
      "venda-1",
      expect.objectContaining({ chave: "chave-1", confirmacao: "MANUAL" }),
    );
  });

  it("🔑 venda da fila paga na fila, e a tela mostra o troco do que passou", async () => {
    const ponte = ponteFalsa({
      registrarPagamento: vi.fn().mockResolvedValue({ tipo: "OK", faltaPagar: "0" }),
    });
    instalar(ponte);
    const naFila = { ...VENDA, total: "1990", faltaPagar: "1990" };

    const paga = await pagar(contexto(apiFalsa({})), "FILA", naFila, {
      forma: "DINHEIRO",
      descricao: "Dinheiro",
      valor: "2000",
      chave: "chave-1",
    });

    expect(paga).toMatchObject({ faltaPagar: "0", totalPago: "2000", troco: "10" });
    expect(paga.pagamentos).toEqual([
      expect.objectContaining({
        forma: "DINHEIRO",
        valor: "2000",
        parcelas: 1,
        confirmacao: "MANUAL",
      }),
    ]);
  });

  it("pagamento na fila sem ponte, ou recusado por ela, vira mensagem", async () => {
    await expect(
      pagar(contexto(apiFalsa({})), "FILA", VENDA, {
        forma: "DINHEIRO",
        descricao: "Dinheiro",
        valor: "100",
        chave: "c",
      }),
    ).rejects.toThrow("Sem conexão com o servidor da loja.");

    instalar(
      ponteFalsa({
        registrarPagamento: vi
          .fn()
          .mockResolvedValue({ tipo: "ERRO", mensagem: "Valor inválido." }),
      }),
    );
    await expect(
      pagar(contexto(apiFalsa({})), "FILA", VENDA, {
        forma: "DINHEIRO",
        descricao: "Dinheiro",
        valor: "100",
        chave: "c",
      }),
    ).rejects.toThrow("Valor inválido.");
  });

  it("fechar no servidor devolve a venda do servidor", async () => {
    const finalizada = { ...VENDA, status: "FINALIZADA" as const };
    const api = apiFalsa({ finalizar: vi.fn().mockResolvedValue(finalizada) });

    expect(await finalizar(contexto(api), "SERVIDOR", VENDA)).toBe(finalizada);
  });

  it("🔑 fechar na fila devolve o troco calculado localmente", async () => {
    instalar(ponteFalsa());

    const finalizada = await finalizar(contexto(apiFalsa({})), "FILA", VENDA);

    expect(finalizada).toMatchObject({
      status: "FINALIZADA",
      faltaPagar: "0",
      troco: "10",
    });
  });

  it("falha ao fechar na fila vira mensagem, e sem ponte também", async () => {
    await expect(finalizar(contexto(apiFalsa({})), "FILA", VENDA)).rejects.toThrow(
      "Sem conexão com o servidor da loja.",
    );

    instalar(
      ponteFalsa({
        finalizar: vi.fn().mockResolvedValue({ tipo: "ERRO", mensagem: "Disco cheio." }),
      }),
    );
    await expect(finalizar(contexto(apiFalsa({})), "FILA", VENDA)).rejects.toThrow(
      "Disco cheio.",
    );
  });

  it("desistir na fila descarta; sem ponte, não há o que descartar", async () => {
    await expect(descartarNaFila()).resolves.toBeUndefined();

    const ponte = ponteFalsa();
    instalar(ponte);
    await descartarNaFila();

    expect(ponte.cancelar).toHaveBeenCalledTimes(1);
  });
});
