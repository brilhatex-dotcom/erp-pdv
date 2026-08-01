import { describe, expect, it } from "vitest";

import { avaliarAcesso, cabecalhosCors, type PoliticaAcesso } from "./seguranca.js";

/**
 * A porta de entrada do Agente.
 *
 * Um serviço HTTP na máquina do caixa é alcançável por qualquer página aberta
 * naquele navegador. Este arquivo existe para que a lista do que **não** passa
 * seja explícita, e continue explícita quando alguém mexer aqui daqui a um ano.
 */

const POLITICA: PoliticaAcesso = {
  origensPermitidas: ["http://servidor-da-loja:3000"],
  segredo: "segredo-de-teste-1234",
};

const VALIDO = {
  origem: "http://servidor-da-loja:3000",
  host: "127.0.0.1:9787",
  segredo: "segredo-de-teste-1234",
};

describe("o que passa", () => {
  it("origem da loja, host local e segredo certo", () => {
    expect(avaliarAcesso(POLITICA, VALIDO)).toEqual({ tipo: "PERMITIDO" });
  });

  it("programa local sem Origin, com o segredo", () => {
    // Não veio de página: veio de `curl`, do instalador ou de um diagnóstico.
    // O segredo decide sozinho nesse caminho.
    expect(avaliarAcesso(POLITICA, { ...VALIDO, origem: undefined })).toEqual({
      tipo: "PERMITIDO",
    });
  });

  it("localhost por nome também é a própria máquina", () => {
    expect(avaliarAcesso(POLITICA, { ...VALIDO, host: "localhost:9787" }).tipo).toBe(
      "PERMITIDO",
    );
  });
});

describe("o que não passa", () => {
  it("🔑 site hostil aberto por engano no navegador do caixa", () => {
    // É o ataque que justifica a camada: o navegador preenche `Origin` e o
    // JavaScript da página não consegue mentir sobre ele.
    const veredito = avaliarAcesso(POLITICA, {
      ...VALIDO,
      origem: "https://site-hostil.exemplo",
    });

    expect(veredito.tipo).toBe("NEGADO");
    if (veredito.tipo !== "NEGADO") return;
    expect(veredito.motivo).toContain("Origem");
  });

  it("🔑 DNS rebinding: domínio do atacante apontando para 127.0.0.1", () => {
    // O `Origin` já barraria. O `Host` fecha a mesma porta por outro caminho —
    // duas trancas diferentes, porque uma delas pode ter um furo que ninguém viu.
    const veredito = avaliarAcesso(POLITICA, {
      ...VALIDO,
      origem: undefined,
      host: "mal.exemplo:9787",
    });

    expect(veredito.tipo).toBe("NEGADO");
    if (veredito.tipo !== "NEGADO") return;
    expect(veredito.motivo).toContain("Host");
  });

  it("segredo errado não passa nem com a origem certa", () => {
    expect(avaliarAcesso(POLITICA, { ...VALIDO, segredo: "outro" }).tipo).toBe("NEGADO");
  });

  it("segredo ausente não passa", () => {
    expect(avaliarAcesso(POLITICA, { ...VALIDO, segredo: undefined }).tipo).toBe(
      "NEGADO",
    );
  });

  it("🔑 segredo com o prefixo certo e tamanho errado não passa", () => {
    // A comparação é de tamanho antes de conteúdo, e depois byte a byte: quem
    // acertou os dez primeiros caracteres não recebe resposta mais rápida.
    expect(avaliarAcesso(POLITICA, { ...VALIDO, segredo: "segredo-de" }).tipo).toBe(
      "NEGADO",
    );
  });

  it("host ausente não passa", () => {
    expect(avaliarAcesso(POLITICA, { ...VALIDO, host: undefined }).tipo).toBe("NEGADO");
  });

  it("🔑 lista de origens vazia fecha o navegador inteiro", () => {
    // É o estado de uma instalação ainda não emparelhada. Ela precisa recusar
    // toda página, e não aceitar todas.
    const semOrigens: PoliticaAcesso = { ...POLITICA, origensPermitidas: [] };

    expect(avaliarAcesso(semOrigens, VALIDO).tipo).toBe("NEGADO");
  });
});

describe("cabeçalhos de CORS", () => {
  it("🔑 devolve a origem pedida, nunca `*`", () => {
    // `*` desfaria a camada 2 com uma linha.
    const cabecalhos = cabecalhosCors("http://servidor-da-loja:3000", "x-erp-agente");

    expect(cabecalhos["access-control-allow-origin"]).toBe(
      "http://servidor-da-loja:3000",
    );
    expect(Object.values(cabecalhos)).not.toContain("*");
  });

  it("autoriza o cabeçalho do segredo, senão o navegador barra antes de sair", () => {
    const cabecalhos = cabecalhosCors("http://loja:3000", "x-erp-agente");

    expect(cabecalhos["access-control-allow-headers"]).toContain("x-erp-agente");
  });

  it("não autoriza credenciais", () => {
    const cabecalhos = cabecalhosCors("http://loja:3000", "x-erp-agente");

    expect(cabecalhos).not.toHaveProperty("access-control-allow-credentials");
  });
});
