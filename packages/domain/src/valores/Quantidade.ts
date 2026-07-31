import { numeroParaTexto, separarDecimal } from "../shared/decimal.js";
import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";
import { type CodigoUnidade, obterUnidade, type UnidadeMedida } from "./UnidadeMedida.js";

/** Casas decimais da quantidade — o mesmo que a NF-e aceita em `qCom`. */
export const CASAS_DECIMAIS = 3;
const ESCALA = 1000n;
const LIMITE_MILESIMOS = 1_000_000_000_000n;

/**
 * Quantidade vendida ou movimentada, com unidade de medida.
 *
 * Guardada como **inteiro de milésimos**, pelo mesmo motivo de `Dinheiro`: peso
 * em ponto flutuante acumula erro, e no fechamento de estoque isso vira
 * divergência que ninguém consegue rastrear.
 *
 * Três casas decimais não são arbitrárias: é o que o layout da NF-e aceita no
 * campo de quantidade comercial, e o que uma balança de açougue produz (gramas).
 *
 * A unidade faz parte do valor — somar 2 kg com 3 caixas é erro, e o tipo
 * recusa. Foi por não separar isso que sistemas de depósito misturam palete com
 * saco e o estoque nunca fecha (`docs/ANALISE-SEGMENTOS.md` §3.2).
 */
export class Quantidade implements ValueObject<Quantidade> {
  readonly #milesimos: bigint;
  readonly #unidade: UnidadeMedida;

  private constructor(milesimos: bigint, unidade: UnidadeMedida) {
    this.#milesimos = milesimos;
    this.#unidade = unidade;
  }

  // ── Construção ─────────────────────────────────────────────────────────

  static zero(codigoUnidade: CodigoUnidade): Quantidade {
    return new Quantidade(0n, obterUnidade(codigoUnidade));
  }

  /** Constrói a partir de milésimos: `1500n` com `KG` são 1,5 kg. */
  static deMilesimos(
    milesimos: bigint,
    codigoUnidade: CodigoUnidade,
  ): Result<Quantidade, ErroValidacao> {
    if (milesimos > LIMITE_MILESIMOS || milesimos < -LIMITE_MILESIMOS) {
      return err(
        new ErroValidacao("QUANTIDADE_FORA_DO_LIMITE", "Quantidade fora do limite.", {
          milesimos: milesimos.toString(),
        }),
      );
    }

    const unidade = obterUnidade(codigoUnidade);

    if (!unidade.fracionavel && milesimos % ESCALA !== 0n) {
      return err(
        new ErroValidacao(
          "QUANTIDADE_NAO_FRACIONAVEL",
          `Não é possível usar quantidade fracionada em ${unidade.descricao.toLowerCase()}.`,
          { unidade: unidade.codigo, milesimos: milesimos.toString() },
        ),
      );
    }

    return ok(new Quantidade(milesimos, unidade));
  }

  /**
   * Constrói a partir de texto ou número: `"1,5"`, `"1.5"`, `1.5`, `"2"`.
   *
   * A conversão passa por texto para não reintroduzir erro de ponto flutuante.
   * Casas além da terceira são arredondadas meio-para-cima.
   */
  static de(
    valor: string | number,
    codigoUnidade: CodigoUnidade,
  ): Result<Quantidade, ErroValidacao> {
    const texto = typeof valor === "number" ? numeroParaTexto(valor) : valor.trim();

    if (texto === "") {
      return err(new ErroValidacao("QUANTIDADE_VAZIA", "Informe a quantidade."));
    }

    const partes = separarDecimal(texto);

    if (partes === undefined) {
      return err(
        new ErroValidacao("QUANTIDADE_FORMATO_INVALIDO", "Quantidade inválida.", {
          valorRecebido: texto,
        }),
      );
    }

    const { negativo, inteiros, decimais } = partes;

    const preenchido = decimais + "0000";
    let milesimos = BigInt(inteiros) * ESCALA + BigInt(preenchido.slice(0, 3));

    if (Number(preenchido.charAt(3)) >= 5) {
      milesimos += 1n;
    }

    return Quantidade.deMilesimos(negativo ? -milesimos : milesimos, codigoUnidade);
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get milesimos(): bigint {
    return this.#milesimos;
  }

  get unidade(): UnidadeMedida {
    return this.#unidade;
  }

  // ── Aritmética ─────────────────────────────────────────────────────────

  somar(outra: Quantidade): Result<Quantidade, ErroValidacao> {
    const conflito = this.#verificarUnidade(outra);
    if (conflito !== undefined) return err(conflito);

    return Quantidade.deMilesimos(
      this.#milesimos + outra.#milesimos,
      this.#unidade.codigo,
    );
  }

  subtrair(outra: Quantidade): Result<Quantidade, ErroValidacao> {
    const conflito = this.#verificarUnidade(outra);
    if (conflito !== undefined) return err(conflito);

    return Quantidade.deMilesimos(
      this.#milesimos - outra.#milesimos,
      this.#unidade.codigo,
    );
  }

  /**
   * Converte para outra unidade aplicando um fator.
   *
   * É o que resolve o caso do depósito: 1 fardo com fator 12 vira 12 unidades.
   * O fator é inteiro porque embalagem não tem fração.
   */
  converterPara(
    codigoUnidade: CodigoUnidade,
    fator: bigint,
  ): Result<Quantidade, ErroValidacao> {
    if (fator <= 0n) {
      return err(
        new ErroValidacao("CONVERSAO_FATOR_INVALIDO", "Fator de conversão inválido.", {
          fator: fator.toString(),
        }),
      );
    }

    return Quantidade.deMilesimos(this.#milesimos * fator, codigoUnidade);
  }

  negar(): Quantidade {
    return new Quantidade(-this.#milesimos, this.#unidade);
  }

  // ── Comparação ─────────────────────────────────────────────────────────

  equals(outra: Quantidade): boolean {
    return (
      this.#milesimos === outra.#milesimos &&
      this.#unidade.codigo === outra.#unidade.codigo
    );
  }

  maiorQue(outra: Quantidade): boolean {
    return this.#mesmaUnidade(outra) && this.#milesimos > outra.#milesimos;
  }

  menorQue(outra: Quantidade): boolean {
    return this.#mesmaUnidade(outra) && this.#milesimos < outra.#milesimos;
  }

  ehZero(): boolean {
    return this.#milesimos === 0n;
  }

  ehPositiva(): boolean {
    return this.#milesimos > 0n;
  }

  ehNegativa(): boolean {
    return this.#milesimos < 0n;
  }

  // ── Apresentação ───────────────────────────────────────────────────────

  /**
   * Formata para a tela: `2 un`, `1,5 kg`, `0,750 kg`.
   *
   * Zeros decimais desnecessários são omitidos — o operador lê "2 un", não
   * "2,000 un". Numa tela de balcão, ruído visual custa tempo.
   */
  formatar(opcoes?: { readonly comUnidade?: boolean }): string {
    const comUnidade = opcoes?.comUnidade ?? true;
    const negativo = this.#milesimos < 0n;
    const absoluto = negativo ? -this.#milesimos : this.#milesimos;

    const inteiros = (absoluto / ESCALA).toString();
    const decimais = (absoluto % ESCALA).toString().padStart(3, "0").replace(/0+$/, "");

    const numero = decimais === "" ? inteiros : `${inteiros},${decimais}`;
    const sinal = negativo ? "-" : "";
    const sufixo = comUnidade ? ` ${this.#unidade.simbolo}` : "";

    return `${sinal}${numero}${sufixo}`;
  }

  /** Representação decimal para XML fiscal: sempre com 3 casas. */
  paraDecimal(): string {
    const negativo = this.#milesimos < 0n;
    const absoluto = negativo ? -this.#milesimos : this.#milesimos;
    const inteiros = (absoluto / ESCALA).toString();
    const decimais = (absoluto % ESCALA).toString().padStart(3, "0");
    return `${negativo ? "-" : ""}${inteiros}.${decimais}`;
  }

  toString(): string {
    return this.formatar();
  }

  toJSON(): { readonly milesimos: string; readonly unidade: string } {
    return { milesimos: this.#milesimos.toString(), unidade: this.#unidade.codigo };
  }

  // ── Interno ────────────────────────────────────────────────────────────

  #mesmaUnidade(outra: Quantidade): boolean {
    return this.#unidade.codigo === outra.#unidade.codigo;
  }

  #verificarUnidade(outra: Quantidade): ErroValidacao | undefined {
    if (this.#mesmaUnidade(outra)) return undefined;

    return new ErroValidacao(
      "QUANTIDADE_UNIDADES_INCOMPATIVEIS",
      `Não é possível combinar ${this.#unidade.descricao.toLowerCase()} com ${outra.#unidade.descricao.toLowerCase()}.`,
      { unidadeA: this.#unidade.codigo, unidadeB: outra.#unidade.codigo },
    );
  }
}
