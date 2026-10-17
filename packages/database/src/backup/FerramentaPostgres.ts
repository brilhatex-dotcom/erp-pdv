import {
  type ArquivoGerado,
  ErroInfraestrutura,
  type FerramentaDeBackup,
  formatarTamanho,
  type ProvaDaCopia,
  type ResumoDoBanco,
} from "@erp/application";
import { type DomainError, err, ok, type Result } from "@erp/domain";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { resumirArquivo } from "./arquivo.js";
import { type Conexao, conexaoDe, detalheDe, executar, programa } from "./ferramentas.js";

export interface OpcoesFerramentaPostgres {
  /** O banco da loja — o mesmo endereço que o servidor usa. */
  readonly urlBanco: string;
  /** Onde estão `pg_dump`, `pg_restore` e `psql`; ausente, os do PATH. */
  readonly pastaBinarios?: string | undefined;
  /**
   * Onde o arquivo nasce, antes de ir para a pasta das cópias.
   *
   * Dentro da própria pasta das cópias: assim a mudança de lugar é um
   * `rename`, instantâneo — e não uma segunda cópia de centenas de megabytes
   * entre discos.
   */
  readonly pastaDeTrabalho: string;
  /**
   * O espaço livre que precisa sobrar para a cópia começar.
   *
   * O banco e as cópias dividem o disco: a cópia que enche o disco para o
   * banco, e o banco parado para o caixa. Melhor não copiar e avisar.
   */
  readonly reservaMinimaBytes?: number | undefined;
  /** Quanto o `pg_dump` e o `pg_restore` podem demorar. */
  readonly tempoLimiteMs?: number | undefined;
}

const RESERVA_PADRAO_BYTES = 1024 * 1024 * 1024;
const TEMPO_LIMITE_PADRAO_MS = 30 * 60_000;
/** O `psql` só cria, apaga e conta: se demorar isso, alguma coisa travou. */
const TEMPO_LIMITE_DO_PSQL_MS = 2 * 60_000;

/**
 * As bases descartáveis da prova: `erp_prova_<segundos>_<processo>_<sorteio>`.
 *
 * O processo no nome diz ao suporte qual servidor deixou uma base para trás.
 */
const PREFIXO_DA_PROVA = "erp_prova_";
/** A base de prova mais velha que isso foi esquecida por um servidor que caiu. */
const PROVA_ESQUECIDA_MS = 60 * 60_000;
/**
 * O formato exato de uma base de prova, com os segundos à parte.
 *
 * O nome vem de `pg_database` e vai entre aspas num `DROP DATABASE`: um nome
 * com aspas viraria SQL. Só sai o que tem a cara do que este sistema cria.
 */
const BASE_DE_PROVA = /^erp_prova_(\d+)_[A-Za-z0-9_]+$/;

/**
 * A cópia de segurança pelas ferramentas do PostgreSQL.
 *
 * - **Gerar**: `pg_dump` no formato próprio, que é consistente (uma fotografia
 *   do banco, sem parar as vendas) e já sai comprimido.
 * - **Provar**: `pg_restore` numa base descartável, criada e apagada na hora.
 *   Só a restauração prova a cópia (ARQUITETURA.md §10.4).
 * - **Restaurar**: `pg_restore --clean` numa transação só. Ou o banco inteiro
 *   vira o da cópia, ou nada muda — não existe banco pela metade.
 */
export class FerramentaPostgres implements FerramentaDeBackup {
  readonly #conexao: Conexao;
  readonly #pastaBinarios: string | undefined;
  readonly #pastaDeTrabalho: string;
  readonly #reservaMinimaBytes: number;
  readonly #tempoLimiteMs: number;

  constructor(opcoes: OpcoesFerramentaPostgres) {
    this.#conexao = conexaoDe(opcoes.urlBanco);
    this.#pastaBinarios = opcoes.pastaBinarios;
    this.#pastaDeTrabalho = opcoes.pastaDeTrabalho;
    this.#reservaMinimaBytes = opcoes.reservaMinimaBytes ?? RESERVA_PADRAO_BYTES;
    this.#tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
  }

  async gerar(): Promise<Result<ArquivoGerado, DomainError>> {
    await this.#limparPastaDeTrabalho();

    const disco = await statfs(this.#pastaDeTrabalho);
    const livre = disco.bavail * disco.bsize;

    if (livre < this.#reservaMinimaBytes) {
      return err(
        new ErroInfraestrutura(
          "POUCO_ESPACO_NO_DISCO",
          `O disco do servidor tem só ${formatarTamanho(livre)} livres, e a cópia precisa deixar pelo menos ${formatarTamanho(this.#reservaMinimaBytes)}. A cópia não foi feita para não encher o disco do banco: libere espaço ou chame o suporte.`,
          { livreBytes: livre },
        ),
      );
    }

    const caminho = join(
      this.#pastaDeTrabalho,
      `copia-${String(Date.now())}-${randomBytes(4).toString("hex")}.parcial`,
    );

    try {
      await this.#rodar("pg_dump", [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--file=${caminho}`,
        `--dbname=${this.#conexao.banco}`,
      ]);
    } catch (causa) {
      await rm(caminho, { force: true });

      return err(
        new ErroInfraestrutura(
          "BACKUP_FALHOU",
          "O banco não deixou fazer a cópia de segurança. Confira se o serviço do banco está ligado e chame o suporte.",
          { causa: detalheDe(causa) },
        ),
      );
    }

    const { tamanhoBytes, sha256 } = await resumirArquivo(caminho);

    return ok({ caminho, tamanhoBytes, sha256 });
  }

  async provar(caminho: string): Promise<ProvaDaCopia> {
    await this.#descartarProvasEsquecidas();

    const descartavel = `${PREFIXO_DA_PROVA}${String(Math.floor(Date.now() / 1000))}_${String(process.pid)}_${randomBytes(4).toString("hex")}`;

    try {
      // C e UTF-8 de propósito: a prova conta linhas, não ordena texto, e a
      // collation C existe em qualquer servidor — a da loja pode não existir
      // na máquina do suporte que confere a cópia.
      await this.#sql(
        "postgres",
        `CREATE DATABASE "${descartavel}" TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C'`,
      );
      await this.#rodar("pg_restore", [
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--single-transaction",
        `--dbname=${descartavel}`,
        caminho,
      ]);

      return { restaurou: true, resumo: await this.#resumir(descartavel) };
    } catch (causa) {
      return {
        restaurou: false,
        motivo: `o arquivo não restaurou (detalhe para o suporte: ${detalheDe(causa)})`,
      };
    } finally {
      await this.#apagarBase(descartavel);
    }
  }

  resumoAtual(): Promise<ResumoDoBanco> {
    return this.#resumir(this.#conexao.banco);
  }

  async restaurar(caminho: string): Promise<Result<void, DomainError>> {
    try {
      await this.#rodar("pg_restore", [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--single-transaction",
        `--dbname=${this.#conexao.banco}`,
        caminho,
      ]);

      return ok(undefined);
    } catch (causa) {
      return err(
        new ErroInfraestrutura(
          "RESTAURACAO_FALHOU",
          "A restauração não terminou, e o banco continua como estava. Chame o suporte.",
          { causa: detalheDe(causa) },
        ),
      );
    }
  }

  /** O que a conferência mostra: quantas vendas, de quando a quando, e a versão. */
  async #resumir(banco: string): Promise<ResumoDoBanco> {
    const saida = await this.#sql(banco, CONSULTA_DO_RESUMO);
    const lido = ESQUEMA_DO_RESUMO.parse(JSON.parse(saida));

    return {
      vendas: lido.vendas,
      produtos: lido.produtos,
      clientes: lido.clientes,
      primeiraVenda:
        lido.primeiraVenda === null ? undefined : new Date(lido.primeiraVenda),
      ultimaVenda: lido.ultimaVenda === null ? undefined : new Date(lido.ultimaVenda),
      caixasAbertos: lido.caixasAbertos,
      migracoes: lido.migracoes,
    };
  }

  /**
   * Um servidor que caiu no meio de uma prova deixa a base dela para trás —
   * com uma cópia inteira dos dados da loja. Ela sai na prova seguinte.
   *
   * Só as de mais de uma hora: uma prova mais nova pode ser de outro processo
   * no mesmo servidor de banco, ainda trabalhando.
   */
  async #descartarProvasEsquecidas(): Promise<void> {
    let saida: string;

    try {
      saida = await this.#sql(
        "postgres",
        `SELECT datname FROM pg_database WHERE starts_with(datname, '${PREFIXO_DA_PROVA}')`,
      );
    } catch {
      // Com o banco fora do ar, a própria prova vai dizer o que houve.
      return;
    }

    const limite = Date.now() - PROVA_ESQUECIDA_MS;

    for (const nome of saida.split("\n")) {
      const segundos = BASE_DE_PROVA.exec(nome)?.[1];

      if (segundos !== undefined && Number(segundos) * 1000 < limite) {
        await this.#apagarBase(nome);
      }
    }
  }

  /** Apaga a base descartável. Falhar aqui não pode esconder o resultado da prova. */
  async #apagarBase(nome: string): Promise<void> {
    try {
      await this.#sql("postgres", `DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
    } catch {
      // Fica para a próxima prova, que apaga as esquecidas.
    }
  }

  /** Restos de uma cópia interrompida no meio: arquivo pela metade não serve. */
  async #limparPastaDeTrabalho(): Promise<void> {
    await mkdir(this.#pastaDeTrabalho, { recursive: true });

    for (const nome of await readdir(this.#pastaDeTrabalho)) {
      await rm(join(this.#pastaDeTrabalho, nome), { force: true, recursive: true });
    }
  }

  #rodar(nome: "pg_dump" | "pg_restore", argumentos: readonly string[]): Promise<string> {
    return executar(programa(nome, this.#pastaBinarios), argumentos, {
      variaveis: this.#conexao.variaveis,
      tempoLimiteMs: this.#tempoLimiteMs,
    });
  }

  async #sql(banco: string, comando: string): Promise<string> {
    const saida = await executar(
      programa("psql", this.#pastaBinarios),
      [
        "--no-psqlrc",
        "--quiet",
        "--no-align",
        "--tuples-only",
        "--set=ON_ERROR_STOP=1",
        `--dbname=${banco}`,
        `--command=${comando}`,
      ],
      { variaveis: this.#conexao.variaveis, tempoLimiteMs: TEMPO_LIMITE_DO_PSQL_MS },
    );

    return saida.trim();
  }
}

/**
 * Uma consulta só, que devolve JSON: nada de interpretar colunas de texto do
 * `psql`, que mudam de formato entre versões.
 *
 * Vendas são as finalizadas; o período conta também as canceladas depois, que
 * foram movimento de verdade naquele dia.
 */
const CONSULTA_DO_RESUMO = `
  SELECT json_build_object(
    'vendas', (SELECT count(*) FROM vendas WHERE status = 'FINALIZADA'),
    'produtos', (SELECT count(*) FROM produtos),
    'clientes', (SELECT count(*) FROM clientes),
    'primeiraVenda', (SELECT min(finalizada_em) FROM vendas),
    'ultimaVenda', (SELECT max(finalizada_em) FROM vendas),
    'caixasAbertos', (SELECT count(*) FROM sessoes_caixa WHERE status = 'ABERTA'),
    'migracoes', (
      SELECT coalesce(json_agg(migration_name ORDER BY migration_name), '[]'::json)
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    )
  )
`;

const ESQUEMA_DO_RESUMO = z.object({
  vendas: z.number().int().nonnegative(),
  produtos: z.number().int().nonnegative(),
  clientes: z.number().int().nonnegative(),
  primeiraVenda: z.string().nullable(),
  ultimaVenda: z.string().nullable(),
  caixasAbertos: z.number().int().nonnegative(),
  migracoes: z.array(z.string()),
});
