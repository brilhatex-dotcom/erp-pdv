import { apenasAlfanumericos, ehCnpjAlfanumerico, ehCnpjValido } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/**
 * CNPJ do emitente, do fornecedor ou do cliente pessoa jurídica.
 *
 * Aceita o formato **numérico** (legado) e o **alfanumérico**, que a Receita
 * Federal passou a emitir em 2026. Recusar o alfanumérico faria o sistema
 * rejeitar empresas abertas a partir deste ano — e a rejeição apareceria na
 * emissão fiscal, com a venda já feita.
 */
export class CNPJ implements ValueObject<CNPJ> {
  readonly #caracteres: string;

  private constructor(caracteres: string) {
    this.#caracteres = caracteres;
  }

  static criar(valor: string): Result<CNPJ, ErroValidacao> {
    const caracteres = apenasAlfanumericos(valor);

    if (caracteres.length === 0) {
      return err(new ErroValidacao("CNPJ_VAZIO", "Informe o CNPJ."));
    }

    if (caracteres.length !== 14) {
      return err(
        new ErroValidacao("CNPJ_TAMANHO_INVALIDO", "O CNPJ deve ter 14 caracteres.", {
          quantidadeInformada: caracteres.length,
        }),
      );
    }

    if (!ehCnpjValido(caracteres)) {
      return err(
        new ErroValidacao("CNPJ_INVALIDO", "CNPJ inválido. Confira os caracteres."),
      );
    }

    return ok(new CNPJ(caracteres));
  }

  /** Os 14 caracteres, sem máscara — formato exigido pelo XML fiscal. */
  get caracteres(): string {
    return this.#caracteres;
  }

  /** Indica se usa o formato alfanumérico introduzido em 2026. */
  get ehAlfanumerico(): boolean {
    return ehCnpjAlfanumerico(this.#caracteres);
  }

  /** Raiz do CNPJ (8 primeiros caracteres) — identifica a matriz. */
  get raiz(): string {
    return this.#caracteres.slice(0, 8);
  }

  /** Ordem do estabelecimento: `0001` é matriz, demais são filiais. */
  get ordem(): string {
    return this.#caracteres.slice(8, 12);
  }

  get ehMatriz(): boolean {
    return this.ordem === "0001";
  }

  equals(outro: CNPJ): boolean {
    return this.#caracteres === outro.#caracteres;
  }

  /** Formata como `11.222.333/0001-81`. */
  formatar(): string {
    const c = this.#caracteres;
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  }

  toString(): string {
    return this.formatar();
  }

  toJSON(): string {
    return this.#caracteres;
  }
}
