import type { CredencialHash } from "@erp/domain";

/**
 * Cálculo e conferência de hash de credencial.
 *
 * É porta, e não função importada no domínio, por dois motivos que se somam:
 * Argon2id é biblioteca nativa (infraestrutura, princípio 2), e o custo dele é
 * **deliberadamente alto** — um domínio que o chamasse direto teria seus testes
 * medidos em segundos.
 */
export interface Hasher {
  /** Identifica o algoritmo vigente, para saber qual hash já ficou para trás. */
  readonly algoritmo: string;

  hash(textoEmClaro: string): Promise<CredencialHash>;

  confere(textoEmClaro: string, hash: CredencialHash): Promise<boolean>;

  /**
   * Gasta o mesmo tempo de uma conferência real, sem conferir nada.
   *
   * Existe para o login de matrícula inexistente. Sem ela, responder rápido
   * quando o usuário não existe e devagar quando existe transforma o tempo de
   * resposta num oráculo que diz quais matrículas estão cadastradas — e a
   * primeira coisa que se faz com essa lista é atacar os PINs delas.
   */
  gastarTempoEquivalente(): Promise<void>;
}
