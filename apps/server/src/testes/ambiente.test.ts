import { describe, expect, it } from "vitest";

import { carregarAmbiente } from "../ambiente.js";

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
