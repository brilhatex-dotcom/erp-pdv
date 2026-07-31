import { z } from "zod";

/**
 * Configuração do servidor, validada **antes** de qualquer conexão.
 *
 * Falhar aqui é o objetivo, não o efeito colateral. Uma variável ausente ou
 * malformada descoberta na primeira venda vira chamado de suporte às sete da
 * manhã com a loja abrindo; descoberta na inicialização vira uma linha de log
 * que diz exatamente o que corrigir. Por isso a mensagem lista **todos** os
 * problemas de uma vez: quem está instalando não deve descobrir o segundo
 * problema só depois de resolver o primeiro.
 */

const NIVEIS_LOG = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

export type NivelLog = (typeof NIVEIS_LOG)[number];

export type ModoExecucao = "development" | "test" | "production";

/** Endereço de escuta padrão: **somente esta máquina**. */
const ENDERECO_PADRAO = "127.0.0.1";

const FORMATO_PORTA = /^\d{1,5}$/;
const FORMATO_INTEIRO_POSITIVO = /^[1-9]\d{0,6}$/;
const FORMATO_URL_POSTGRES = /^postgres(?:ql)?:\/\/\S+$/;

const zTextoPorta = z
  .string()
  .regex(FORMATO_PORTA, "deve ser um número de porta entre 1 e 65535")
  .refine(
    (texto) => {
      const numero = Number(texto);
      return numero >= 1 && numero <= 65_535;
    },
    { message: "deve ser um número de porta entre 1 e 65535" },
  );

const zTextoInteiroPositivo = z
  .string()
  .regex(FORMATO_INTEIRO_POSITIVO, "deve ser um número inteiro positivo");

const zTextoBooleano = z.enum(["true", "false"]).describe("true ou false");

/**
 * As variáveis são lidas como **texto** e convertidas depois, num passo
 * separado. Misturar validação e conversão no mesmo schema torna o valor
 * padrão ambíguo — ele pertence ao texto de entrada ou ao número de saída? —
 * e essa ambiguidade já custou defeito em configuração antes.
 */
const zAmbienteBruto = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  SERVIDOR_ENDERECO: z.string().trim().min(1).default(ENDERECO_PADRAO),
  SERVIDOR_PORTA: zTextoPorta.default("3000"),

  DATABASE_URL: z
    .string()
    .regex(FORMATO_URL_POSTGRES, "deve ser uma URL de conexão do PostgreSQL"),

  NIVEL_LOG: z.enum(NIVEIS_LOG).default("info"),

  /** Registra cada consulta SQL. Só para diagnóstico: enche o disco da loja. */
  REGISTRAR_CONSULTAS_SQL: zTextoBooleano.default("false"),

  /**
   * Teto de requisições por minuto, por origem.
   *
   * O padrão é generoso de propósito. Um caixa em hora de pico faz poucas
   * dezenas de requisições por minuto; o limite existe contra laço infinito de
   * cliente com defeito e contra tentativa de força bruta em PIN, não contra o
   * operador. Limite apertado transformaria movimento intenso em venda
   * recusada, o que viola o princípio 1 do CLAUDE.md.
   */
  LIMITE_REQUISICOES_POR_MINUTO: zTextoInteiroPositivo.default("600"),

  /** Quanto esperar pelas requisições em curso antes de encerrar à força. */
  TEMPO_LIMITE_ENCERRAMENTO_MS: zTextoInteiroPositivo.default("10000"),
});

export interface Ambiente {
  readonly modo: ModoExecucao;
  readonly endereco: string;
  readonly porta: number;
  readonly urlBanco: string;
  readonly nivelLog: NivelLog;
  readonly registrarConsultasSql: boolean;
  readonly limiteRequisicoesPorMinuto: number;
  readonly tempoLimiteEncerramentoMs: number;
}

/** Configuração inválida. Não é erro de negócio: o servidor não deve subir. */
export class ErroConfiguracao extends Error {
  constructor(readonly problemas: readonly string[]) {
    super(
      [
        "Configuração do servidor inválida. Corrija as variáveis de ambiente:",
        ...problemas.map((problema) => `  - ${problema}`),
      ].join("\n"),
    );
    this.name = "ErroConfiguracao";
  }
}

export function carregarAmbiente(fonte: Record<string, string | undefined>): Ambiente {
  const analisado = zAmbienteBruto.safeParse(fonte);

  if (!analisado.success) {
    throw new ErroConfiguracao(
      analisado.error.issues.map((problema) => {
        const variavel = problema.path.join(".");
        return problema.code === "invalid_type"
          ? `${variavel} não foi informada`
          : `${variavel} ${problema.message}`;
      }),
    );
  }

  const bruto = analisado.data;

  return {
    modo: bruto.NODE_ENV,
    endereco: bruto.SERVIDOR_ENDERECO,
    porta: Number(bruto.SERVIDOR_PORTA),
    urlBanco: bruto.DATABASE_URL,
    nivelLog: bruto.NIVEL_LOG,
    registrarConsultasSql: bruto.REGISTRAR_CONSULTAS_SQL === "true",
    limiteRequisicoesPorMinuto: Number(bruto.LIMITE_REQUISICOES_POR_MINUTO),
    tempoLimiteEncerramentoMs: Number(bruto.TEMPO_LIMITE_ENCERRAMENTO_MS),
  };
}

/**
 * Versão da configuração segura para registrar em log.
 *
 * A URL do banco carrega a senha, e log vai para arquivo, para o pacote de
 * diagnóstico que o cliente envia ao suporte e, um dia, para telemetria.
 * Registrar a configuração inteira é como um segredo vaza sem que ninguém tenha
 * decidido vazá-lo (CLAUDE.md §9).
 */
export function descreverParaLog(ambiente: Ambiente): Record<string, unknown> {
  return {
    modo: ambiente.modo,
    endereco: ambiente.endereco,
    porta: ambiente.porta,
    banco: mascararUrl(ambiente.urlBanco),
    nivelLog: ambiente.nivelLog,
    registrarConsultasSql: ambiente.registrarConsultasSql,
    limiteRequisicoesPorMinuto: ambiente.limiteRequisicoesPorMinuto,
  };
}

/**
 * Remove a senha da URL, preservando o que serve ao diagnóstico: host, porta e
 * nome do banco — que é justamente o que se precisa saber quando a conexão
 * falha.
 */
function mascararUrl(url: string): string {
  const SEPARADOR = "://";
  const inicioCredencial = url.indexOf(SEPARADOR) + SEPARADOR.length;
  const fimCredencial = url.indexOf("@", inicioCredencial);

  // Sem `@` não há credencial embutida — é o caso da autenticação por
  // certificado e do socket local. Não há o que mascarar.
  if (fimCredencial === -1) {
    return url;
  }

  const credencial = url.slice(inicioCredencial, fimCredencial);
  const separadorSenha = credencial.indexOf(":");
  const usuario =
    separadorSenha === -1 ? credencial : credencial.slice(0, separadorSenha);

  return `${url.slice(0, inicioCredencial)}${usuario}:***${url.slice(fimCredencial)}`;
}
