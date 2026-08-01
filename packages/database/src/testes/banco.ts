import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "../gerado/index.js";

/**
 * Banco de teste.
 *
 * Os testes desta camada rodam contra um **PostgreSQL de verdade**, e não
 * contra um duble. É a única forma de exercitar o que só existe no banco:
 * o gatilho que recusa alterar movimento de estoque, o índice parcial que
 * impede duas gavetas abertas, o `FOR UPDATE` que serializa a projeção de
 * saldo. Nenhuma dessas garantias aparece num repositório em memória — e são
 * justamente as que sustentam a integridade do estoque e do caixa.
 */

/** Banco criado pelo `docker compose up`, na porta não-padrão do projeto. */
const URL_PADRAO = "postgresql://erp:erp_dev_only@localhost:55432/erp_teste";

export function urlBancoDeTeste(): string {
  return process.env["DATABASE_URL_TESTE"] ?? URL_PADRAO;
}

/** Aplica as migrações no banco de teste. Idempotente. */
export function prepararBanco(): void {
  const schema = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], {
    env: { ...process.env, DATABASE_URL: urlBancoDeTeste() },
    stdio: "pipe",
  });
}

export function criarClienteDeTeste(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: urlBancoDeTeste() } },
    // Sem `error`: boa parte destes testes **espera** que a consulta falhe, e
    // registrar cada rejeição prevista esconderia a falha de verdade no meio.
    log: ["warn"],
  });
}

/**
 * Esvazia as tabelas entre testes.
 *
 * `TRUNCATE ... CASCADE` em vez de `DELETE`: não dispara o gatilho de
 * imutabilidade dos movimentos de estoque, que existe justamente para recusar
 * `DELETE`. Limpar o banco de teste é a única situação em que apagar um fato é
 * legítimo — e ela não deve exigir desligar a proteção.
 */
export async function limparBanco(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "baixas_titulo",
      "titulos",
      "itens_nota_compra",
      "notas_compra",
      "eventos_outbox",
      "pagamentos",
      "venda_itens",
      "vendas",
      "recebimentos_caixa",
      "movimentos_caixa",
      "sessoes_caixa",
      "saldos_estoque",
      "movimentos_estoque",
      "embalagens",
      "referencias_produto",
      "produtos",
      "sessoes_acesso",
      "estacoes_permitidas",
      "usuarios",
      "permissoes_papel",
      "papeis",
      "categorias",
      "clientes",
      "fornecedores",
      "empresas"
    RESTART IDENTITY CASCADE
  `);
}
