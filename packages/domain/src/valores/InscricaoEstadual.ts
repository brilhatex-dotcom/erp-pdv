import { apenasDigitos } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/** Valor que o layout da NF-e exige literalmente quando não há inscrição. */
const ISENTO = "ISENTO";

const MENOS_DIGITOS = 2;
const MAIS_DIGITOS = 14;

/**
 * Inscrição estadual — número ou a palavra `ISENTO`.
 *
 * **Não valida o dígito verificador.** Cada estado tem o seu algoritmo, são 27
 * regras que mudam por ato normativo estadual, e fixá-las no código violaria o
 * CLAUDE.md §9 ("não fixar regra fiscal no código"). O que este tipo garante é
 * o **formato** que o XML aceita — só dígitos ou a palavra exata `ISENTO`. A
 * conferência do dígito, quando for feita, é do provedor fiscal, que já mantém
 * essas tabelas atualizadas como parte do serviço (ADR-0015).
 *
 * `ISENTO` como valor de primeira classe existe porque é o caso comum do
 * varejo: produtor rural, MEI e boa parte dos fornecedores pequenos não têm
 * inscrição, e deixar o campo vazio faria a nota ser rejeitada com "informe a
 * IE do destinatário".
 */
export class InscricaoEstadual implements ValueObject<InscricaoEstadual> {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(bruto: string): Result<InscricaoEstadual, ErroValidacao> {
    const texto = bruto.trim().toUpperCase();

    if (texto === "") {
      return err(
        new ErroValidacao(
          "INSCRICAO_ESTADUAL_VAZIA",
          "Informe a inscrição estadual ou marque como isento.",
        ),
      );
    }

    if (texto === ISENTO) {
      return ok(new InscricaoEstadual(ISENTO));
    }

    const digitos = apenasDigitos(texto);

    if (digitos.length < MENOS_DIGITOS || digitos.length > MAIS_DIGITOS) {
      return err(
        new ErroValidacao(
          "INSCRICAO_ESTADUAL_INVALIDA",
          "A inscrição estadual deve ter só números, ou a palavra ISENTO.",
          { quantidadeInformada: digitos.length },
        ),
      );
    }

    return ok(new InscricaoEstadual(digitos));
  }

  static isento(): InscricaoEstadual {
    return new InscricaoEstadual(ISENTO);
  }

  get valor(): string {
    return this.#valor;
  }

  get ehIsento(): boolean {
    return this.#valor === ISENTO;
  }

  equals(outra: InscricaoEstadual): boolean {
    return this.#valor === outra.#valor;
  }

  toString(): string {
    return this.#valor;
  }

  toJSON(): string {
    return this.#valor;
  }
}
