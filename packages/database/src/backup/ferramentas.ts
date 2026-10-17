import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * Como chamar `pg_dump`, `pg_restore` e `psql`.
 *
 * As ferramentas do próprio PostgreSQL, e não uma biblioteca: são as que vêm
 * no instalador junto com o servidor, na mesma versão dele (ADR-0013), e as
 * que o suporte usaria à mão — a cópia feita pelo sistema é a mesma que um
 * técnico faria, e restaura com as mesmas ferramentas.
 */

/** Falha de uma ferramenta, com o que ela escreveu no erro — o detalhe do suporte. */
export class FalhaDeFerramenta extends Error {
  constructor(
    readonly programa: string,
    mensagem: string,
    readonly saidaDeErro: string,
  ) {
    super(mensagem);
    this.name = "FalhaDeFerramenta";
  }
}

export interface Conexao {
  /** O banco da loja. */
  readonly banco: string;
  /** `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`… */
  readonly variaveis: Readonly<Record<string, string>>;
}

/**
 * Os dados de conexão do endereço do banco, em variáveis de ambiente.
 *
 * Variável, e não argumento: o argumento aparece na lista de processos para
 * qualquer usuário da máquina, e a senha do banco iria junto.
 */
export function conexaoDe(url: string): Conexao {
  const endereco = new URL(url);
  const parametros = endereco.searchParams;

  const variaveis: Record<string, string> = {
    // `[::1]` vem com colchetes na URL, e o libpq não os aceita.
    PGHOST: parametros.get("host") ?? endereco.hostname.replace(/^\[(.*)\]$/, "$1"),
    PGPORT: endereco.port === "" ? "5432" : endereco.port,
    PGUSER: decodeURIComponent(endereco.username),
  };

  if (endereco.password !== "") {
    variaveis["PGPASSWORD"] = decodeURIComponent(endereco.password);
  }

  const sslmode = parametros.get("sslmode");
  if (sslmode !== null) variaveis["PGSSLMODE"] = sslmode;

  return {
    banco: decodeURIComponent(endereco.pathname.replace(/^\//, "")),
    variaveis,
  };
}

/** O caminho do programa: na pasta das ferramentas, ou o do PATH. */
export function programa(
  nome: "pg_dump" | "pg_restore" | "psql",
  pastaBinarios: string | undefined,
  plataforma: NodeJS.Platform = process.platform,
): string {
  const arquivo = plataforma === "win32" ? `${nome}.exe` : nome;

  return pastaBinarios === undefined ? arquivo : join(pastaBinarios, arquivo);
}

export interface OpcoesDeExecucao {
  readonly variaveis: Readonly<Record<string, string>>;
  readonly tempoLimiteMs: number;
}

/** Roda a ferramenta e devolve o que ela escreveu na saída. */
export function executar(
  caminho: string,
  argumentos: readonly string[],
  opcoes: OpcoesDeExecucao,
): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    execFile(
      caminho,
      argumentos,
      {
        env: {
          ...process.env,
          ...opcoes.variaveis,
          // Aparece em `pg_stat_activity`: o suporte vê quem está conectado.
          PGAPPNAME: "erp-copia-de-seguranca",
          PGCONNECT_TIMEOUT: "10",
        },
        timeout: opcoes.tempoLimiteMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
      },
      (erro, saida, saidaDeErro) => {
        if (erro === null) {
          resolver(saida);
          return;
        }

        rejeitar(new FalhaDeFerramenta(caminho, erro.message, saidaDeErro));
      },
    );
  });
}

/** Tamanho do detalhe guardado: o fim da saída de erro é onde está a causa. */
const TAMANHO_DO_DETALHE = 400;

/** A frase técnica que vai para o suporte. */
export function detalheDe(causa: unknown): string {
  const texto =
    causa instanceof FalhaDeFerramenta && causa.saidaDeErro.trim() !== ""
      ? causa.saidaDeErro.trim()
      : causa instanceof Error
        ? causa.message
        : String(causa);

  return texto.length > TAMANHO_DO_DETALHE
    ? `…${texto.slice(-TAMANHO_DO_DETALHE)}`
    : texto;
}
