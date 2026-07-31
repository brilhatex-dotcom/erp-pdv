import { PrismaClient } from "./gerado/index.js";

export interface OpcoesPrisma {
  readonly urlBanco: string;
  /** Registra cada consulta. Só em diagnóstico — enche o disco da loja. */
  readonly registrarConsultas?: boolean;
}

/**
 * Cria o cliente do banco.
 *
 * Fica atrás de função em vez de instância exportada porque instância no
 * módulo abre conexão no `import` — o que quebra teste, quebra script de
 * migração e transforma a ordem dos imports em comportamento.
 */
export function criarPrismaClient(opcoes: OpcoesPrisma): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: opcoes.urlBanco } },
    log:
      opcoes.registrarConsultas === true ? ["query", "warn", "error"] : ["warn", "error"],
  });
}
