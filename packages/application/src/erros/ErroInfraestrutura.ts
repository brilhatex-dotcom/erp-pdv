import { DomainError } from "@erp/domain";

/**
 * Falha de infraestrutura: banco fora, disco cheio, transação abortada.
 *
 * Diferente dos erros de negócio, **não é culpa do operador e ele não pode
 * resolver**. A mensagem reflete isso: diz o que fazer (tentar de novo, chamar
 * o suporte) em vez de descrever o problema técnico, que fica em `detalhes`
 * para o log.
 */
export class ErroInfraestrutura extends DomainError {
  readonly tipo = "CONFLITO" as const;

  constructor(
    readonly codigo: string,
    mensagem = "Não foi possível concluir a operação. Tente novamente.",
    detalhes?: Readonly<Record<string, unknown>>,
  ) {
    super(mensagem, detalhes);
  }

  /** Constrói a partir de uma exceção capturada na fronteira. */
  static de(causa: unknown, codigo = "FALHA_INFRAESTRUTURA"): ErroInfraestrutura {
    return new ErroInfraestrutura(codigo, undefined, {
      causa: causa instanceof Error ? causa.message : String(causa),
    });
  }
}
