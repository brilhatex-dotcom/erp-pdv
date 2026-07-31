/**
 * Erro de negócio previsível.
 *
 * Não estende `Error`: um `DomainError` não é lançado, é **retornado** dentro de
 * um `Result` (princípio 7 do CLAUDE.md). Estender `Error` convidaria ao `throw`
 * e ainda pagaria o custo de montar stack trace num caminho que é fluxo normal.
 *
 * **A `mensagem` é escrita para o operador de caixa, não para o desenvolvedor.**
 * O CLAUDE.md §9 proíbe exibir erro técnico a quem está no balcão; garantir isso
 * no tipo é mais confiável do que confiar na revisão de cada tela. Contexto
 * técnico vai em `detalhes`, que só vai para o log.
 */
export abstract class DomainError {
  /** Código estável, usado em log, métrica e teste. Nunca exibido ao operador. */
  abstract readonly codigo: string;

  /** Categoria, para o adapter HTTP escolher o status sem conhecer cada erro. */
  abstract readonly tipo: TipoErro;

  constructor(
    /** Mensagem compreensível por leigo, exibível direto na tela. */
    readonly mensagem: string,
    /** Contexto técnico para diagnóstico remoto. Nunca exibido. */
    readonly detalhes?: Readonly<Record<string, unknown>>,
  ) {}

  toString(): string {
    return `${this.codigo}: ${this.mensagem}`;
  }
}

export type TipoErro =
  "VALIDACAO" | "REGRA_NEGOCIO" | "NAO_ENCONTRADO" | "CONFLITO" | "NAO_AUTORIZADO";

/** Entrada malformada: documento inválido, valor negativo, campo obrigatório. */
export class ErroValidacao extends DomainError {
  readonly tipo = "VALIDACAO" as const;

  constructor(
    readonly codigo: string,
    mensagem: string,
    detalhes?: Readonly<Record<string, unknown>>,
  ) {
    super(mensagem, detalhes);
  }
}

/** Entrada válida, mas a operação viola uma regra: estoque insuficiente, caixa fechado. */
export class ErroRegraNegocio extends DomainError {
  readonly tipo = "REGRA_NEGOCIO" as const;

  constructor(
    readonly codigo: string,
    mensagem: string,
    detalhes?: Readonly<Record<string, unknown>>,
  ) {
    super(mensagem, detalhes);
  }
}

/** Recurso referenciado não existe. */
export class ErroNaoEncontrado extends DomainError {
  readonly tipo = "NAO_ENCONTRADO" as const;

  constructor(
    readonly codigo: string,
    mensagem: string,
    detalhes?: Readonly<Record<string, unknown>>,
  ) {
    super(mensagem, detalhes);
  }
}

/** Conflito de estado: já existe, foi alterado por outro, sessão duplicada. */
export class ErroConflito extends DomainError {
  readonly tipo = "CONFLITO" as const;

  constructor(
    readonly codigo: string,
    mensagem: string,
    detalhes?: Readonly<Record<string, unknown>>,
  ) {
    super(mensagem, detalhes);
  }
}

/** Operação exige permissão que o usuário não possui. */
export class ErroNaoAutorizado extends DomainError {
  readonly tipo = "NAO_AUTORIZADO" as const;

  constructor(
    readonly codigo: string,
    mensagem: string,
    detalhes?: Readonly<Record<string, unknown>>,
  ) {
    super(mensagem, detalhes);
  }
}
