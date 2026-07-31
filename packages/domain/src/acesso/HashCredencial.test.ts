import { describe, expect, it } from "vitest";

import { HashCredencial } from "./HashCredencial.js";

const HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2Fs$aGFzaA";

describe("HashCredencial.criar", () => {
  it("aceita o hash como veio do algoritmo", () => {
    expect(HashCredencial.criar(HASH).unwrap().revelar()).toBe(HASH);
  });

  it("recusa vazio", () => {
    for (const invalido of ["", "   "]) {
      const resultado = HashCredencial.criar(invalido);

      expect(resultado.isErr()).toBe(true);
      expect(resultado.isErr() && resultado.error.codigo).toBe("HASH_VAZIO");
    }
  });

  it("não revela o hash em texto nem em JSON", () => {
    // Hash não é reversível, mas é material para dicionário offline — e o log vai
    // para o pacote de diagnóstico que o cliente manda ao suporte.
    const credencial = HashCredencial.criar(HASH).unwrap();

    expect(String(credencial)).toBe("[hash oculto]");
    expect(JSON.stringify({ credencial })).not.toContain("argon2id");
  });
});
