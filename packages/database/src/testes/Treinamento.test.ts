import { type GeradorId, LojaDeTreinamento, PESSOAS_DE_TREINO } from "@erp/application";
import { Identificador } from "@erp/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "../gerado/index.js";
import { HasherArgon2 } from "../HasherArgon2.js";
import { BancoDeTreinamentoPrisma } from "../treinamento/BancoDeTreinamentoPrisma.js";
import { UnitOfWorkPrisma } from "../UnitOfWorkPrisma.js";
import {
  criarClienteDeTeste,
  prepararBanco,
  urlBancoDeTeste,
  urlComBanco,
} from "./banco.js";

/**
 * O banco do treinamento com o PostgreSQL de verdade.
 *
 * É aqui que a loja de demonstração enfrenta as chaves estrangeiras, os
 * índices únicos e as restrições que os dublês não têm — e que o esvaziamento
 * prova a trava do nome do banco no próprio banco.
 */

const BANCO = "erp_teste_treino";
const URL = urlComBanco(BANCO);

const administrador = criarClienteDeTeste(urlComBanco("postgres"));
let prisma: PrismaClient;

/** Continua contando entre as montagens: a loja recomeçada ganha ids novos. */
function geradorSequencial(): GeradorId {
  let contador = 0;
  return {
    proximo: () => {
      contador += 1;
      const sufixo = contador.toString().padStart(12, "0");
      return Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-${sufixo}`).unwrap();
    },
  };
}

function montarLoja(cliente: PrismaClient): LojaDeTreinamento {
  return new LojaDeTreinamento(
    new UnitOfWorkPrisma(cliente),
    new BancoDeTreinamentoPrisma(cliente),
    geradorSequencial(),
    new HasherArgon2(),
    { agora: () => new Date("2026-10-17T12:00:00.000Z") },
  );
}

async function contar(cliente: PrismaClient, tabela: string): Promise<number> {
  const [{ total }] = await cliente.$queryRawUnsafe<[{ total: bigint }]>(
    `SELECT count(*) AS total FROM "${tabela}"`,
  );
  return Number(total);
}

beforeAll(async () => {
  await administrador.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`,
  );
  await administrador.$executeRawUnsafe(`CREATE DATABASE "${BANCO}"`);
  prepararBanco(URL);
  prisma = criarClienteDeTeste(URL);
});

afterAll(async () => {
  await prisma.$disconnect();
  await administrador.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`,
  );
  await administrador.$disconnect();
});

describe("BancoDeTreinamentoPrisma", () => {
  it("🔑 a loja de treino entra inteira no banco de verdade, e recomeça do zero", async () => {
    const loja = montarLoja(prisma);
    expect((await new BancoDeTreinamentoPrisma(prisma).conferir()).isOk()).toBe(true);

    expect((await loja.preparar()).unwrap()).toBe(true);

    expect(await contar(prisma, "usuarios")).toBe(PESSOAS_DE_TREINO.length);
    expect(await contar(prisma, "produtos")).toBe(13);
    expect(await contar(prisma, "movimentos_estoque")).toBe(13);
    expect(await contar(prisma, "clientes")).toBe(2);
    const pao = await prisma.saldoEstoque.findFirst({
      where: { produto: { sku: "T-PAO" } },
    });
    expect(pao?.milesimos).toBe(30_000n);

    const antes = await prisma.usuario.findMany({ select: { id: true } });
    const migracoes = await contar(prisma, "_prisma_migrations");

    expect((await loja.recomecar()).isOk()).toBe(true);

    // Gente nova, com os mesmos PINs; e o banco continua sabendo que está
    // migrado.
    const depois = await prisma.usuario.findMany({ select: { id: true } });
    expect(depois).toHaveLength(PESSOAS_DE_TREINO.length);
    expect(depois.some(({ id }) => antes.some((anterior) => anterior.id === id))).toBe(
      false,
    );
    expect(await contar(prisma, "movimentos_estoque")).toBe(13);
    expect(await contar(prisma, "_prisma_migrations")).toBe(migracoes);
  });

  it("🔑 esvazia também as tabelas de fatos, que recusam DELETE", async () => {
    const loja = montarLoja(prisma);
    await loja.preparar();

    // O gatilho de imutabilidade está de pé: apagar um movimento é recusado.
    await expect(prisma.movimentoEstoque.deleteMany({})).rejects.toThrow();

    expect((await new BancoDeTreinamentoPrisma(prisma).esvaziar()).isOk()).toBe(true);

    expect(await contar(prisma, "movimentos_estoque")).toBe(0);
    expect(await contar(prisma, "usuarios")).toBe(0);
    expect(await contar(prisma, "saldos_estoque")).toBe(0);
  });

  it("🔑 recusa esvaziar um banco cujo nome não termina em _treino", async () => {
    // O banco das outras suítes: é o caso real do instalador que apontasse o
    // treino para o banco da loja.
    prepararBanco();
    const daLoja = criarClienteDeTeste(urlBancoDeTeste());

    const testemunha = "018f3a2b-7c1d-7e4f-8a9b-7e57e57e57e5";

    try {
      await daLoja.categoria.create({
        data: { id: testemunha, nome: "Testemunha", nomeBusca: "testemunha da trava" },
      });

      const banco = new BancoDeTreinamentoPrisma(daLoja);
      const conferido = await banco.conferir();
      const esvaziado = await banco.esvaziar();

      expect(conferido.isErr() && conferido.error.codigo).toBe("BANCO_NAO_E_DE_TREINO");
      expect(esvaziado.isErr() && esvaziado.error.codigo).toBe("BANCO_NAO_E_DE_TREINO");
      expect(await daLoja.categoria.count({ where: { id: testemunha } })).toBe(1);
    } finally {
      await daLoja.categoria.deleteMany({ where: { id: testemunha } });
      await daLoja.$disconnect();
    }
  });

  it("banco fora do ar: erro de infraestrutura, sem exceção", async () => {
    const fora = criarClienteDeTeste(
      "postgresql://erp:erp_dev_only@127.0.0.1:1/erp_teste_treino?connect_timeout=2",
    );

    try {
      const banco = new BancoDeTreinamentoPrisma(fora);

      for (const resultado of [await banco.conferir(), await banco.esvaziar()]) {
        expect(resultado.isErr() && resultado.error.codigo).toBe("FALHA_INFRAESTRUTURA");
      }
    } finally {
      await fora.$disconnect();
    }
  });
});
