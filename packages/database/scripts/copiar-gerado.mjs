import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Copia o cliente do Prisma para `dist`.
 *
 * O `tsc` compila apenas `.ts`; o cliente gerado é `.js` + `.d.ts` + binário
 * nativo, então ele não atravessa a compilação sozinho — e `dist/cliente.js`
 * ficaria importando um módulo inexistente. O defeito só aparece quando **outro
 * pacote** importa `@erp/database` pelo nome, que foi exatamente como apareceu.
 *
 * `cpSync` em vez de `cp -r` para funcionar também no Windows, onde o
 * instalador é construído.
 */
const origem = fileURLToPath(new URL("../src/gerado", import.meta.url));
const destino = fileURLToPath(new URL("../dist/gerado", import.meta.url));

if (!existsSync(origem)) {
  process.stderr.write("cliente do Prisma ausente: rode `prisma generate` antes\n");
  process.exit(1);
}

cpSync(origem, destino, { recursive: true });
