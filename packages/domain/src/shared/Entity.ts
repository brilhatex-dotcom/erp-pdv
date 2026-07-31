import type { Identificador } from "./Identificador.js";

/**
 * Entidade: objeto com **identidade própria**, que persiste mesmo quando os
 * atributos mudam.
 *
 * É o oposto de um objeto de valor. Dois `Dinheiro` de R$ 10,00 são o mesmo
 * valor; dois produtos chamados "Coca-Cola 2L" com identificadores diferentes
 * são produtos diferentes — e um deles continua o mesmo produto depois de mudar
 * de preço, de descrição e até de código de barras.
 *
 * Por isso a igualdade compara **apenas o identificador**.
 */
export abstract class Entity {
  readonly id: Identificador;

  protected constructor(id: Identificador) {
    this.id = id;
  }

  /**
   * Igualdade por identidade.
   *
   * Compara também o tipo: um `Produto` e um `Cliente` que por acaso
   * compartilhassem identificador não são a mesma entidade.
   */
  equals(outra: Entity): boolean {
    return this.constructor === outra.constructor && this.id.equals(outra.id);
  }
}
