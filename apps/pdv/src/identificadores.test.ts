import { Identificador } from "@erp/domain";
import { describe, expect, it } from "vitest";

import { novoIdentificador } from "./identificadores.js";

describe("novoIdentificador", () => {
  it("🔑 é UUIDv7 — o mesmo formato de todo identificador do sistema", () => {
    const gerado = Identificador.criar(novoIdentificador()).unwrap();

    expect(gerado.versao).toBe(7);
    expect(Math.abs((gerado.criadoEmMilissegundos ?? 0) - Date.now())).toBeLessThan(5000);
  });

  it("não se repete", () => {
    const gerados = new Set(Array.from({ length: 200 }, () => novoIdentificador()));

    expect(gerados.size).toBe(200);
  });
});
