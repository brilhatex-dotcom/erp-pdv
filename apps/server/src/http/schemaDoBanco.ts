import { existsSync } from "node:fs";

/**
 * Onde o schema do Prisma está, conforme onde o servidor roda.
 *
 * Dentro da instalação ele viaja ao lado do servidor; em desenvolvimento, mora
 * no pacote de persistência. O migrador precisa achar os dois — e falhar com
 * uma mensagem que diz **onde procurou**, porque "schema não encontrado" sem a
 * lista manda o suporte adivinhar.
 */
export function acharSchema(
  candidatos: readonly string[],
  existe: (caminho: string) => boolean = existsSync,
): string {
  const achado = candidatos.find(existe);

  if (achado === undefined) {
    throw new Error(
      `Schema do banco não encontrado. Procurei em:\n${candidatos.join("\n")}`,
    );
  }

  return achado;
}
