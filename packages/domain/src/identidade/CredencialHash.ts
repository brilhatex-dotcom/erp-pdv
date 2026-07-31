import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/**
 * Hash de uma credencial — é isto que o banco guarda.
 *
 * O domínio **não calcula nem confere** o hash: Argon2id é infraestrutura, e
 * conhecê-lo aqui quebraria o princípio 2. O que o domínio garante é mais
 * simples e mais importante: que um hash existe, que não está vazio, e que
 * nenhum caminho do código consegue tratar uma senha em claro como se fosse um
 * hash guardado.
 *
 * Guardar o **algoritmo** junto do valor é o que torna a troca possível sem
 * derrubar ninguém: quando o Argon2id for substituído, os hashes antigos
 * continuam identificáveis e são recalculados no próximo login bem-sucedido.
 * Sem esse campo, migrar hash significa forçar toda a loja a trocar de senha
 * no mesmo dia.
 */
export class CredencialHash implements ValueObject<CredencialHash> {
  readonly #valor: string;
  readonly #algoritmo: string;

  private constructor(valor: string, algoritmo: string) {
    this.#valor = valor;
    this.#algoritmo = algoritmo;
  }

  static criar(valor: string, algoritmo: string): Result<CredencialHash, ErroValidacao> {
    if (valor.trim() === "") {
      return err(
        new ErroValidacao("CREDENCIAL_HASH_VAZIO", "Credencial inválida.", { algoritmo }),
      );
    }

    if (algoritmo.trim() === "") {
      return err(
        new ErroValidacao(
          "CREDENCIAL_ALGORITMO_VAZIO",
          "Credencial inválida.",
          // O valor jamais entra nos detalhes: eles vão para o log.
          { motivo: "algoritmo não informado" },
        ),
      );
    }

    return ok(new CredencialHash(valor.trim(), algoritmo.trim()));
  }

  get valor(): string {
    return this.#valor;
  }

  get algoritmo(): string {
    return this.#algoritmo;
  }

  /** Indica que o hash foi gerado por algoritmo diferente do vigente. */
  precisaRecalcular(algoritmoVigente: string): boolean {
    return this.#algoritmo !== algoritmoVigente;
  }

  equals(outro: CredencialHash): boolean {
    return this.#valor === outro.#valor && this.#algoritmo === outro.#algoritmo;
  }
}
