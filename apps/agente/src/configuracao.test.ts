import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { carregarConfiguracao, interpretarConfiguracao } from "./configuracao.js";

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

describe("carregarConfiguracao", () => {
  /** Grava uma configuração temporária e devolve o caminho. */
  function comArquivo(conteudo: string): string {
    const pasta = mkdtempSync(join(tmpdir(), "agente-config-"));
    const arquivo = join(pasta, "estacao.json");

    writeFileSync(arquivo, conteudo, "utf8");

    return arquivo;
  }

  it("🔑 recusa subir sem segredo", () => {
    // Agente com segredo vazio é Agente sem a terceira camada de defesa. Melhor
    // não abrir e deixar o rastro no log do serviço do que abrir destrancado.
    const arquivo = comArquivo(JSON.stringify({ api: "http://loja:3000" }));

    expect(() => carregarConfiguracao(arquivo)).toThrow(/segredo/i);
  });

  it("recusa segredo curto demais para valer alguma coisa", () => {
    const arquivo = comArquivo(JSON.stringify({ segredo: "curto" }));

    expect(() => carregarConfiguracao(arquivo)).toThrow(/segredo/i);
  });

  it("sem caminho informado, diz qual variável falta", () => {
    expect(() => carregarConfiguracao(undefined)).toThrow(/ERP_AGENTE_CONFIG/);
  });

  it("configuração completa sobe com os padrões preenchidos", () => {
    const arquivo = comArquivo(
      JSON.stringify({
        segredo: "segredo-de-instalacao-1234",
        origensPermitidas: ["http://loja:3000"],
      }),
    );

    const configuracao = carregarConfiguracao(arquivo);

    expect(configuracao.segredo).toBe("segredo-de-instalacao-1234");
    expect(configuracao.origensPermitidas).toEqual(["http://loja:3000"]);
    expect(configuracao.colunas).toBe(48);
    expect(configuracao.pastaDados).toBe("./dados");
  });

  it("🔑 arquivo malformado não sobe com padrões silenciosos", () => {
    // Interpretar é tolerante para não derrubar a estação por uma vírgula; mas
    // carregar é estrito, porque um padrão silencioso aqui significa Agente sem
    // segredo e sem lista de origens.
    const arquivo = comArquivo("{ isto não é json");

    expect(() => carregarConfiguracao(arquivo)).toThrow(/malformado/i);
  });
});
