/**
 * Aplica as migrações na instalação.
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
 * ### Por que o CLI é chamado por caminho, e não por `npx`
 *
 * A instalação embarca **só o `node.exe`** — não há `npm`, não há `npx`, e a
 * loja pode não ter internet no dia da instalação. `npx prisma` procuraria o
 * pacote no registro e falharia no balcão. O CLI viaja junto, e é invocado pelo
 * arquivo.
 *
 * ### Por que o motor de schema é apontado por variável
 *
 * O `schema-engine` é um executável nativo que o Prisma normalmente **baixa** na
 * primeira execução. Baixar na máquina do lojista é a mesma armadilha do `npx`:
 * depende de internet no pior momento. O instalador o carrega junto e informa
 * onde está — aí o CLI não busca nada.
 */

/**
 * Onde o schema do Prisma está, conforme onde o migrador roda.
 *
 * Dentro da instalação ele viaja ao lado do servidor; em desenvolvimento, mora
 * no pacote de persistência. Precisa achar os dois — e falhar com uma mensagem
 * que diz **onde procurou**, porque "schema não encontrado" sem a lista manda o
 * suporte adivinhar.
 */
export function acharSchema(
  candidatos: readonly string[],
  existe: (caminho: string) => boolean,
): string {
  const achado = candidatos.find(existe);

  if (achado === undefined) {
    throw new Error(
      `Schema do banco não encontrado. Procurei em:\n${candidatos.join("\n")}`,
    );
  }

  return achado;
}

/**
 * O ambiente com que o CLI do Prisma roda.
 *
 * Quando o motor embarcado existe, aponta-o; quando não existe — o caso do
 * desenvolvimento, onde o `node_modules` já o tem — devolve o ambiente
 * inalterado em vez de apontar para um arquivo ausente, que faria o CLI falhar
 * com "engine not found" em vez de usar o que ele já tem.
 */
export function ambienteDoPrisma(
  base: NodeJS.ProcessEnv,
  motor: string,
  existe: (caminho: string) => boolean,
): NodeJS.ProcessEnv {
  if (!existe(motor)) return base;

  return { ...base, PRISMA_SCHEMA_ENGINE_BINARY: motor };
}

/**
 * Os argumentos de `prisma migrate deploy`.
 *
 * Isolado do disparo para poder ser medido: errar aqui aplica a migração no
 * schema errado, e o sintoma aparece só quando a loja abre.
 */
export function argumentosDaMigracao(cli: string, schema: string): readonly string[] {
  return [cli, "migrate", "deploy", "--schema", schema];
}
