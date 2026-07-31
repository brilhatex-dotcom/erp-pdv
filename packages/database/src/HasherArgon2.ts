import { hash, verify } from "@node-rs/argon2";
import type { Hasher } from "@erp/application";
import { CredencialHash } from "@erp/domain";

export const ALGORITMO_ARGON2ID = "argon2id";

/**
 * Parâmetros do Argon2id.
 *
 * Os valores seguem a recomendação do OWASP (19 MiB, 2 iterações, 1 thread) e
 * são calibrados para o hardware real do produto: o servidor de uma loja é um
 * computador de escritório, muitas vezes o **mesmo** que roda um PDV. Parâmetros
 * mais pesados dariam mais margem de segurança e roubariam CPU de quem está
 * vendendo — e o princípio 1 diz que o PDV não para.
 *
 * `memoryCost` é o que realmente dói para quem ataca com GPU, e é por isso que
 * ele é alto enquanto `timeCost` é baixo.
 */
const PARAMETROS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hasher de produção — o **único** lugar do sistema que conhece Argon2id.
 *
 * Trocar de algoritmo é substituir esta classe. Os hashes antigos continuam
 * legíveis porque `CredencialHash` guarda qual algoritmo os gerou, e são
 * recalculados no próximo login bem-sucedido.
 */
export class HasherArgon2 implements Hasher {
  readonly algoritmo = ALGORITMO_ARGON2ID;

  async hash(textoEmClaro: string): Promise<CredencialHash> {
    const digest = await hash(textoEmClaro, PARAMETROS);

    // O digest do Argon2 nunca é vazio; `unwrap` não tem ramo alcançável.
    return CredencialHash.criar(digest, this.algoritmo).unwrap();
  }

  async confere(textoEmClaro: string, credencial: CredencialHash): Promise<boolean> {
    try {
      return await verify(credencial.valor, textoEmClaro, PARAMETROS);
    } catch {
      // Hash malformado no banco. Devolver `false` em vez de propagar mantém a
      // resposta indistinguível de uma credencial errada — um erro diferente
      // aqui diria ao atacante que encontrou algo digno de atenção.
      return false;
    }
  }

  /**
   * Gasta o mesmo tempo de uma conferência real, sem conferir nada.
   *
   * Chamado quando a matrícula não existe. Sem isso, responder rápido para
   * quem não existe e devagar para quem existe transforma o tempo de resposta
   * num oráculo que revela quais matrículas estão cadastradas.
   *
   * O hash é calculado de verdade — não é um `sleep`. Um atraso fixo seria
   * distinguível: o Argon2 real varia alguns milissegundos conforme a carga da
   * máquina, e um valor constante destoaria justamente sob medição.
   */
  async gastarTempoEquivalente(): Promise<void> {
    await hash("credencial-inexistente", PARAMETROS);
  }
}
