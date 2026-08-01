import { ClienteAgente } from "@erp/agente-contrato";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agente, definirAgenteParaTeste, esquecerAgente } from "./balcao.js";

/**
 * A descoberta do Agente Local.
 *
 * A promessa deste arquivo é uma só: **ausência de Agente não é erro.** Em
 * desenvolvimento, em tablet, ou antes de o serviço subir, a tela continua
 * vendendo contra o servidor da loja — perde contingência e impressão, não a
 * venda (princípio 1).
 */

beforeEach(() => {
  esquecerAgente();
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
  vi.restoreAllMocks();
});

describe("descoberta", () => {
  it("🔑 sem Agente respondendo, a tela recebe undefined em vez de erro", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("conexão recusada"));

    await expect(agente()).resolves.toBeUndefined();
  });

  it("com Agente no ar, devolve o cliente", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ estado: "ok" }), { status: 200 }),
    );

    await expect(agente()).resolves.toBeInstanceOf(ClienteAgente);
  });

  it("🔑 pergunta uma vez só, não a cada bipada", async () => {
    // Uma ida à rede local por item registrado seria latência somada ao caminho
    // mais quente do produto, para uma resposta que não muda no atendimento.
    const buscar = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ estado: "ok" }), { status: 200 }));

    await agente();
    await agente();
    await agente();

    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("esquecer faz a próxima chamada procurar de novo", async () => {
    const buscar = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ estado: "ok" }), { status: 200 }));

    await agente();
    esquecerAgente();
    await agente();

    expect(buscar).toHaveBeenCalledTimes(2);
  });
});

describe("substituição no teste", () => {
  it("o dublê instalado é o que a tela recebe", async () => {
    const duble = { estado: vi.fn() } as unknown as ClienteAgente;
    definirAgenteParaTeste(duble);

    await expect(agente()).resolves.toBe(duble);
  });

  it("instalar undefined simula estação sem Agente", async () => {
    definirAgenteParaTeste(undefined);

    await expect(agente()).resolves.toBeUndefined();
  });
});
