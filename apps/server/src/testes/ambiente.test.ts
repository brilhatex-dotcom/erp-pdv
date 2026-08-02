import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { carregarAmbiente, carregarArquivoDeAmbiente } from "../ambiente.js";

const MINIMO = {
  DATABASE_URL: "postgresql://erp@localhost:5432/erp",
  SEGREDO_TOKEN: "a".repeat(32),
};

describe("Configuração do servidor", () => {
  it("aceita o mínimo e aplica os padrões", () => {
    const ambiente = carregarAmbiente(MINIMO);

    expect(ambiente.PORTA).toBe(3000);
    // Só localhost por padrão: expor a API na rede exige decisão explícita.
    expect(ambiente.ENDERECO).toBe("127.0.0.1");
    expect(ambiente.MINUTOS_TOKEN_ACESSO).toBe(15);
    expect(ambiente.ehProducao).toBe(false);
    expect(ambiente.origens).toEqual([]);
  });

  it("🔑 recusa segredo curto — chave fraca vale por todas as sessões da loja", () => {
    expect(() => carregarAmbiente({ ...MINIMO, SEGREDO_TOKEN: "curto" })).toThrow(
      /pelo menos 32/,
    );
  });

  it("🔑 recusa subir sem banco configurado", () => {
    expect(() => carregarAmbiente({ SEGREDO_TOKEN: "a".repeat(32) })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("falha na partida, não no primeiro login", () => {
    // Um servidor que sobe quebrado descobre o problema na loja, com o caixa
    // aberto. Falhar aqui faz o problema aparecer na instalação.
    expect(() => carregarAmbiente({})).toThrow(/Configuração inválida/);
  });

  it("lista as origens permitidas, ignorando espaços e vazios", () => {
    const ambiente = carregarAmbiente({
      ...MINIMO,
      ORIGENS_PERMITIDAS: " http://a.local , ,http://b.local ",
    });

    expect(ambiente.origens).toEqual(["http://a.local", "http://b.local"]);
  });

  it("marca produção quando NODE_ENV pede", () => {
    expect(carregarAmbiente({ ...MINIMO, NODE_ENV: "production" }).ehProducao).toBe(true);
  });

  it.each([["0"], ["70000"], ["abc"]])("recusa porta inválida %p", (PORTA) => {
    expect(() => carregarAmbiente({ ...MINIMO, PORTA })).toThrow(/Configuração inválida/);
  });
});

describe("carregamento do arquivo de configuração", () => {
  const pastas: string[] = [];

  afterAll(() => {
    for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true });
  });

  it("🔑 carrega o `.env` que o instalador gravou", () => {
    // O Node não lê `.env` sozinho, e o serviço do Windows sobe com
    // `node index.js` e mais nada. Sem esta chamada a instalação inteira sobe
    // sem configuração, e o sintoma é "o sistema não respondeu".
    const carregados: string[] = [];

    const achou = carregarArquivoDeAmbiente(
      "/instalacao/servidor/.env",
      () => true,
      (caminho) => carregados.push(caminho),
    );

    expect(achou).toBe(true);
    expect(carregados).toEqual(["/instalacao/servidor/.env"]);
  });

  it("🔑 lê um arquivo de verdade, com o `process.loadEnvFile` de verdade", () => {
    // Sem exercitar os padrões, o teste provaria só que a função chama os
    // dublês que ele mesmo passou — e foi exatamente a ligação real com o
    // Node que faltava e derrubaria toda instalação.
    const pasta = mkdtempSync(join(tmpdir(), "erp-ambiente-"));
    pastas.push(pasta);

    const arquivo = join(pasta, ".env");
    writeFileSync(arquivo, "VARIAVEL_SO_DESTE_TESTE=veio-do-arquivo\n");

    expect(carregarArquivoDeAmbiente(arquivo)).toBe(true);
    expect(process.env["VARIAVEL_SO_DESTE_TESTE"]).toBe("veio-do-arquivo");

    delete process.env["VARIAVEL_SO_DESTE_TESTE"];
  });

  it("não encontra o que não existe, usando o `existsSync` de verdade", () => {
    const pasta = mkdtempSync(join(tmpdir(), "erp-ambiente-"));
    pastas.push(pasta);

    expect(carregarArquivoDeAmbiente(join(pasta, ".env"))).toBe(false);
  });

  it("segue em frente quando não há arquivo", () => {
    // Em desenvolvimento e no CI a configuração vem do ambiente; exigir o
    // arquivo faria a suíte depender de um arquivo que ninguém versiona.
    const carregados: string[] = [];

    const achou = carregarArquivoDeAmbiente(
      "/sem/env",
      () => false,
      (caminho) => carregados.push(caminho),
    );

    expect(achou).toBe(false);
    expect(carregados).toEqual([]);
  });
});
