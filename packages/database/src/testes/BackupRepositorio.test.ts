import type { ExecucaoDeBackup, OrigemDaCopia } from "@erp/application";
import { Identificador } from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BackupRepositorioPrisma } from "../repositorios/BackupRepositorioPrisma.js";
import {
  criarClienteDeTeste,
  garantirUsuario,
  limparBanco,
  prepararBanco,
} from "./banco.js";

/**
 * A agenda e o registro das tentativas, gravados e lidos de volta.
 *
 * O vocabulário da tabela é o de antes ("agendado"), o da aplicação é o de
 * agora ("automática"): é aqui que um erro de tradução apareceria — como a
 * tela dizendo que nunca houve cópia automática.
 */

const prisma = criarClienteDeTeste();
const repositorio = new BackupRepositorioPrisma(prisma);

function id(sufixo: string): Identificador {
  return Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-1c2d3e8d${sufixo}`).unwrap();
}

const ANA = id("0001");
const INICIO = new Date("2026-10-17T13:00:00.000Z");

function execucao(sobrescritas: Partial<ExecucaoDeBackup> = {}): ExecucaoDeBackup {
  return {
    id: id("1001"),
    operacao: "BACKUP",
    origem: "AUTOMATICA",
    situacao: "EM_ANDAMENTO",
    iniciadaEm: INICIO,
    ...sobrescritas,
  };
}

beforeAll(() => {
  prepararBanco();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
  await garantirUsuario(prisma, ANA.valor, "1");
});

describe("a agenda", () => {
  it("🔑 antes da primeira gravação não há agenda — vale a de fábrica, sem gravar", async () => {
    expect(await repositorio.configuracao()).toBeUndefined();
  });

  it("🔑 grava e regrava a mesma linha", async () => {
    await repositorio.salvarConfiguracao(
      { intervaloHoras: 4, aoFecharCaixa: false, copiasRecentes: 12 },
      id("2001"),
    );
    await repositorio.salvarConfiguracao(
      { intervaloHoras: 6, aoFecharCaixa: true, copiasRecentes: 12 },
      id("2002"),
    );

    expect(await repositorio.configuracao()).toEqual({
      intervaloHoras: 6,
      aoFecharCaixa: true,
      copiasRecentes: 12,
    });

    const linhas = await prisma.configuracaoBackup.findMany();
    expect(linhas.map((linha) => linha.id)).toEqual([id("2001").valor]);
  });

  it("os padrões do banco são os da arquitetura: de hora em hora, 24 recentes", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "configuracao_backup" ("id", "atualizado_em") VALUES ('${id("2003").valor}', now())`,
    );

    expect(await repositorio.configuracao()).toEqual({
      intervaloHoras: 1,
      aoFecharCaixa: true,
      copiasRecentes: 24,
    });
  });
});

describe("as tentativas", () => {
  it("🔑 a tentativa gravada no começo é a mesma regravada no fim", async () => {
    await repositorio.registrarExecucao(execucao({ usuarioId: ANA, origem: "MANUAL" }));
    await repositorio.registrarExecucao(
      execucao({
        usuarioId: ANA,
        origem: "MANUAL",
        situacao: "CONCLUIDO",
        concluidaEm: new Date("2026-10-17T13:00:40.000Z"),
        arquivo: "copia-20261017-130000-manual.dump",
        tamanhoBytes: 12_900_000,
        sha256: "f".repeat(64),
      }),
    );

    const [lida] = await repositorio.ultimasExecucoes(10);

    expect(await prisma.execucaoBackup.count()).toBe(1);
    expect(lida).toEqual({
      id: id("1001"),
      operacao: "BACKUP",
      origem: "MANUAL",
      situacao: "CONCLUIDO",
      iniciadaEm: INICIO,
      concluidaEm: new Date("2026-10-17T13:00:40.000Z"),
      arquivo: "copia-20261017-130000-manual.dump",
      tamanhoBytes: 12_900_000,
      sha256: "f".repeat(64),
      erro: undefined,
      usuarioId: ANA,
    });
  });

  it("🔑 cada origem volta como foi — inclusive a cópia de antes de restaurar", async () => {
    const origens: readonly OrigemDaCopia[] = [
      "AUTOMATICA",
      "MANUAL",
      "FECHAMENTO_DE_CAIXA",
      "ANTES_DE_RESTAURAR",
    ];

    for (const [posicao, origem] of origens.entries()) {
      await repositorio.registrarExecucao(
        execucao({
          id: id(`300${String(posicao)}`),
          origem,
          iniciadaEm: new Date(INICIO.getTime() + posicao * 60_000),
        }),
      );
    }

    const lidas = await repositorio.ultimasExecucoes(10);
    expect(lidas.map((lida) => lida.origem)).toEqual([...origens].reverse());

    const gravadas = await prisma.execucaoBackup.findMany({
      orderBy: { iniciadaEm: "asc" },
    });
    expect(gravadas.map((linha) => linha.origem)).toEqual([
      "AGENDADO",
      "MANUAL",
      "FECHAMENTO",
      "RESTAURACAO",
    ]);
  });

  it("🔑 a mais nova primeiro, desempatando pelo id; com limite e por operação", async () => {
    await repositorio.registrarExecucao(execucao({ id: id("4001") }));
    await repositorio.registrarExecucao(execucao({ id: id("4002") }));
    await repositorio.registrarExecucao(
      execucao({
        id: id("4003"),
        operacao: "RESTAURACAO",
        origem: "MANUAL",
        situacao: "FALHOU",
        erro: "Esta cópia é de outra versão do sistema.",
        iniciadaEm: new Date(INICIO.getTime() + 60_000),
      }),
    );

    expect((await repositorio.ultimasExecucoes(10)).map((lida) => lida.id.valor)).toEqual(
      [id("4003").valor, id("4002").valor, id("4001").valor],
    );
    expect((await repositorio.ultimasExecucoes(1, "BACKUP"))[0]?.id).toEqual(id("4002"));
    expect(await repositorio.ultimasExecucoes(10, "RESTAURACAO")).toMatchObject([
      { situacao: "FALHOU", erro: "Esta cópia é de outra versão do sistema." },
    ]);
  });

  it("quem não existe no cadastro não entra no registro — a aplicação grava sem o vínculo", async () => {
    await expect(
      repositorio.registrarExecucao(execucao({ usuarioId: id("9999") })),
    ).rejects.toThrow();
  });

  it("o banco recusa origem que a aplicação não conhece", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "execucoes_backup" ("id", "operacao", "origem", "situacao", "iniciada_em")
         VALUES ('${id("5001").valor}', 'BACKUP', 'OUTRA', 'CONCLUIDO', now())`,
      ),
    ).rejects.toThrow(/ck_execucoes_origem/);
  });
});
