import type { PrismaClient } from "@erp/database";
import { afterAll, describe, expect, it, vi } from "vitest";

import { montarContainer, montarContainerCom } from "./container.js";

/**
 * Integração do container contra **PostgreSQL de verdade**.
 *
 * Um dublê responderia "banco ok" sem provar nada: o que este teste verifica é
 * que a URL configurada realmente conecta, que a verificação de prontidão
 * mede tempo real e que `encerrar` devolve as conexões. São as três coisas que
 * decidem se o servidor sobe na loja, e nenhuma delas aparece em teste com
 * dublê.
 */

const URL_PADRAO = "postgresql://erp:erp_dev_only@localhost:55432/erp_teste";

const urlBanco = process.env["DATABASE_URL_TESTE"] ?? URL_PADRAO;

function ambiente(url: string): Parameters<typeof montarContainer>[0] {
  return {
    modo: "test",
    endereco: "127.0.0.1",
    porta: 0,
    urlBanco: url,
    nivelLog: "silent",
    registrarConsultasSql: false,
    limiteRequisicoesPorMinuto: 600,
    tempoLimiteEncerramentoMs: 1_000,
  };
}

const container = montarContainer(ambiente(urlBanco));

afterAll(async () => {
  await container.encerrar();
});

describe("montarContainer", () => {
  it("verifica o banco com sucesso e mede a latência", async () => {
    const verificacao = await container.verificarBanco();

    expect(verificacao.ok).toBe(true);
    expect(verificacao.latenciaMs).toBeGreaterThanOrEqual(0);
  });

  it("monta os adapters das portas de infraestrutura", () => {
    expect(container.geradorId.proximo().versao).toBe(7);
    expect(container.relogio.agora()).toBeInstanceOf(Date);
  });

  it("continua verificando depois de encerrar e reconectar", async () => {
    // O Prisma reconecta sob demanda: um `$disconnect` seguido de nova consulta
    // não pode deixar o servidor inútil até reiniciar.
    const outro = montarContainer(ambiente(urlBanco));

    await outro.encerrar();

    expect((await outro.verificarBanco()).ok).toBe(true);

    await outro.encerrar();
  });

  it("desiste da verificação quando o banco não responde", async () => {
    // Banco travado — bloqueio longo, disco cheio — não pode pendurar `/pronto`.
    // Quem consulta precisa de um "não" rápido: o instalador para decidir que
    // falhou, o PDV para entrar em contingência. Sem prazo, os dois esperariam.
    vi.useFakeTimers();

    const bancoTravado = {
      $queryRaw: () => new Promise(() => undefined),
      $disconnect: () => Promise.resolve(),
    } as unknown as PrismaClient;

    const verificacao = montarContainerCom(bancoTravado).verificarBanco();

    await vi.advanceTimersByTimeAsync(2_100);
    vi.useRealTimers();

    expect(await verificacao).toMatchObject({ ok: false });
  });

  it("responde que não está pronto quando o banco não existe", async () => {
    // O caminho que importa: sem isto, `/pronto` propagaria a exceção do Prisma
    // e responderia 500 em vez de 503 — e o instalador não saberia distinguir
    // "não está pronto ainda" de "quebrou".
    const inexistente = montarContainer(
      ambiente("postgresql://erp:erp_dev_only@localhost:55432/banco_que_nao_existe"),
    );

    const verificacao = await inexistente.verificarBanco();

    expect(verificacao.ok).toBe(false);
    expect(verificacao.latenciaMs).toBeGreaterThanOrEqual(0);

    await inexistente.encerrar();
  });
});
