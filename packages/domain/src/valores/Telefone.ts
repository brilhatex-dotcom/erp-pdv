import { apenasDigitos } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/** Menor DDD em uso no país. Abaixo disso é número sem DDD ou digitação errada. */
const MENOR_DDD = 11;
const MAIOR_DDD = 99;

/**
 * Telefone brasileiro com DDD.
 *
 * Guarda **só dígitos**: máscara é assunto de tela, e persistir "(11) 98888-7777"
 * garante que a busca por "11988887777" não encontre nada — que é o defeito que
 * faz o atendente jurar que o cliente não está cadastrado.
 *
 * Exigir DDD não é rigor gratuito: telefone sem DDD não serve para ligar de
 * fora da cidade, e é justamente quando a loja precisa avisar sobre a entrega
 * que a falta aparece.
 */
export class Telefone implements ValueObject<Telefone> {
  readonly #digitos: string;

  private constructor(digitos: string) {
    this.#digitos = digitos;
  }

  static criar(valor: string): Result<Telefone, ErroValidacao> {
    const digitos = apenasDigitos(valor);

    if (digitos.length === 0) {
      return err(new ErroValidacao("TELEFONE_VAZIO", "Informe o telefone."));
    }

    // 10 dígitos é fixo (DDD + 8); 11 é celular (DDD + 9 + 8).
    if (digitos.length !== 10 && digitos.length !== 11) {
      return err(
        new ErroValidacao(
          "TELEFONE_TAMANHO_INVALIDO",
          "O telefone deve ter DDD e 8 ou 9 dígitos.",
          { quantidadeInformada: digitos.length },
        ),
      );
    }

    const ddd = Number(digitos.slice(0, 2));
    if (ddd < MENOR_DDD || ddd > MAIOR_DDD) {
      return err(
        new ErroValidacao("TELEFONE_DDD_INVALIDO", "DDD inválido. Confira os números.", {
          ddd,
        }),
      );
    }

    return ok(new Telefone(digitos));
  }

  /** Só dígitos, com DDD — o formato que o XML fiscal espera em `fone`. */
  get digitos(): string {
    return this.#digitos;
  }

  get ddd(): string {
    return this.#digitos.slice(0, 2);
  }

  get ehCelular(): boolean {
    return this.#digitos.length === 11;
  }

  equals(outro: Telefone): boolean {
    return this.#digitos === outro.#digitos;
  }

  /** Formata como `(11) 98888-7777` ou `(11) 3888-7777`. */
  formatar(): string {
    const assinante = this.#digitos.slice(2);
    const corte = this.ehCelular ? 5 : 4;

    return `(${this.ddd}) ${assinante.slice(0, corte)}-${assinante.slice(corte)}`;
  }

  toString(): string {
    return this.formatar();
  }

  toJSON(): string {
    return this.#digitos;
  }
}
