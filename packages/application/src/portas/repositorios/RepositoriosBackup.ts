import type { Identificador } from "@erp/domain";

/**
 * A agenda das cópias de segurança e o registro de cada tentativa.
 *
 * As cópias moram na pasta, e não no banco — o banco é justamente o que a
 * restauração troca. Aqui fica o que a loja escolheu (de quanto em quanto tempo
 * copiar) e o histórico das tentativas, inclusive das que falharam sem deixar
 * arquivo: é por ele que o suporte descobre, de longe, que o `pg_dump` não roda
 * há uma semana.
 */

/** Por que a cópia foi feita. Aparece na lista e na auditoria. */
export type OrigemDaCopia =
  "AUTOMATICA" | "MANUAL" | "FECHAMENTO_DE_CAIXA" | "ANTES_DE_RESTAURAR";

export interface ConfiguracaoDeBackup {
  /** De quantas em quantas horas sai a cópia automática. */
  readonly intervaloHoras: number;
  /** Uma cópia logo depois de cada fechamento de caixa. */
  readonly aoFecharCaixa: boolean;
  /**
   * Quantas cópias recentes ficam: a escala mais fina da retenção.
   *
   * Não aparece na tela. É o ajuste do suporte para a loja cujo banco já pesa
   * no disco — o lojista não tem como saber o número certo, e um número errado
   * escolhido por ele só aparece quando a cópia de que ele precisa já saiu.
   */
  readonly copiasRecentes: number;
}

export type OperacaoDeBackup = "BACKUP" | "RESTAURACAO";

export type SituacaoDaExecucao = "EM_ANDAMENTO" | "CONCLUIDO" | "FALHOU";

export interface ExecucaoDeBackup {
  readonly id: Identificador;
  readonly operacao: OperacaoDeBackup;
  /** Na restauração, sempre `MANUAL`: só uma pessoa restaura. */
  readonly origem: OrigemDaCopia;
  readonly situacao: SituacaoDaExecucao;
  readonly iniciadaEm: Date;
  readonly concluidaEm?: Date | undefined;
  /** A cópia feita, ou a restaurada. */
  readonly arquivo?: string | undefined;
  readonly tamanhoBytes?: number | undefined;
  readonly sha256?: string | undefined;
  /** O que deu errado, na frase que a tela mostra. */
  readonly erro?: string | undefined;
  readonly usuarioId?: Identificador | undefined;
}

export interface BackupRepository {
  /** A agenda escolhida; `undefined` enquanto ninguém mexeu nela. */
  configuracao(): Promise<ConfiguracaoDeBackup | undefined>;
  /**
   * Grava a agenda por cima da que existe.
   *
   * `idSeNova` identifica a linha quando ela ainda não existe: o identificador
   * nasce na aplicação, como todos os outros (ADR-0008).
   */
  salvarConfiguracao(
    configuracao: ConfiguracaoDeBackup,
    idSeNova: Identificador,
  ): Promise<void>;
  /** Grava a tentativa — ou atualiza a mesma, quando ela termina. */
  registrarExecucao(execucao: ExecucaoDeBackup): Promise<void>;
  /** As tentativas mais recentes, da mais nova para a mais antiga. */
  ultimasExecucoes(
    limite: number,
    operacao?: OperacaoDeBackup,
  ): Promise<readonly ExecucaoDeBackup[]>;
}
