/**
 * Criação do banco da instalação.
 *
 * `initdb` cria o *cluster* e o papel `erp`, mas não cria o banco `erp_pdv` —
 * ele deixa apenas `postgres` e os `template`. Sem este passo, a migração
 * falharia com "database erp_pdv does not exist" na máquina do lojista, depois
 * de o instalador já ter escrito tudo.
 *
 * Poderia ser deixado a cargo do próprio Prisma, que cria o banco quando não o
 * encontra — mas isso é comportamento dele, não contrato nosso: numa atualização
 * do Prisma que mude essa conveniência, o defeito reapareceria numa instalação
 * já vendida. Criar explicitamente custa uma chamada e não depende de ninguém.
 */

/** Nome do banco. Casa com o `urlDoBanco` de `configuracao.ts`. */
export const NOME_DO_BANCO = "erp_pdv";

/** Papel dono do banco, criado pelo `initdb`. */
export const PAPEL_DO_BANCO = "erp";

/**
 * Argumentos do `createdb`.
 *
 * `--template=template0` e locale ICU pt-BR: a mesma collation do
 * desenvolvimento e do CI. Herdar de `template1` traria a collation do sistema
 * operacional da loja — e aí ordenação e índice se comportam diferente em cada
 * cliente, com o defeito aparecendo como lista fora de ordem que ninguém
 * consegue reproduzir.
 */
export function argumentosDoCreatedb(porta: number): readonly string[] {
  return [
    "--host=localhost",
    `--port=${String(porta)}`,
    `--username=${PAPEL_DO_BANCO}`,
    "--no-password",
    "--template=template0",
    "--encoding=UTF8",
    "--locale-provider=icu",
    "--icu-locale=pt-BR",
    NOME_DO_BANCO,
  ];
}

/**
 * Já existe um banco criado?
 *
 * Reinstalar por cima de uma loja em operação é caso real — atualização de
 * versão, técnico refazendo um passo. Recriar o banco ali apagaria as vendas,
 * então a existência é consultada antes, e a criação é pulada em silêncio.
 */
export function argumentosDaConsultaDeBanco(porta: number): readonly string[] {
  return [
    "--host=localhost",
    `--port=${String(porta)}`,
    "--username=" + PAPEL_DO_BANCO,
    "--no-password",
    "--dbname=postgres",
    "--tuples-only",
    "--no-align",
    "--command",
    `SELECT 1 FROM pg_database WHERE datname = '${NOME_DO_BANCO}'`,
  ];
}

/** `psql` devolve a linha `1` quando o banco existe, e nada quando não existe. */
export function bancoExiste(saidaDoPsql: string): boolean {
  return saidaDoPsql.trim() === "1";
}
