import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/** Limite do campo `email` no layout da NF-e. */
const TAMANHO_MAXIMO = 60;

/**
 * Forma mínima de um endereço de e-mail: algo, arroba, domínio com ponto.
 *
 * Deliberadamente **não** é a gramática do RFC 5322. Validar e-mail a rigor é
 * um problema conhecido por rejeitar endereços válidos, e o custo desse erro
 * aqui é concreto: o cadastro do cliente trava no balcão porque o sistema
 * "acha" que o e-mail dele não existe. Quem decide de verdade se o endereço é
 * válido é a entrega da mensagem, não o formulário.
 */
const FORMATO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * E-mail de contato do cliente ou do fornecedor.
 *
 * Guardado em minúsculas: a parte do domínio é insensível à caixa, e gravar
 * "Fulano@Loja.com" faria a mesma pessoa ser cadastrada duas vezes.
 */
export class Email implements ValueObject<Email> {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(bruto: string): Result<Email, ErroValidacao> {
    const valor = bruto.trim().toLowerCase();

    if (valor === "") {
      return err(new ErroValidacao("EMAIL_VAZIO", "Informe o e-mail."));
    }

    if (valor.length > TAMANHO_MAXIMO) {
      return err(
        new ErroValidacao(
          "EMAIL_LONGO",
          `O e-mail deve ter no máximo ${String(TAMANHO_MAXIMO)} caracteres.`,
          { tamanho: valor.length },
        ),
      );
    }

    if (!FORMATO.test(valor)) {
      return err(
        new ErroValidacao("EMAIL_INVALIDO", "E-mail inválido. Confira o endereço.", {
          valor,
        }),
      );
    }

    return ok(new Email(valor));
  }

  get valor(): string {
    return this.#valor;
  }

  equals(outro: Email): boolean {
    return this.#valor === outro.#valor;
  }

  toString(): string {
    return this.#valor;
  }

  toJSON(): string {
    return this.#valor;
  }
}
