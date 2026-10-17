import { useSessao } from "@erp/cliente-api";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProvedorModo, useModo } from "./modo.js";

/**
 * O modo da tela (ADR-0026): loja por padrão, treino só quando pedido, e
 * guardado na aba — nunca na estação.
 */

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mostra o modo e o cliente da sessão, para o teste ler na tela. */
function Espiao(): ReactNode {
  const { treinamento, entrarNoTreino, sairDoTreino } = useModo();
  const { restaurando } = useSessao();

  return (
    <div>
      <p>{treinamento ? "treino" : "loja"}</p>
      <p>{restaurando ? "restaurando" : "pronto"}</p>
      <button type="button" onClick={entrarNoTreino}>
        treinar
      </button>
      <button type="button" onClick={sairDoTreino}>
        sair
      </button>
    </div>
  );
}

function respostaSemSessao(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("useModo", () => {
  it("🔑 fora do provedor é a loja, e não sai dela", async () => {
    const { result } = renderHook(() => useModo());

    act(() => {
      result.current.entrarNoTreino();
      result.current.sairDoTreino();
    });

    expect(result.current.treinamento).toBe(false);
    await expect(result.current.consultarTreino()).rejects.toThrow();
  });
});

describe("ProvedorModo", () => {
  it("🔑 sem quem crie o cliente, fala com o servidor pelo fetch do navegador", async () => {
    const buscar = vi.fn(respostaSemSessao);
    vi.stubGlobal("fetch", buscar);

    render(
      <ProvedorModo>
        <Espiao />
      </ProvedorModo>,
    );
    await screen.findByText("pronto");

    act(() => {
      screen.getByRole("button", { name: "treinar" }).click();
    });

    await waitFor(() => {
      expect(buscar).toHaveBeenCalledWith("/treino/api/acesso/eu", expect.anything());
    });
    expect(buscar).toHaveBeenCalledWith("/api/acesso/eu", expect.anything());
  });

  it("armazenamento bloqueado: começa na loja, e o treino vale até o F5", async () => {
    vi.stubGlobal("fetch", vi.fn(respostaSemSessao));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    render(
      <ProvedorModo>
        <Espiao />
      </ProvedorModo>,
    );
    expect(await screen.findByText("loja")).toBeVisible();

    act(() => {
      screen.getByRole("button", { name: "treinar" }).click();
    });
    expect(await screen.findByText("treino")).toBeVisible();

    act(() => {
      screen.getByRole("button", { name: "sair" }).click();
    });
    expect(await screen.findByText("loja")).toBeVisible();
  });
});
