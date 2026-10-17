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

/** O mesmo servidor de banco, noutro banco — o de uma suíte que precisa do seu. */
export function urlComBanco(banco: string, url = urlBancoDeTeste()): string {
  const endereco = new URL(url);
  endereco.pathname = `/${banco}`;
  return endereco.toString();
}

/** O esquema do Prisma; as migrações ficam na pasta ao lado dele. */
export const ESQUEMA_PRISMA = fileURLToPath(
  new URL("../../prisma/schema.prisma", import.meta.url),
);

/** Aplica as migrações no banco de teste. Idempotente. */
export function prepararBanco(url = urlBancoDeTeste(), schema = ESQUEMA_PRISMA): void {
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

export function criarClienteDeTeste(url = urlBancoDeTeste()): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
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
      "registros_auditoria",
      "devolucao_itens",
      "devolucoes",
      "execucoes_backup",
      "configuracao_backup",
      "configuracao_loja",
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
      "empresas",
      "imagens"
    RESTART IDENTITY CASCADE
  `);
}

/** Papel mínimo dos usuários de teste. Só existe para satisfazer a chave estrangeira. */
const PAPEL_DE_TESTE = "018f3a2b-7c1d-7e4f-8a9b-00000000fffe";

/**
 * Garante que o operador existe como **usuário de verdade**.
 *
 * As sessões de caixa têm chave estrangeira para `usuarios` desde a migração
 * `balcao_completo`: o banco recusa caixa aberto por alguém que não existe.
 * Os testes que só queriam um identificador qualquer de operador passam por
 * aqui — e deixam de afirmar, sem querer, que o banco aceita o que não deveria.
 */
export async function garantirUsuario(
  prisma: PrismaClient,
  id: string,
  matricula = "999",
): Promise<void> {
  await prisma.papel.upsert({
    where: { id: PAPEL_DE_TESTE },
    create: { id: PAPEL_DE_TESTE, codigo: "TESTE", nome: "Papel de teste" },
    update: {},
  });

  await prisma.usuario.upsert({
    where: { id },
    create: { id, matricula, nome: "Operador de teste", papelId: PAPEL_DE_TESTE },
    update: {},
  });
}
