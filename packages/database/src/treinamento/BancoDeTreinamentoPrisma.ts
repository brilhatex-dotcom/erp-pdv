import { type BancoDeTreinamento, ErroInfraestrutura } from "@erp/application";
import { type DomainError, err, ErroRegraNegocio, ok, type Result } from "@erp/domain";

import type { PrismaClient } from "../gerado/index.js";

/** Todo banco de treino termina assim; o instalador cria `erp_pdv_treino`. */
const SUFIXO_DO_TREINO = "_treino";

/**
 * O banco do modo treinamento (ADR-0026).
 *
 * ### A trava mora aqui, e confere o próprio banco
 *
 * Esvaziar é `TRUNCATE` em todas as tabelas — inclusive nas de fatos, cujo
 * gatilho de imutabilidade recusa `DELETE` mas não vê `TRUNCATE`. Apontado
 * para o banco da loja, isto apagaria o movimento inteiro. Por isso a
 * conferência não confia em configuração nenhuma: pergunta ao PostgreSQL o
 * nome do banco em que está conectado, dentro da mesma transação que vai
 * esvaziá-lo, e recusa o que não terminar em `_treino`.
 *
 * ### As tabelas vêm do catálogo
 *
 * E não de uma lista escrita aqui: a lista envelheceria na primeira migração
 * nova, e o treino "recomeçado" guardaria as vendas de mentira da tabela
 * esquecida. Só `_prisma_migrations` fica — sem ela, o banco esqueceria que
 * já está migrado.
 */
export class BancoDeTreinamentoPrisma implements BancoDeTreinamento {
  constructor(private readonly prisma: PrismaClient) {}

  async conferir(): Promise<Result<void, DomainError>> {
    try {
      const [{ banco }] = await this.prisma.$queryRaw<[{ banco: string }]>`
        SELECT current_database() AS banco
      `;

      return banco.endsWith(SUFIXO_DO_TREINO) ? ok(undefined) : err(naoEDeTreino(banco));
    } catch (causa) {
      return err(ErroInfraestrutura.de(causa));
    }
  }

  async esvaziar(): Promise<Result<void, DomainError>> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [{ banco, tabelas }] = await tx.$queryRaw<
          [{ banco: string; tabelas: string | null }]
        >`
          SELECT
            current_database() AS banco,
            string_agg(format('%I.%I', schemaname, tablename), ', ') AS tabelas
          FROM pg_tables
          WHERE schemaname = current_schema()
            AND tablename <> '_prisma_migrations'
        `;

        if (!banco.endsWith(SUFIXO_DO_TREINO)) return err(naoEDeTreino(banco));

        // `format('%I')` já pôs aspas em cada nome; o que vai na instrução
        // veio do catálogo do próprio banco, não de quem chamou.
        if (tabelas !== null) {
          await tx.$executeRawUnsafe(
            `TRUNCATE TABLE ${tabelas} RESTART IDENTITY CASCADE`,
          );
        }

        return ok(undefined);
      });
    } catch (causa) {
      return err(ErroInfraestrutura.de(causa));
    }
  }
}

function naoEDeTreino(banco: string): ErroRegraNegocio {
  return new ErroRegraNegocio(
    "BANCO_NAO_E_DE_TREINO",
    "Este banco não é o do treinamento: nada foi gravado nem apagado nele.",
    { banco },
  );
}
