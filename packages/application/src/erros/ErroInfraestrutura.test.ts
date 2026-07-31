import { describe, expect, it } from "vitest";

import { ErroInfraestrutura } from "./ErroInfraestrutura.js";

describe("ErroInfraestrutura", () => {
  it("usa mensagem que orienta o operador, não descrição técnica", () => {
    // O operador não pode resolver banco fora do ar; a mensagem diz o que
    // fazer, e o detalhe técnico vai para o log.
    const erro = new ErroInfraestrutura("BANCO_INDISPONIVEL");

    expect(erro.mensagem).toBe("Não foi possível concluir a operação. Tente novamente.");
    expect(erro.codigo).toBe("BANCO_INDISPONIVEL");
    expect(erro.tipo).toBe("CONFLITO");
  });

  it("aceita mensagem específica quando há orientação melhor", () => {
    const erro = new ErroInfraestrutura("DISCO_CHEIO", "Sem espaço em disco.");

    expect(erro.mensagem).toBe("Sem espaço em disco.");
  });

  it("guarda detalhes técnicos para diagnóstico remoto", () => {
    const erro = new ErroInfraestrutura("X", undefined, { tabela: "vendas" });

    expect(erro.detalhes).toEqual({ tabela: "vendas" });
  });

  it("converte exceção capturada, preservando a causa no log", () => {
    const erro = ErroInfraestrutura.de(new Error("connection refused"));

    expect(erro.codigo).toBe("FALHA_INFRAESTRUTURA");
    expect(erro.detalhes?.["causa"]).toBe("connection refused");
  });

  it("converte valor lançado que não é Error", () => {
    expect(ErroInfraestrutura.de("timeout").detalhes?.["causa"]).toBe("timeout");
  });

  it("aceita código próprio ao converter", () => {
    expect(ErroInfraestrutura.de(new Error("x"), "DEADLOCK").codigo).toBe("DEADLOCK");
  });
});
