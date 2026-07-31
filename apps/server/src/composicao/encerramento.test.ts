import { describe, expect, it, vi } from "vitest";

import { criarEncerrador, type Registrador } from "./encerramento.js";

function registradorFalso(): Registrador & { erros: () => Record<string, unknown>[] } {
  const erros: Record<string, unknown>[] = [];

  return {
    info: () => undefined,
    error: (objeto) => {
      erros.push(objeto);
    },
    erros: () => erros,
  };
}

describe("criarEncerrador", () => {
  it("fecha o servidor antes das conexões do banco", async () => {
    // A ordem é o ponto: com o banco fechado primeiro, a venda em curso
    // morreria com erro técnico na tela do operador.
    const ordem: string[] = [];

    await criarEncerrador({
      servidor: {
        close: () => {
          ordem.push("servidor");
          return Promise.resolve();
        },
      },
      recursos: {
        encerrar: () => {
          ordem.push("banco");
          return Promise.resolve();
        },
      },
      tempoLimiteMs: 1_000,
      registrador: registradorFalso(),
    })();

    expect(ordem).toEqual(["servidor", "banco"]);
  });

  it("executa uma vez só, mesmo com dois sinais", async () => {
    // Dois `Ctrl+C` impacientes não podem fechar o banco enquanto o primeiro
    // encerramento ainda espera as requisições em curso.
    const fecharServidor = vi.fn(() => Promise.resolve());
    const encerrarRecursos = vi.fn(() => Promise.resolve());

    const encerrar = criarEncerrador({
      servidor: { close: fecharServidor },
      recursos: { encerrar: encerrarRecursos },
      tempoLimiteMs: 1_000,
      registrador: registradorFalso(),
    });

    await Promise.all([encerrar(), encerrar(), encerrar()]);

    expect(fecharServidor).toHaveBeenCalledTimes(1);
    expect(encerrarRecursos).toHaveBeenCalledTimes(1);
  });

  it("segue para o banco quando o servidor não fecha no prazo", async () => {
    // Conexão pendurada não pode impedir a parada do serviço: o atualizador
    // desistiria e o cliente ficaria sem servidor (§13.5).
    vi.useFakeTimers();

    const registrador = registradorFalso();
    const encerrarRecursos = vi.fn(() => Promise.resolve());

    const encerramento = criarEncerrador({
      servidor: { close: () => new Promise<void>(() => undefined) },
      recursos: { encerrar: encerrarRecursos },
      tempoLimiteMs: 500,
      registrador,
    })();

    await vi.advanceTimersByTimeAsync(600);
    await encerramento;
    vi.useRealTimers();

    expect(encerrarRecursos).toHaveBeenCalledTimes(1);
    expect(registrador.erros()[0]?.["passo"]).toBe("servidor HTTP");
  });

  it("registra a falha do banco sem propagar exceção", async () => {
    const registrador = registradorFalso();

    await expect(
      criarEncerrador({
        servidor: { close: () => Promise.resolve() },
        recursos: { encerrar: () => Promise.reject(new Error("conexão já perdida")) },
        tempoLimiteMs: 1_000,
        registrador,
      })(),
    ).resolves.toBeUndefined();

    expect(registrador.erros()[0]).toMatchObject({
      passo: "conexões do banco",
      causa: "conexão já perdida",
    });
  });

  it("descreve causa que não é exceção", async () => {
    const registrador = registradorFalso();

    await criarEncerrador({
      // Rejeição com texto é exatamente o cenário a exercitar: biblioteca de
      // terceiro rejeita com o que quiser, e o encerramento não pode depender de
      // ser um `Error` para conseguir registrar a causa.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      servidor: { close: () => Promise.reject("desligado na tomada") },
      recursos: { encerrar: () => Promise.resolve() },
      tempoLimiteMs: 1_000,
      registrador,
    })();

    expect(registrador.erros()[0]?.["causa"]).toBe("desligado na tomada");
  });
});
