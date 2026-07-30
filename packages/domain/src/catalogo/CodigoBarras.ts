import { apenasDigitos } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/**
 * Padrões de código aceitos no PDV.
 *
 * `INTERNO` cobre o código que a própria loja imprime para produto sem código
 * de fábrica — comum em hortifruti e em peça avulsa de autopeças. Não tem
 * dígito verificador porque não segue norma GS1.
 */
export type PadraoCodigo = "EAN8" | "EAN12" | "EAN13" | "DUN14" | "INTERNO";

const TAMANHOS_GTIN: Readonly<Record<number, PadraoCodigo>> = {
  8: "EAN8",
  12: "EAN12",
  13: "EAN13",
  14: "DUN14",
};

/**
 * Código de barras de um produto.
 *
 * Valida o dígito verificador dos padrões GS1. Isso não é preciosismo: código
 * digitado errado no cadastro faz o produto **nunca ser encontrado** quando o
 * operador bipa, e o caixa acaba registrando outro item parecido para não
 * segurar a fila. O erro só aparece no inventário, meses depois.
 */
export class CodigoBarras implements ValueObject<CodigoBarras> {
  readonly #valor: string;
  readonly #padrao: PadraoCodigo;

  private constructor(valor: string, padrao: PadraoCodigo) {
    this.#valor = valor;
    this.#padrao = padrao;
  }

  /**
   * Constrói validando o dígito verificador quando o tamanho corresponde a um
   * padrão GS1 (8, 12, 13 ou 14 dígitos).
   */
  static criar(valor: string): Result<CodigoBarras, ErroValidacao> {
    const digitos = apenasDigitos(valor);

    if (digitos.length === 0) {
      return err(new ErroValidacao("CODIGO_BARRAS_VAZIO", "Informe o código."));
    }

    if (digitos.length > 14) {
      return err(
        new ErroValidacao("CODIGO_BARRAS_LONGO", "Código de barras longo demais.", {
          quantidadeInformada: digitos.length,
        }),
      );
    }

    const padrao = TAMANHOS_GTIN[digitos.length];

    if (padrao === undefined) {
      return ok(new CodigoBarras(digitos, "INTERNO"));
    }

    if (!temDigitoVerificadorValido(digitos)) {
      return err(
        new ErroValidacao(
          "CODIGO_BARRAS_DIGITO_INVALIDO",
          "Código de barras inválido. Confira os números.",
          { codigo: digitos, padrao },
        ),
      );
    }

    return ok(new CodigoBarras(digitos, padrao));
  }

  /** Constrói sem exigir dígito verificador — para código próprio da loja. */
  static criarInterno(valor: string): Result<CodigoBarras, ErroValidacao> {
    const digitos = apenasDigitos(valor);

    if (digitos.length === 0) {
      return err(new ErroValidacao("CODIGO_BARRAS_VAZIO", "Informe o código."));
    }

    if (digitos.length > 14) {
      return err(
        new ErroValidacao("CODIGO_BARRAS_LONGO", "Código de barras longo demais.", {
          quantidadeInformada: digitos.length,
        }),
      );
    }

    return ok(new CodigoBarras(digitos, "INTERNO"));
  }

  get valor(): string {
    return this.#valor;
  }

  get padrao(): PadraoCodigo {
    return this.#padrao;
  }

  /** `DUN14` identifica a embalagem de transporte, não a unidade de venda. */
  get ehEmbalagem(): boolean {
    return this.#padrao === "DUN14";
  }

  equals(outro: CodigoBarras): boolean {
    return this.#valor === outro.#valor;
  }

  toString(): string {
    return this.#valor;
  }

  toJSON(): string {
    return this.#valor;
  }
}

/**
 * Confere o dígito verificador GS1 (módulo 10).
 *
 * Da direita para a esquerda, ignorando o próprio dígito verificador, os pesos
 * alternam 3 e 1. O verificador é o que completa a soma até o próximo múltiplo
 * de 10. O mesmo cálculo vale para EAN-8, EAN-12, EAN-13 e DUN-14.
 */
export function temDigitoVerificadorValido(digitos: string): boolean {
  const ultimaPosicao = digitos.length - 1;
  let soma = 0;

  for (let posicao = ultimaPosicao - 1; posicao >= 0; posicao -= 1) {
    const valor = digitos.charCodeAt(posicao) - 48;
    const distancia = ultimaPosicao - posicao;
    soma += valor * (distancia % 2 === 1 ? 3 : 1);
  }

  const verificador = (10 - (soma % 10)) % 10;
  return verificador === digitos.charCodeAt(ultimaPosicao) - 48;
}
