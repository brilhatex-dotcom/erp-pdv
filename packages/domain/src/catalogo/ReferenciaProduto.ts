import { normalizarParaBusca } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/**
 * Como um produto pode ser identificado além do código de barras principal.
 *
 * Autopeças é o segmento que exige isso: a mesma peça tem código do fabricante,
 * código original da montadora e códigos de similares — e o balconista busca
 * por qualquer um deles, porque é o que o cliente traz escrito no papel
 * (`docs/ANALISE-SEGMENTOS.md` §4.1).
 */
export type TipoReferencia =
  | "EAN" // código de barras adicional
  | "FABRICANTE" // código do fabricante da peça
  | "ORIGINAL" // código original da montadora
  | "SIMILAR" // equivalente de outra marca
  | "INTERNO" // código próprio da loja
  | "FORNECEDOR"; // código no catálogo do fornecedor

const TAMANHO_MAXIMO = 60;

/**
 * Referência alternativa de um produto.
 *
 * Guarda também a forma normalizada, que é o que torna a busca do balcão
 * tolerante: o balconista digita "hg 1234" e encontra "HG-1234".
 */
export class ReferenciaProduto implements ValueObject<ReferenciaProduto> {
  readonly #tipo: TipoReferencia;
  readonly #valor: string;
  readonly #normalizado: string;

  private constructor(tipo: TipoReferencia, valor: string, normalizado: string) {
    this.#tipo = tipo;
    this.#valor = valor;
    this.#normalizado = normalizado;
  }

  static criar(
    tipo: TipoReferencia,
    valor: string,
  ): Result<ReferenciaProduto, ErroValidacao> {
    const limpo = valor.trim();

    if (limpo === "") {
      return err(
        new ErroValidacao("REFERENCIA_VAZIA", "Informe o código de referência."),
      );
    }

    if (limpo.length > TAMANHO_MAXIMO) {
      return err(
        new ErroValidacao(
          "REFERENCIA_LONGA",
          `O código de referência deve ter no máximo ${String(TAMANHO_MAXIMO)} caracteres.`,
          { tamanho: limpo.length },
        ),
      );
    }

    // Separadores são ruído na busca: "HG-1234", "HG 1234" e "hg1234" são o
    // mesmo código para quem está atrás do balcão.
    const normalizado = normalizarParaBusca(limpo).replace(/[\s\-./]/g, "");

    if (normalizado === "") {
      return err(
        new ErroValidacao(
          "REFERENCIA_SEM_CONTEUDO",
          "O código de referência precisa ter letras ou números.",
          { valorRecebido: valor },
        ),
      );
    }

    return ok(new ReferenciaProduto(tipo, limpo, normalizado));
  }

  get tipo(): TipoReferencia {
    return this.#tipo;
  }

  /** Valor como foi cadastrado, para exibir. */
  get valor(): string {
    return this.#valor;
  }

  /** Forma comparável, para buscar e detectar duplicidade. */
  get normalizado(): string {
    return this.#normalizado;
  }

  /**
   * Igualdade pelo valor normalizado **e** pelo tipo.
   *
   * O mesmo número pode existir legitimamente como código do fabricante e como
   * código original — são referências diferentes que apontam para o mesmo item.
   */
  equals(outra: ReferenciaProduto): boolean {
    return this.#tipo === outra.#tipo && this.#normalizado === outra.#normalizado;
  }

  toString(): string {
    return `${this.#tipo}:${this.#valor}`;
  }

  toJSON(): { readonly tipo: TipoReferencia; readonly valor: string } {
    return { tipo: this.#tipo, valor: this.#valor };
  }
}
