import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  argumentosDaConsultaDeBanco,
  argumentosDoCreatedb,
  bancoExiste,
} from "./banco.js";
import { caminhosDeDados, PASTA_DE_DADOS_PADRAO } from "./caminhos.js";
import {
  conteudoDoEnv,
  gerarSegredos,
  lerSegredosDoEnv,
  PORTA_POSTGRES_PADRAO,
  PORTA_SERVIDOR_PADRAO,
  type Segredos,
} from "./configuracao.js";
import { acharSchema, ambienteDoPrisma, argumentosDaMigracao } from "./migrar.js";
import { esperarServidor, portaLivre, resumir } from "./verificacao.js";

/**
 * Linha de comando do instalador.
 *
 * É chamada pelo script NSIS em cinco momentos, **nesta ordem**: `preparar`
 * (pastas, segredos e configuração), `conferir` (as portas estão livres?),
 * `criar-banco`, `migrar` (tabelas) e `verificar` (o sistema respondeu?).
 *
 * A ordem importa: `preparar` roda **antes** do `initdb` porque é ele quem
 * escolhe a senha do banco e a deixa no arquivo que o `initdb` lê. Gerar a
 * senha depois produziria um `.env` que não abre o cluster recém-criado.
 *
 * Não decide nada — só lê argumentos e chama os módulos, que é onde estão os
 * testes. Sai com código diferente de zero quando falha, porque é assim que o
 * NSIS sabe interromper e mostrar uma mensagem em vez de dizer "concluído"
 * sobre um sistema que não sobe.
 */

function argumento(nome: string, padrao: string): string {
  const indice = process.argv.indexOf(`--${nome}`);

  return indice === -1 ? padrao : (process.argv[indice + 1] ?? padrao);
}

function caminhoDoEnv(raiz: string): string {
  return join(raiz, "servidor", ".env");
}

/**
 * Onde o serviço escreve.
 *
 * Fora de `Program Files`, por decisão registrada em `caminhos.ts`: é o token
 * restrito do `initdb` que obriga a isso.
 */
function caminhosDaInstalacao(): ReturnType<typeof caminhosDeDados> {
  return caminhosDeDados(argumento("dados", PASTA_DE_DADOS_PADRAO), path);
}

/**
 * Os segredos desta instalação.
 *
 * Preserva os de uma instalação anterior; só gera quando não há o que
 * preservar. Ver `lerSegredosDoEnv`.
 */
function segredosDaInstalacao(raiz: string): Segredos {
  const env = caminhoDoEnv(raiz);

  if (existsSync(env)) {
    const anteriores = lerSegredosDoEnv(readFileSync(env, "utf8"));

    if (anteriores !== undefined) return anteriores;
  }

  return gerarSegredos();
}

function preparar(): void {
  const raiz = argumento("raiz", process.cwd());
  const portaServidor = Number(argumento("porta", String(PORTA_SERVIDOR_PADRAO)));
  const portaPostgres = Number(
    argumento("porta-postgres", String(PORTA_POSTGRES_PADRAO)),
  );

  const caminhos = caminhosDaInstalacao();

  // O cluster **não** entra aqui: quem o cria é o `initdb`, e é preciso que o
  // token restrito dele seja o dono da pasta. Criá-la antes, com o instalador
  // elevado, é o que produz o "alterando permissões no diretório existente"
  // seguido de falha.
  for (const pasta of [caminhos.log, caminhos.backup]) {
    mkdirSync(pasta, { recursive: true });
  }

  const segredos = segredosDaInstalacao(raiz);

  const env = conteudoDoEnv({
    raiz,
    portaServidor,
    portaPostgres,
    segredos,
    estacao: hostname(),
  });

  // No `servidor/`, e não na raiz: é de lá que o processo sobe, e é lá que ele
  // procura o `.env`.
  writeFileSync(caminhoDoEnv(raiz), env, { mode: 0o600 });

  // O `initdb` lê a senha daqui — ele não a aceita por argumento, de propósito:
  // argumento aparece na lista de processos da máquina. O NSIS apaga o arquivo
  // assim que o `initdb` termina.
  writeFileSync(caminhos.senhaInicial, segredos.senhaBanco, { mode: 0o600 });
}

/**
 * Roda um binário do PostgreSQL embarcado.
 *
 * A senha vai por `PGPASSWORD` no ambiente do filho, e não na linha de comando,
 * porque a linha de comando é legível por qualquer processo da máquina.
 */
function executarPostgres(
  raiz: string,
  binario: string,
  argumentos: readonly string[],
  senha: string,
): string {
  return execFileSync(join(raiz, "postgres", "bin", binario), [...argumentos], {
    env: { ...process.env, PGPASSWORD: senha },
    encoding: "utf8",
  });
}

function segredosGravados(raiz: string): Segredos {
  const segredos = lerSegredosDoEnv(readFileSync(caminhoDoEnv(raiz), "utf8"));

  if (segredos === undefined) {
    throw new Error(
      "A configuração do servidor está incompleta. Rode o passo `preparar` antes.",
    );
  }

  return segredos;
}

function criarBanco(): void {
  const raiz = argumento("raiz", process.cwd());
  const porta = Number(argumento("porta-postgres", String(PORTA_POSTGRES_PADRAO)));
  const senha = segredosGravados(raiz).senhaBanco;

  const consulta = executarPostgres(
    raiz,
    "psql.exe",
    argumentosDaConsultaDeBanco(porta),
    senha,
  );

  if (bancoExiste(consulta)) {
    process.stdout.write("O banco já existe; mantido como está.\n");
    return;
  }

  executarPostgres(raiz, "createdb.exe", argumentosDoCreatedb(porta), senha);
}

function migrar(): void {
  const raiz = argumento("raiz", process.cwd());
  const aqui = fileURLToPath(new URL(".", import.meta.url));

  const schema = acharSchema(
    [
      join(raiz, "servidor", "prisma", "schema.prisma"),
      fileURLToPath(
        new URL("../../../packages/database/prisma/schema.prisma", import.meta.url),
      ),
    ],
    existsSync,
  );

  const cli = join(aqui, "node_modules", "prisma", "build", "index.js");
  const motor = join(aqui, "engines", "schema-engine-windows.exe");

  execFileSync(process.execPath, [...argumentosDaMigracao(cli, schema)], {
    cwd: join(raiz, "servidor"),
    env: ambienteDoPrisma(process.env, motor, existsSync),
    stdio: "inherit",
  });
}

/**
 * Confere as portas **antes** de registrar os serviços.
 *
 * Sem este passo, uma porta ocupada por outro programa só apareceria no fim,
 * como "o sistema não respondeu" — e o técnico, que já instalou tudo, não teria
 * como saber que o problema é um conflito de porta e não a instalação.
 *
 * Roda depois de copiar os arquivos porque é o `node.exe` embarcado que o
 * executa: antes da cópia, ele ainda não existe na máquina.
 */
async function conferir(): Promise<void> {
  const portaServidor = Number(argumento("porta", String(PORTA_SERVIDOR_PADRAO)));
  const portaPostgres = Number(
    argumento("porta-postgres", String(PORTA_POSTGRES_PADRAO)),
  );

  const resumo = resumir(
    await Promise.all([
      portaLivre(portaServidor, tentarEscutar),
      portaLivre(portaPostgres, tentarEscutar),
    ]),
  );

  if (!resumo.tudoCerto) {
    for (const problema of resumo.problemas) process.stderr.write(`${problema}\n`);

    process.exitCode = 1;
  }
}

/** Abrir e fechar é a única forma honesta de saber se a porta aceita escuta. */
async function tentarEscutar(porta: number): Promise<boolean> {
  const { createServer } = await import("node:net");

  return new Promise((resolver) => {
    const servidor = createServer();

    servidor.once("error", () => {
      resolver(false);
    });
    servidor.once("listening", () => {
      servidor.close(() => {
        resolver(true);
      });
    });
    servidor.listen(porta, "127.0.0.1");
  });
}

async function verificar(): Promise<void> {
  const porta = argumento("porta", String(PORTA_SERVIDOR_PADRAO));

  const resultado = await esperarServidor(`http://localhost:${porta}/saude`, {
    buscar: async (url) => fetch(url),
    agora: () => Date.now(),
    esperar: async (ms) => new Promise((pronto) => setTimeout(pronto, ms)),
  });

  const resumo = resumir([resultado]);

  if (!resumo.tudoCerto) {
    for (const problema of resumo.problemas) process.stderr.write(`${problema}\n`);

    process.exitCode = 1;
    return;
  }

  process.stdout.write("Sistema respondeu. Instalação concluída.\n");
}

const comando = process.argv[2];

try {
  if (comando === "preparar") preparar();
  else if (comando === "conferir") await conferir();
  else if (comando === "criar-banco") criarBanco();
  else if (comando === "migrar") migrar();
  else if (comando === "verificar") await verificar();
  else {
    process.stderr.write(
      "Uso: instalador <preparar|conferir|criar-banco|migrar|verificar>\n",
    );
    process.exitCode = 2;
  }
} catch (causa) {
  process.stderr.write(`${causa instanceof Error ? causa.message : String(causa)}\n`);
  process.exitCode = 1;
}
