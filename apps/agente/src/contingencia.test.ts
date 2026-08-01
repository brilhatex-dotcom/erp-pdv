import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { montarContingencia } from "./contingencia.js";

/**
 * A montagem é o que transformou três bibliotecas testadas em comportamento.
 * O que se verifica aqui é o que nenhuma delas via sozinha: a decisão entre
 * "tente de novo" e "desista", e a promessa de que nada disto impede o caixa de
 * abrir.
 */

let pasta: string;

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "contingencia-"));
});

afterEach(() => {
  rmSync(pasta, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function resposta(corpo: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: (): Promise<unknown> => Promise.resolve(corpo),
  } as Response;
}

describe("catálogo replicado", () => {
  it("baixa e grava a réplica em disco", async () => {
    const buscar = vi.fn().mockResolvedValue(
      resposta({
        atualizadoEm: "2026-08-01T00:00:00.000Z",
        produtos: [
          {
            id: "1",
            sku: "CAFE",
            descricao: "Café",
            descricaoPdv: "CAFE",
            unidade: "UN",
            precoVenda: "1990",
            codigoBarras: "789",
            ativo: true,
          },
        ],
      }),
    );

    const contingencia = montarContingencia({ pasta, api: "http://loja", buscar });

    await expect(contingencia.atualizarCatalogo()).resolves.toBe(true);
    expect(contingencia.replica.porCodigo("789")?.descricaoPdv).toBe("CAFE");

    const emDisco = JSON.parse(readFileSync(join(pasta, "catalogo.json"), "utf8")) as {
      produtos: unknown[];
    };
    expect(emDisco.produtos).toHaveLength(1);
  });

  it("🔑 rede fora não impede o caixa de abrir", async () => {
    // Recusar-se a abrir por causa de catálogo velho deixaria a loja sem caixa
    // justamente no dia em que a rede está ruim (princípio 1).
    const buscar = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const registrar = vi.fn();

    const contingencia = montarContingencia({
      pasta,
      api: "http://loja",
      buscar,
      registrar,
    });

    await expect(contingencia.atualizarCatalogo()).resolves.toBe(false);
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("não atualizado"));
  });

  it("resposta em formato inesperado não corrompe a réplica existente", async () => {
    writeFileSync(
      join(pasta, "catalogo.json"),
      JSON.stringify({
        atualizadoEm: "2026-07-01T00:00:00.000Z",
        produtos: [
          {
            id: "1",
            sku: "ANTIGO",
            descricao: "Antigo",
            descricaoPdv: "ANTIGO",
            unidade: "UN",
            precoVenda: "100",
            codigoBarras: "111",
            ativo: true,
          },
        ],
      }),
      "utf8",
    );

    const buscar = vi.fn().mockResolvedValue(resposta({ produtos: "não é lista" }));
    const contingencia = montarContingencia({ pasta, api: "http://loja", buscar });

    await expect(contingencia.atualizarCatalogo()).resolves.toBe(false);
    expect(contingencia.replica.porCodigo("111")?.sku).toBe("ANTIGO");
  });

  it("servidor que recusa não vira réplica vazia", async () => {
    const buscar = vi.fn().mockResolvedValue(resposta({}, 401));
    const contingencia = montarContingencia({ pasta, api: "http://loja", buscar });

    await expect(contingencia.atualizarCatalogo()).resolves.toBe(false);
  });
});

describe("envio das vendas da fila", () => {
  function comFila(buscar: typeof fetch): ReturnType<typeof montarContingencia> {
    const contingencia = montarContingencia({
      pasta,
      api: "http://loja",
      buscar,
      novoId: () => "venda-1",
    });

    contingencia.fila.enfileirar({
      id: "venda-1",
      estacaoId: "estacao-1",
      operadorId: "operador-1",
      registradaEm: "2026-08-01T12:00:00.000Z",
      itens: [{ codigo: "789" }],
      pagamentos: [{ forma: "DINHEIRO", valor: "1990" }],
      total: "1990",
    });

    return contingencia;
  }

  it("venda aceita sai da fila", async () => {
    const contingencia = comFila(vi.fn().mockResolvedValue(resposta({})) as typeof fetch);

    const resumo = await contingencia.sincronizar();

    expect(resumo.enviadas).toBe(1);
    expect(contingencia.fila.quantidadePendente()).toBe(0);
  });

  it("🔑 venda que o servidor já tinha conta como aceita", async () => {
    // A resposta pode ter se perdido depois de o servidor gravar. Tratar
    // `jaExistia` como falha manteria a venda na fila para sempre.
    const contingencia = comFila(
      vi.fn().mockResolvedValue(resposta({ jaExistia: true })) as typeof fetch,
    );

    const resumo = await contingencia.sincronizar();

    expect(resumo.enviadas).toBe(1);
    expect(contingencia.fila.quantidadePendente()).toBe(0);
  });

  it("🔑 rede fora mantém a venda na fila", async () => {
    const contingencia = comFila(
      vi.fn().mockRejectedValue(new TypeError("sem rede")) as typeof fetch,
    );

    const resumo = await contingencia.sincronizar();

    expect(resumo.interrompida).toBe(true);
    expect(contingencia.fila.quantidadePendente()).toBe(1);
  });

  it("🔑 5xx espera; 4xx desiste", async () => {
    // Insistir num 400 é tentar para sempre o que nunca vai passar, e a fila
    // nunca esvazia. Desistir de um 503 perde uma venda que só precisava de
    // mais um minuto.
    const comCincoXX = comFila(
      vi.fn().mockResolvedValue(resposta({}, 503)) as typeof fetch,
    );
    expect((await comCincoXX.sincronizar()).interrompida).toBe(true);
    expect(comCincoXX.fila.quantidadePendente()).toBe(1);

    rmSync(pasta, { recursive: true, force: true });
    pasta = mkdtempSync(join(tmpdir(), "contingencia-"));

    const comQuatroXX = comFila(
      vi.fn().mockResolvedValue(resposta({}, 422)) as typeof fetch,
    );
    const resumo = await comQuatroXX.sincronizar();

    expect(resumo.recusadas).toBe(1);
    expect(comQuatroXX.fila.quantidadePendente()).toBe(0);
  });

  it("🔑 conectado também conta a fila, antes da primeira tentativa", async () => {
    // A estação abre com vendas de ontem na fila e nenhuma tentativa falhou
    // ainda. Se o estado omitisse o número aqui, o fechamento de caixa
    // acreditaria que não há nada pendente justamente quando há — e o bloqueio
    // que existe para isso passaria batido.
    const contingencia = comFila(
      vi.fn().mockRejectedValue(new TypeError("sem rede")) as typeof fetch,
    );

    expect(contingencia.estado()).toEqual({ tipo: "CONECTADO", pendentes: 1 });

    await contingencia.sincronizar();

    expect(contingencia.estado()).toEqual({ tipo: "OFFLINE", pendentes: 1 });
  });
});

describe("a montagem entrega a venda offline inteira", () => {
  it("do primeiro item ao troco, passando pela fila", async () => {
    const buscar = vi.fn().mockResolvedValue(
      resposta({
        atualizadoEm: "2026-08-01T00:00:00.000Z",
        produtos: [
          {
            id: "1",
            sku: "CAFE",
            descricao: "Café",
            descricaoPdv: "CAFE 500G",
            unidade: "UN",
            precoVenda: "1990",
            codigoBarras: "789",
            ativo: true,
          },
        ],
      }),
    );

    const contingencia = montarContingencia({
      pasta,
      api: "http://loja",
      buscar,
      novoId: () => "venda-1",
    });

    await contingencia.atualizarCatalogo();

    contingencia.iniciar("estacao-1", "operador-1");
    const item = contingencia.adicionarItem("789");

    expect(item.tipo).toBe("OK");

    const pagamento = contingencia.registrarPagamento("DINHEIRO", "2000");
    expect(pagamento.tipo).toBe("OK");

    const fechada = contingencia.finalizar();

    expect(fechada.tipo).toBe("OK");
    if (fechada.tipo !== "OK") return;
    expect(fechada.troco).toBe("10");
    expect(contingencia.fila.quantidadePendente()).toBe(1);
  });

  it("cancelar desfaz a venda em aberto", () => {
    const contingencia = montarContingencia({
      pasta,
      api: "http://loja",
      buscar: vi.fn(),
    });

    contingencia.iniciar("estacao-1", "operador-1");
    contingencia.cancelar();

    expect(contingencia.adicionarItem("789").tipo).toBe("ERRO");
    expect(contingencia.fila.quantidadePendente()).toBe(0);
  });
});

describe("relógio de sincronização", () => {
  it("🔑 fila ilegível não derruba o relógio", async () => {
    // Instalação corrompida — o caminho da fila virou pasta. Sem o `catch`, a
    // rejeição sobe para o processo principal e derruba o PDV inteiro.
    mkdirSync(join(pasta, "vendas-pendentes.jsonl"));

    const registrar = vi.fn();
    const contingencia = montarContingencia({
      pasta,
      api: "http://loja",
      buscar: vi.fn().mockResolvedValue(resposta({})),
      registrar,
    });

    const parar = contingencia.iniciarRelogio();
    await vi.waitFor(() => {
      expect(registrar).toHaveBeenCalledWith(
        expect.stringContaining("Sincronização falhou"),
      );
    });

    parar();
  });

  it("🔑 desligar de verdade para o PDV não demorar a fechar", async () => {
    vi.useFakeTimers();

    const buscar = vi.fn().mockResolvedValue(resposta({}));
    const contingencia = montarContingencia({ pasta, api: "http://loja", buscar });

    const parar = contingencia.iniciarRelogio();
    await vi.advanceTimersByTimeAsync(10);

    parar();

    const antes = buscar.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(buscar.mock.calls.length).toBe(antes);

    vi.useRealTimers();
  });
});
