import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

const TAMANHO_MAXIMO = 6;

/**
 * Identificação do operador no balcão.
 *
 * **Só dígitos, no máximo seis.** A matrícula é digitada com fila esperando, e
 * frequentemente num teclado numérico — letra obrigaria o operador a procurar a
 * tecla, que é justamente o atrito que faz a equipe compartilhar login e
 * destruir a auditoria (ARQUITETURA.md §8.1).
 *
 * Zeros à esquerda são descartados na normalização: quem digita `007` e quem
 * digita `7` está procurando a mesma pessoa. Sem isso, o mesmo funcionário
 * poderia ser cadastrado duas vezes e as vendas dele ficariam divididas entre
 * dois históricos.
 */
export class Matricula implements ValueObject<Matricula> {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<Matricula, ErroValidacao> {
    const limpo = valor.trim();

    if (limpo === "") {
      return err(new ErroValidacao("MATRICULA_VAZIA", "Informe a matrícula."));
    }

    if (!/^\d+$/.test(limpo)) {
      return err(
        new ErroValidacao(
          "MATRICULA_NAO_NUMERICA",
          "A matrícula deve conter apenas números.",
          { matricula: limpo },
        ),
      );
    }

    if (limpo.length > TAMANHO_MAXIMO) {
      return err(
        new ErroValidacao(
          "MATRICULA_LONGA",
          `A matrícula deve ter no máximo ${String(TAMANHO_MAXIMO)} dígitos.`,
          { tamanho: limpo.length },
        ),
      );
    }

    const normalizada = limpo.replace(/^0+(?=\d)/, "");

    return ok(new Matricula(normalizada));
  }

  get valor(): string {
    return this.#valor;
  }

  equals(outra: Matricula): boolean {
    return this.#valor === outra.#valor;
  }

  toString(): string {
    return this.#valor;
  }
}
