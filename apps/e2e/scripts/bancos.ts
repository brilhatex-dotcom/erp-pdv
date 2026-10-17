/**
 * Os bancos do teste no navegador.
 *
 * Próprios, e não os das suítes de integração: o preparo os recria do zero a
 * cada execução, e o servidor de verdade fica com eles enquanto o teste roda.
 * O do treino tem o nome que o servidor exige para montar a loja de
 * demonstração nele (ADR-0026).
 */

/** Banco criado pelo `docker compose up`, na porta não-padrão do projeto. */
const URL_PADRAO = "postgresql://erp:erp_dev_only@localhost:55432/erp_teste_e2e";

export const URL_BANCO = process.env["DATABASE_URL_E2E"] ?? URL_PADRAO;

export const URL_BANCO_TREINO = comBanco(URL_BANCO, (nome) => `${nome}_treino`);

/** O mesmo servidor de banco, noutro banco. */
export function comBanco(url: string, nome: (atual: string) => string): string {
  const endereco = new URL(url);
  endereco.pathname = `/${nome(endereco.pathname.slice(1))}`;

  return endereco.toString();
}

/** O nome do banco, como está no endereço. */
export function nomeDoBanco(url: string): string {
  return new URL(url).pathname.slice(1);
}
