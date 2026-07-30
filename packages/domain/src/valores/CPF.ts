import { apenasDigitos, ehCpfValido } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/**
 * CPF do consumidor, validado na construção.
 *
 * Existir como tipo significa que um CPF inválido **não consegue** chegar ao XML
 * fiscal: não há como construir a instância. Isso importa porque a rejeição da
 * SEFAZ por CPF inválido acontece depois da venda concluída, quando o cliente já
 * foi embora e não há como corrigir o documento.
 *
 * No PDV o CPF é opcional (minimização de dados, LGPD — ARQUITETURA.md §7.6):
 * só é solicitado quando o consumidor pede.
 */
export class CPF implements ValueObject<CPF> {
  readonly #digitos: string;

  private constructor(digitos: string) {
    this.#digitos = digitos;
  }

  static criar(valor: string): Result<CPF, ErroValidacao> {
    const digitos = apenasDigitos(valor);

    if (digitos.length === 0) {
      return err(new ErroValidacao("CPF_VAZIO", "Informe o CPF."));
    }

    if (digitos.length !== 11) {
      return err(
        new ErroValidacao("CPF_TAMANHO_INVALIDO", "O CPF deve ter 11 dígitos.", {
          quantidadeInformada: digitos.length,
        }),
      );
    }

    if (!ehCpfValido(digitos)) {
      return err(new ErroValidacao("CPF_INVALIDO", "CPF inválido. Confira os números."));
    }

    return ok(new CPF(digitos));
  }

  /** Os 11 dígitos, sem máscara — é o formato que o XML fiscal exige. */
  get digitos(): string {
    return this.#digitos;
  }

  equals(outro: CPF): boolean {
    return this.#digitos === outro.#digitos;
  }

  /** Formata como `529.982.247-25`. */
  formatar(): string {
    const d = this.#digitos;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  /**
   * Formata mascarado para exibição em listagem: `529.***.**7-25`.
   *
   * Reduz exposição de dado pessoal em tela que fica visível no balcão, onde
   * outros clientes enxergam o monitor.
   */
  formatarMascarado(): string {
    const d = this.#digitos;
    return `${d.slice(0, 3)}.***.**${d.slice(8, 9)}-${d.slice(9)}`;
  }

  toString(): string {
    return this.formatar();
  }

  toJSON(): string {
    return this.#digitos;
  }
}
