import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { identificadorDaEstacao } from "./estacao.js";

/**
 * A estação é o eixo de três regras de negócio: um caixa aberto por estação,
 * uma série fiscal por estação e o fechamento do dia por estação. Errar aqui não
 * dá erro na tela — dá conferência que não fecha e série fiscal duplicada.
 */

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identificadorDaEstacao", () => {
  it("gera e guarda na primeira abertura", () => {
    const primeiro = identificadorDaEstacao();

    expect(primeiro).toMatch(/^[0-9a-f-]{36}$/);
    expect(globalThis.localStorage.getItem("erp.estacao")).toBe(primeiro);
  });

  it("🔑 repete o mesmo valor nas próximas", () => {
    // Identificador novo a cada carregamento faria o servidor ver uma estação
    // nova por venda: nenhum caixa aberto encontrado, e conferência do dia
    // espalhada por dezenas de estações fantasmas.
    const primeiro = identificadorDaEstacao();

    expect(identificadorDaEstacao()).toBe(primeiro);
    expect(identificadorDaEstacao()).toBe(primeiro);
  });

  it("substitui valor vazio guardado por engano", () => {
    globalThis.localStorage.setItem("erp.estacao", "");

    const gerado = identificadorDaEstacao();

    expect(gerado).not.toBe("");
    expect(globalThis.localStorage.getItem("erp.estacao")).toBe(gerado);
  });

  it("🔑 funciona sem `crypto.randomUUID` — o segundo computador abre o sistema por HTTP", () => {
    // `crypto.randomUUID` só existe em HTTPS ou localhost. Sem esta estação, o
    // caixa nem monta: a tela quebrava logo depois do login.
    const verdadeiro = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => verdadeiro.getRandomValues(bytes),
    });

    const gerada = identificadorDaEstacao();

    expect(gerada).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(globalThis.localStorage.getItem("erp.estacao")).toBe(gerada);
  });

  it("preserva o valor que o instalador tenha gravado", () => {
    // Quando o instalador existir, é ele quem grava — e o navegador não deve
    // sobrescrever o número que está na etiqueta do computador.
    globalThis.localStorage.setItem("erp.estacao", "caixa-02");

    expect(identificadorDaEstacao()).toBe("caixa-02");
  });
});
