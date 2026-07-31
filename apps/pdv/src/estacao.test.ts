import { beforeEach, describe, expect, it } from "vitest";

import { identificadorDaEstacao } from "./estacao.js";

/**
 * A estação é o eixo de três regras de negócio: um caixa aberto por estação,
 * uma série fiscal por estação e o fechamento do dia por estação. Errar aqui não
 * dá erro na tela — dá conferência que não fecha e série fiscal duplicada.
 */

beforeEach(() => {
  globalThis.localStorage.clear();
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

  it("preserva o valor que o instalador tenha gravado", () => {
    // Quando o instalador existir, é ele quem grava — e o navegador não deve
    // sobrescrever o número que está na etiqueta do computador.
    globalThis.localStorage.setItem("erp.estacao", "caixa-02");

    expect(identificadorDaEstacao()).toBe("caixa-02");
  });
});
