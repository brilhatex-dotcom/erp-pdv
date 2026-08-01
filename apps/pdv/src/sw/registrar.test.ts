import { describe, expect, it, vi } from "vitest";

import { registrarServiceWorker } from "./registrar.js";

/**
 * Registro do service worker.
 *
 * A única coisa que ele não pode fazer é derrubar a tela. Cache é melhoria; sem
 * ele o PDV vende igual. Trocar "sem cache" por "sem caixa" é o oposto do
 * princípio 1.
 */

function navegadorCom(register: () => Promise<unknown>) {
  return { serviceWorker: { register } } as unknown as Navigator;
}

describe("registro", () => {
  it("registra na raiz, como módulo", async () => {
    const register = vi.fn(async () => Promise.resolve({}));

    await expect(registrarServiceWorker(navegadorCom(register))).resolves.toBe(true);

    expect(register).toHaveBeenCalledWith("/sw.js", { type: "module", scope: "/" });
  });

  it("🔑 navegador sem suporte não quebra a tela", async () => {
    // Acontece de verdade: política de empresa desligando service worker, ou
    // origem servida sem HTTPS. Nenhum dos dois é defeito do produto.
    await expect(registrarServiceWorker({})).resolves.toBe(false);
    await expect(registrarServiceWorker({ serviceWorker: undefined })).resolves.toBe(
      false,
    );
  });

  it("🔑 falha no registro é engolida, não propagada", async () => {
    // Um `throw` aqui subiria até o `main.tsx` e deixaria o caixa sem tela por
    // causa de um recurso que ele nem precisa para vender.
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const register = vi.fn(async () => Promise.reject(new Error("bloqueado")));

    await expect(registrarServiceWorker(navegadorCom(register))).resolves.toBe(false);
    expect(info).toHaveBeenCalled();

    info.mockRestore();
  });
});
