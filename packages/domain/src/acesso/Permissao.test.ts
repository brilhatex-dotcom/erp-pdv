import { describe, expect, it } from "vitest";

import { ehPermissao, PERMISSOES } from "./Permissao.js";

describe("PERMISSOES", () => {
  it("não tem repetição", () => {
    expect(new Set(PERMISSOES).size).toBe(PERMISSOES.length);
  });

  it("segue o formato recurso:acao", () => {
    for (const permissao of PERMISSOES) {
      expect(permissao).toMatch(/^[a-z]+:[a-z_]+$/);
    }
  });

  it("separa ver custo de editar produto", () => {
    // Juntar as duas transformaria "pode corrigir a descrição" em "conhece a
    // margem de tudo" (ARQUITETURA.md §9.3).
    expect(PERMISSOES).toContain("produto:editar");
    expect(PERMISSOES).toContain("produto:ver_custo");
  });

  it("separa desconto de desconto acima do limite", () => {
    expect(PERMISSOES).toContain("venda:desconto");
    expect(PERMISSOES).toContain("venda:desconto_acima_limite");
  });
});

describe("ehPermissao", () => {
  it("reconhece as permissões do catálogo", () => {
    for (const permissao of PERMISSOES) {
      expect(ehPermissao(permissao)).toBe(true);
    }
  });

  it("recusa texto desconhecido", () => {
    // Permissão vinda do banco numa versão à frente do código precisa ser
    // ignorada, não confiada (§9.5, negar por padrão).
    for (const invalida of [
      "",
      "venda",
      "venda:",
      "venda:tudo",
      "VENDA:CRIAR",
      "admin",
    ]) {
      expect(ehPermissao(invalida)).toBe(false);
    }
  });
});
