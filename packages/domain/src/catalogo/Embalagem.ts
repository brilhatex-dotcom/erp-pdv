import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";
import type { Quantidade } from "../valores/Quantidade.js";
import {
  type CodigoUnidade,
  obterUnidade,
  type UnidadeMedida,
} from "../valores/UnidadeMedida.js";

import type { CodigoBarras } from "./CodigoBarras.js";

/**
 * Forma alternativa de comprar ou vender um produto.
 *
 * O depósito compra cimento em palete, estoca em saco e vende em saco. A
 * mercearia compra refrigerante em fardo de 12 e vende unidade. Sem isso, o dono
 * faz a conta de cabeça na entrada da mercadoria — e o estoque nunca fecha
 * (`docs/ANALISE-SEGMENTOS.md` §3.2).
 *
 * O **fator** diz quantas unidades base a embalagem contém: fardo com fator 12
 * lança 12 unidades no estoque. É inteiro porque embalagem não tem fração —
 * meio fardo não é uma embalagem, são unidades soltas.
 */
export class Embalagem implements ValueObject<Embalagem> {
  readonly #unidade: UnidadeMedida;
  readonly #fator: bigint;
  readonly #codigoBarras: CodigoBarras | undefined;

  private constructor(
    unidade: UnidadeMedida,
    fator: bigint,
    codigoBarras: CodigoBarras | undefined,
  ) {
    this.#unidade = unidade;
    this.#fator = fator;
    this.#codigoBarras = codigoBarras;
  }

  static criar(
    codigoUnidade: CodigoUnidade,
    fator: bigint,
    codigoBarras?: CodigoBarras,
  ): Result<Embalagem, ErroValidacao> {
    if (fator <= 0n) {
      return err(
        new ErroValidacao(
          "EMBALAGEM_FATOR_INVALIDO",
          "A quantidade por embalagem deve ser maior que zero.",
          { fator: fator.toString() },
        ),
      );
    }

    if (fator === 1n) {
      return err(
        new ErroValidacao(
          "EMBALAGEM_FATOR_UNITARIO",
          "Embalagem com fator 1 é a própria unidade do produto.",
          { unidade: codigoUnidade },
        ),
      );
    }

    return ok(new Embalagem(obterUnidade(codigoUnidade), fator, codigoBarras));
  }

  get unidade(): UnidadeMedida {
    return this.#unidade;
  }

  get fator(): bigint {
    return this.#fator;
  }

  /** Código de barras da embalagem — tipicamente o DUN-14 da caixa. */
  get codigoBarras(): CodigoBarras | undefined {
    return this.#codigoBarras;
  }

  /**
   * Converte uma quantidade desta embalagem para a unidade base do produto.
   *
   * 2 caixas com fator 12 viram 24 unidades.
   */
  converterParaBase(
    quantidade: Quantidade,
    unidadeBase: CodigoUnidade,
  ): Result<Quantidade, ErroValidacao> {
    if (quantidade.unidade.codigo !== this.#unidade.codigo) {
      return err(
        new ErroValidacao(
          "EMBALAGEM_UNIDADE_INCOMPATIVEL",
          `A quantidade informada não está em ${this.#unidade.descricao.toLowerCase()}.`,
          { esperada: this.#unidade.codigo, recebida: quantidade.unidade.codigo },
        ),
      );
    }

    return quantidade.converterPara(unidadeBase, this.#fator);
  }

  /** Duas embalagens são a mesma quando usam a mesma unidade. */
  equals(outra: Embalagem): boolean {
    return this.#unidade.codigo === outra.#unidade.codigo;
  }

  toString(): string {
    return `${this.#unidade.simbolo} × ${this.#fator.toString()}`;
  }

  toJSON(): {
    readonly unidade: string;
    readonly fator: string;
    readonly codigoBarras: string | null;
  } {
    return {
      unidade: this.#unidade.codigo,
      fator: this.#fator.toString(),
      codigoBarras: this.#codigoBarras?.valor ?? null,
    };
  }
}
