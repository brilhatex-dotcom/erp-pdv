import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { conexaoDe, executar, programa } from "../backup/ferramentas.js";
import {
  criarClienteDeTeste,
  ESQUEMA_PRISMA,
  prepararBanco,
  urlComBanco,
} from "./banco.js";

/**
 * Toda reversão devolve o banco ao que ele era antes da migração.
 *
 * "Script de reversão testado" é portão de merge (CLAUDE.md §7), e reversão
 * conferida de olho falha no dia em que é usada: na loja, com a versão nova
 * dando problema e o técnico ao telefone. Aqui ela roda de verdade: um banco
 * migrado até a anterior, outro migrado até ela e revertido — e os dois têm de
 * sair idênticos no `pg_dump`, esquema e dados de fábrica.
 *
 * Valem as migrações do fim da lista que têm `reversao.sql`, em sequência: a
 * reversão só serve voltando uma de cada vez, da mais nova para trás.
 */

const PASTA_MIGRACOES = join(dirname(ESQUEMA_PRISMA), "migrations");
const PASTA_BINARIOS = process.env["PASTA_BINARIOS_POSTGRES"];

const administrador = criarClienteDeTeste(urlComBanco("postgres"));
const temporarias: string[] = [];

const todas = (await readdir(PASTA_MIGRACOES))
  .filter((nome) => /^\d{14}_/.test(nome))
  .sort();

function reversiveisDoFim(): readonly string[] {
  const reversiveis: string[] = [];

  for (const nome of [...todas].reverse()) {
    if (!existsSync(join(PASTA_MIGRACOES, nome, "reversao.sql"))) break;
    reversiveis.push(nome);
  }

  return reversiveis;
}

afterAll(async () => {
  for (const banco of ["erp_teste_reversao_antes", "erp_teste_reversao_depois"]) {
    await administrador.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`,
    );
  }
  await administrador.$disconnect();
  for (const pasta of temporarias) await rm(pasta, { recursive: true, force: true });
});

/** Um banco novo, migrado até `ultima` (inclusive). */
async function migradoAte(banco: string, ultima: string): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), "erp-reversao-"));
  temporarias.push(pasta);

  await copyFile(ESQUEMA_PRISMA, join(pasta, "schema.prisma"));
  await mkdir(join(pasta, "migrations"));
  await copyFile(
    join(PASTA_MIGRACOES, "migration_lock.toml"),
    join(pasta, "migrations", "migration_lock.toml"),
  );
  for (const nome of todas.filter((candidata) => candidata <= ultima)) {
    await cp(join(PASTA_MIGRACOES, nome), join(pasta, "migrations", nome), {
      recursive: true,
    });
  }

  await administrador.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`,
  );
  await administrador.$executeRawUnsafe(`CREATE DATABASE "${banco}"`);

  const url = urlComBanco(banco);
  prepararBanco(url, join(pasta, "schema.prisma"));

  return url;
}

async function psql(url: string, argumentos: readonly string[]): Promise<string> {
  const conexao = conexaoDe(url);

  return executar(
    programa("psql", PASTA_BINARIOS),
    [
      "--no-psqlrc",
      "--quiet",
      "--set=ON_ERROR_STOP=1",
      `--dbname=${conexao.banco}`,
      ...argumentos,
    ],
    { variaveis: conexao.variaveis, tempoLimiteMs: 120_000 },
  );
}

/**
 * O banco inteiro em texto, menos o que muda a cada execução: a tabela de
 * controle do Prisma (datas, somas) e as linhas `\restrict` que o `pg_dump`
 * recente sorteia a cada saída.
 */
async function fotografia(url: string): Promise<string> {
  const conexao = conexaoDe(url);
  const saida = await executar(
    programa("pg_dump", PASTA_BINARIOS),
    [
      "--no-owner",
      "--no-privileges",
      "--exclude-table-data=_prisma_migrations",
      `--dbname=${conexao.banco}`,
    ],
    { variaveis: conexao.variaveis, tempoLimiteMs: 120_000 },
  );

  return saida
    .split("\n")
    .filter((linha) => !/^\\(un)?restrict /.test(linha))
    .join("\n");
}

async function migracoesAplicadas(url: string): Promise<string> {
  return psql(url, [
    "--tuples-only",
    "--no-align",
    "--command=SELECT migration_name FROM _prisma_migrations ORDER BY 1",
  ]);
}

describe("reversão das migrações", () => {
  it("🔑 a migração mais nova tem reversão", () => {
    expect(reversiveisDoFim()[0]).toBe(todas.at(-1));
  });

  for (const migracao of reversiveisDoFim()) {
    it(`🔑 a reversão de ${migracao} devolve o banco de antes`, async () => {
      const anterior = todas[todas.indexOf(migracao) - 1] ?? "";

      const antes = await migradoAte("erp_teste_reversao_antes", anterior);
      const depois = await migradoAte("erp_teste_reversao_depois", migracao);

      await psql(depois, [`--file=${join(PASTA_MIGRACOES, migracao, "reversao.sql")}`]);

      expect(await migracoesAplicadas(depois)).toBe(await migracoesAplicadas(antes));
      expect(await fotografia(depois)).toBe(await fotografia(antes));
    }, 120_000);
  }
});
