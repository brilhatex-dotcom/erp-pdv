import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import {
  conteudoDoEnv,
  gerarSegredos,
  PORTA_POSTGRES_PADRAO,
  PORTA_SERVIDOR_PADRAO,
} from "./configuracao.js";
import { esperarServidor, resumir } from "./verificacao.js";

/**
 * Linha de comando do instalador.
 *
 * É chamada pelo script NSIS em três momentos: `preparar` (pastas, segredos e
 * configuração), `migrar` (tabelas) e `verificar` (o sistema respondeu?).
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

function preparar(): void {
  const raiz = argumento("raiz", process.cwd());
  const portaServidor = Number(argumento("porta", String(PORTA_SERVIDOR_PADRAO)));
  const portaPostgres = Number(
    argumento("porta-postgres", String(PORTA_POSTGRES_PADRAO)),
  );

  for (const pasta of ["log", "backup", "telas"]) {
    mkdirSync(join(raiz, pasta), { recursive: true });
  }

  const env = conteudoDoEnv({
    raiz,
    portaServidor,
    portaPostgres,
    segredos: gerarSegredos(),
    estacao: hostname(),
  });

  // No `servidor/`, e não na raiz: é de lá que o processo sobe, e é lá que ele
  // procura o `.env`.
  writeFileSync(join(raiz, "servidor", ".env"), env, { mode: 0o600 });
}

function migrar(): void {
  const raiz = argumento("raiz", process.cwd());

  execFileSync(join(raiz, "node", "node.exe"), [join(raiz, "servidor", "migrar.js")], {
    cwd: join(raiz, "servidor"),
    stdio: "inherit",
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
  else if (comando === "migrar") migrar();
  else if (comando === "verificar") await verificar();
  else {
    process.stderr.write("Uso: instalador <preparar|migrar|verificar>\n");
    process.exitCode = 2;
  }
} catch (causa) {
  process.stderr.write(`${causa instanceof Error ? causa.message : String(causa)}\n`);
  process.exitCode = 1;
}
