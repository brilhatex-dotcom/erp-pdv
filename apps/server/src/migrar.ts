import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { acharSchema } from "./http/schemaDoBanco.js";

/**
 * Aplica as migrações na instalação.
 *
 * Chamado pelo instalador logo depois de configurar, e pelo atualizador antes
 * de subir a versão nova.
 *
 * ### Por que o CLI do Prisma, e não SQL cru
 *
 * As migrações são versionadas e têm ordem; aplicá-las à mão exigiria
 * reimplementar o controle de `_prisma_migrations` — e um erro nesse controle
 * reaplica uma migração já aplicada, na base de produção de um cliente. O CLI
 * já resolve isso e está exercitado por milhões de instalações. O custo é
 * embarcá-lo; a alternativa é escrever um migrador nosso para fazer pior o que
 * já existe.
 *
 * ### `deploy`, nunca `dev`
 *
 * `migrate dev` é **interativo** e pode reconstruir o banco. Rodá-lo numa loja
 * apagaria as vendas. `deploy` só aplica o que falta, em ordem, e falha se
 * encontrar divergência — o comportamento certo quando há dado real do outro
 * lado.
 *
 * Casca sem decisão: o que escolhe está em `acharSchema`, que é medido.
 */
const schema = acharSchema([
  fileURLToPath(new URL("./prisma/schema.prisma", import.meta.url)),
  fileURLToPath(
    new URL("../../../packages/database/prisma/schema.prisma", import.meta.url),
  ),
]);

execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], {
  stdio: "inherit",
  env: process.env,
});
