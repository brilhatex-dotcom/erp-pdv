import { describe, expect, it } from "vitest";

import { interpretarConfiguracao } from "./configuracao.js";

describe("Configuração ausente", () => {
  it("🔑 estação nova abre sem configuração, e sem impressora", () => {
    // Exigir impressora para abrir o PDV inverteria a prioridade: o cupom serve
    // à venda, não o contrário.
    const { configuracao, aviso } = interpretarConfiguracao(undefined);

    expect(configuracao.impressora.tipo).toBe("NENHUMA");
    expect(configuracao.quiosque).toBe(true);
    expect(configuracao.colunas).toBe(48);
    expect(aviso).toBeUndefined();
  });

  it("texto vazio é o mesmo que ausente", () => {
    expect(interpretarConfiguracao("   ").configuracao.impressora.tipo).toBe("NENHUMA");
  });
});

describe("Configuração válida", () => {
  it("lê a impressora de rede", () => {
    const { configuracao } = interpretarConfiguracao(
      JSON.stringify({
        api: "http://192.168.0.10:3000",
        impressora: { tipo: "REDE", host: "192.168.0.50", porta: 9100 },
        colunas: 32,
        quiosque: false,
      }),
    );

    expect(configuracao.api).toBe("http://192.168.0.10:3000");
    expect(configuracao.impressora).toEqual({
      tipo: "REDE",
      host: "192.168.0.50",
      porta: 9100,
    });
    expect(configuracao.colunas).toBe(32);
    expect(configuracao.quiosque).toBe(false);
  });

  it("lê a impressora como arquivo — o caminho da USB", () => {
    const { configuracao } = interpretarConfiguracao(
      JSON.stringify({ impressora: { tipo: "ARQUIVO", caminho: "/dev/usb/lp0" } }),
    );

    expect(configuracao.impressora).toEqual({
      tipo: "ARQUIVO",
      caminho: "/dev/usb/lp0",
    });
  });

  it("campos ausentes caem no padrão", () => {
    const { configuracao } = interpretarConfiguracao(JSON.stringify({ colunas: 32 }));

    expect(configuracao.colunas).toBe(32);
    expect(configuracao.api).toBe("http://localhost:3000");
  });
});

describe("Configuração quebrada", () => {
  it("🔑 JSON malformado não impede o caixa de abrir", () => {
    // Recusar-se a abrir deixaria a loja sem caixa por causa de uma vírgula a
    // mais num arquivo que ninguém sabe editar.
    const { configuracao, aviso } = interpretarConfiguracao("{ isso não é json");

    expect(configuracao.impressora.tipo).toBe("NENHUMA");
    expect(aviso).toContain("JSON malformado");
  });

  it("🔑 campo inválido também degrada, apontando qual foi", () => {
    const { configuracao, aviso } = interpretarConfiguracao(
      JSON.stringify({ impressora: { tipo: "REDE" } }),
    );

    expect(configuracao.impressora.tipo).toBe("NENHUMA");
    expect(aviso).toContain("impressora");
  });

  it("tipo de impressora desconhecido cai no padrão", () => {
    const { aviso } = interpretarConfiguracao(
      JSON.stringify({ impressora: { tipo: "SERIAL", porta: "COM1" } }),
    );

    expect(aviso).toBeDefined();
  });

  it("largura absurda é recusada", () => {
    expect(interpretarConfiguracao(JSON.stringify({ colunas: 500 })).aviso).toContain(
      "colunas",
    );
  });
});
