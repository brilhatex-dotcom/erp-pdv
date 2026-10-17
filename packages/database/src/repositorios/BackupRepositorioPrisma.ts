import type {
  BackupRepository,
  ConfiguracaoDeBackup,
  ExecucaoDeBackup,
  OperacaoDeBackup,
  OrigemDaCopia,
  SituacaoDaExecucao,
} from "@erp/application";
import type { Identificador } from "@erp/domain";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import { paraId, paraIdOpcional } from "../mapeadores/comuns.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

/**
 * A origem como o banco a guarda.
 *
 * O vocabulário da tabela nasceu antes do da aplicação ("agendado" é a cópia
 * automática), e mudar os valores gravados exigiria migração com reescrita de
 * linhas por nada: a tradução mora aqui, num lugar só.
 */
const ORIGEM_NO_BANCO: Readonly<Record<OrigemDaCopia, string>> = {
  AUTOMATICA: "AGENDADO",
  MANUAL: "MANUAL",
  FECHAMENTO_DE_CAIXA: "FECHAMENTO",
  ANTES_DE_RESTAURAR: "RESTAURACAO",
};

const ORIGENS: readonly OrigemDaCopia[] = [
  "AUTOMATICA",
  "MANUAL",
  "FECHAMENTO_DE_CAIXA",
  "ANTES_DE_RESTAURAR",
];

const ORIGEM_NA_APLICACAO: ReadonlyMap<string, OrigemDaCopia> = new Map(
  ORIGENS.map((origem) => [ORIGEM_NO_BANCO[origem], origem]),
);

/**
 * A agenda e o registro das tentativas.
 *
 * A agenda é **uma linha** (`unica`), como a configuração da loja (ADR-0024).
 * As tentativas são gravadas no começo e regravadas no fim, pelo mesmo id: é o
 * que deixa uma cópia interrompida no meio visível como "em andamento" — e não
 * sumida.
 */
export class BackupRepositorioPrisma implements BackupRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async configuracao(): Promise<ConfiguracaoDeBackup | undefined> {
    const linha = await this.prisma.configuracaoBackup.findUnique({
      where: { unica: true },
    });

    return linha === null
      ? undefined
      : {
          intervaloHoras: linha.intervaloHoras,
          aoFecharCaixa: linha.aoFecharCaixa,
          copiasRecentes: linha.manterUltimos,
        };
  }

  async salvarConfiguracao(
    configuracao: ConfiguracaoDeBackup,
    idSeNova: Identificador,
  ): Promise<void> {
    const dados = {
      intervaloHoras: configuracao.intervaloHoras,
      aoFecharCaixa: configuracao.aoFecharCaixa,
      manterUltimos: configuracao.copiasRecentes,
    };

    await this.prisma.configuracaoBackup.upsert({
      where: { unica: true },
      create: { id: idSeNova.valor, ...dados },
      update: dados,
    });
  }

  async registrarExecucao(execucao: ExecucaoDeBackup): Promise<void> {
    const dados = {
      operacao: execucao.operacao,
      origem: ORIGEM_NO_BANCO[execucao.origem],
      situacao: execucao.situacao,
      arquivo: execucao.arquivo ?? null,
      bytes: execucao.tamanhoBytes === undefined ? null : BigInt(execucao.tamanhoBytes),
      hash: execucao.sha256 ?? null,
      erro: execucao.erro ?? null,
      usuarioId: execucao.usuarioId?.valor ?? null,
      iniciadaEm: execucao.iniciadaEm,
      concluidaEm: execucao.concluidaEm ?? null,
    };

    await this.prisma.execucaoBackup.upsert({
      where: { id: execucao.id.valor },
      create: { id: execucao.id.valor, ...dados },
      update: dados,
    });
  }

  async ultimasExecucoes(
    limite: number,
    operacao?: OperacaoDeBackup,
  ): Promise<readonly ExecucaoDeBackup[]> {
    const linhas = await this.prisma.execucaoBackup.findMany({
      where: operacao === undefined ? {} : { operacao },
      // Desempate pelo id (UUIDv7): duas tentativas no mesmo milissegundo
      // voltariam na ordem do plano de execução.
      orderBy: [{ iniciadaEm: "desc" }, { id: "desc" }],
      take: limite,
    });

    return linhas.map(paraExecucao);
  }
}

function paraExecucao(linha: {
  readonly id: string;
  readonly operacao: string;
  readonly origem: string;
  readonly situacao: string;
  readonly arquivo: string | null;
  readonly bytes: bigint | null;
  readonly hash: string | null;
  readonly erro: string | null;
  readonly usuarioId: string | null;
  readonly iniciadaEm: Date;
  readonly concluidaEm: Date | null;
}): ExecucaoDeBackup {
  const origem = ORIGEM_NA_APLICACAO.get(linha.origem);

  /* v8 ignore next 3 -- defesa: os CHECKs da tabela já recusam valor desconhecido */
  if (
    origem === undefined ||
    !ehOperacao(linha.operacao) ||
    !ehSituacao(linha.situacao)
  ) {
    throw new Error(`Tentativa de backup com valor desconhecido no banco: ${linha.id}`);
  }

  return {
    id: paraId(linha.id),
    operacao: linha.operacao,
    origem,
    situacao: linha.situacao,
    iniciadaEm: linha.iniciadaEm,
    concluidaEm: linha.concluidaEm ?? undefined,
    arquivo: linha.arquivo ?? undefined,
    tamanhoBytes: linha.bytes === null ? undefined : Number(linha.bytes),
    sha256: linha.hash ?? undefined,
    erro: linha.erro ?? undefined,
    usuarioId: paraIdOpcional(linha.usuarioId),
  };
}

function ehOperacao(valor: string): valor is OperacaoDeBackup {
  return valor === "BACKUP" || valor === "RESTAURACAO";
}

function ehSituacao(valor: string): valor is SituacaoDaExecucao {
  return valor === "EM_ANDAMENTO" || valor === "CONCLUIDO" || valor === "FALHOU";
}
