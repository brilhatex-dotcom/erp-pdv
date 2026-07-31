import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";

/**
 * Hash de uma credencial, como ele sai do algoritmo e entra no banco.
 *
 * O domínio **não calcula e não verifica** o hash: isso é infraestrutura, mora
 * atrás de uma porta, e o algoritmo será trocado um dia (o Argon2id de hoje não
 * é o de 2035). O que o domínio faz é carregar o valor com um tipo próprio, para
 * que "senha em claro" e "hash de senha" nunca sejam confundidos por serem os
 * dois `string` — confusão que, quando acontece, grava a senha em claro no banco
 * e ninguém percebe até o vazamento.
 *
 * Ele também se recusa a aparecer em log. Hash não é reversível, mas é material
 * para ataque de dicionário offline, e log vai para o pacote de diagnóstico que
 * o cliente manda ao suporte (ARQUITETURA.md §7.6).
 */

const MASCARA = "[hash oculto]";

export class HashCredencial {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<HashCredencial, ErroValidacao> {
    if (valor.trim() === "") {
      return err(
        new ErroValidacao("HASH_VAZIO", "Credencial não definida.", {
          motivo: "hash vazio",
        }),
      );
    }

    return ok(new HashCredencial(valor));
  }

  /** O hash. Único chamador legítimo é o adapter que o verifica ou o grava. */
  revelar(): string {
    return this.#valor;
  }

  toString(): string {
    return MASCARA;
  }

  toJSON(): string {
    return MASCARA;
  }
}
