import { afterEach, describe, expect, it, vi } from "vitest";

import { novoUuid } from "./uuid.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Um `crypto` de origem insegura: tem sorteio, mas não tem `randomUUID`. */
function origemInsegura(preencher: (bytes: Uint8Array) => void): void {
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => {
      preencher(bytes);
      return bytes;
    },
  });
}

describe("novoUuid", () => {
  it("🔑 gera UUID v4 válido, no formato que o servidor aceita", () => {
    for (let vez = 0; vez < 200; vez += 1) {
      expect(novoUuid()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("não repete", () => {
    const gerados = new Set(Array.from({ length: 1000 }, () => novoUuid()));

    expect(gerados.size).toBe(1000);
  });

  it("🔑 funciona onde `crypto.randomUUID` não existe — HTTP que não é localhost", () => {
    origemInsegura((bytes) => {
      bytes.fill(0xab);
    });

    expect("randomUUID" in crypto).toBe(false);
    expect(novoUuid()).toBe("abababab-abab-4bab-abab-abababababab");
  });

  it("marca versão e variante sobre qualquer sorteio", () => {
    origemInsegura((bytes) => {
      bytes.fill(0xff);
    });
    expect(novoUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");

    origemInsegura((bytes) => {
      bytes.fill(0x00);
    });
    expect(novoUuid()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
