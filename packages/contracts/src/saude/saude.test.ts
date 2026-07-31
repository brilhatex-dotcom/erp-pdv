import { describe, expect, it } from "vitest";

import { zRespostaProntidao, zRespostaSaude, zVerificacao } from "./saude.js";

describe("zRespostaSaude", () => {
  const VALIDA = {
    status: "ok",
    versao: "0.0.0",
    agora: "2026-07-31T14:05:09.000Z",
    tempoNoArSegundos: 42.5,
  };

  it("aceita a resposta de processo vivo", () => {
    expect(zRespostaSaude.parse(VALIDA)).toEqual(VALIDA);
  });

  it("recusa status diferente de ok", () => {
    // `/saude` responde 200 com "ok" ou não responde: estado intermediário é
    // trabalho de `/pronto`.
    expect(zRespostaSaude.safeParse({ ...VALIDA, status: "degradado" }).success).toBe(
      false,
    );
  });

  it("exige versão, que é a primeira pergunta do atendimento remoto", () => {
    expect(zRespostaSaude.safeParse({ ...VALIDA, versao: "" }).success).toBe(false);
  });

  it("recusa data sem fuso", () => {
    expect(
      zRespostaSaude.safeParse({ ...VALIDA, agora: "2026-07-31T14:05:09" }).success,
    ).toBe(false);
  });

  it("recusa tempo no ar negativo", () => {
    expect(zRespostaSaude.safeParse({ ...VALIDA, tempoNoArSegundos: -1 }).success).toBe(
      false,
    );
  });
});

describe("zVerificacao", () => {
  it("aceita verificação bem-sucedida com latência", () => {
    expect(zVerificacao.parse({ ok: true, latenciaMs: 3 })).toEqual({
      ok: true,
      latenciaMs: 3,
    });
  });

  it("exige latência mesmo na falha", () => {
    // Falha sem latência esconde a diferença entre "recusou na hora" e
    // "esgotou o tempo" — que é o dado que aponta a causa.
    expect(zVerificacao.safeParse({ ok: false }).success).toBe(false);
  });
});

describe("zRespostaProntidao", () => {
  it("aceita a resposta com a verificação do banco", () => {
    const valida = { pronto: true, verificacoes: { banco: { ok: true, latenciaMs: 2 } } };

    expect(zRespostaProntidao.parse(valida)).toEqual(valida);
  });

  it("exige a verificação do banco", () => {
    expect(zRespostaProntidao.safeParse({ pronto: true, verificacoes: {} }).success).toBe(
      false,
    );
  });
});
