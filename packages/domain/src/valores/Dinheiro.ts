import { numeroParaTexto, separarDecimal } from "../shared/decimal.js";
import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/** Maior valor aceito: R$ 1 trilhão. Acima disso é digitação errada, não venda. */
const LIMITE_CENTAVOS = 100_000_000_000_000n;

/**
 * Valor monetário em reais, representado como **inteiro de centavos**.
 *
 * `float` para dinheiro é bug agendado para o fechamento de caixa: `0.1 + 0.2`
 * não é `0.3` em ponto flutuante, e o erro se acumula item a item até o caixa
 * fechar com diferença de centavos que ninguém consegue explicar. Usar `bigint`
 * elimina a classe inteira de defeito — não a reduz, elimina.
 *
 * Todas as operações devolvem uma nova instância: um total não pode ser
 * alterado por engano depois de calculado.
 */
export class Dinheiro implements ValueObject<Dinheiro> {
  readonly #centavos: bigint;

  private constructor(centavos: bigint) {
    this.#centavos = centavos;
  }

  // ── Construção ─────────────────────────────────────────────────────────

  static zero(): Dinheiro {
    return new Dinheiro(0n);
  }

  /** Constrói a partir de centavos. É a via preferida — não há conversão. */
  static deCentavos(centavos: bigint | number): Result<Dinheiro, ErroValidacao> {
    if (typeof centavos === "number" && !Number.isSafeInteger(centavos)) {
      return err(
        new ErroValidacao("DINHEIRO_CENTAVOS_INVALIDO", "Valor monetário inválido.", {
          centavos,
        }),
      );
    }

    const valor = BigInt(centavos);

    if (valor > LIMITE_CENTAVOS || valor < -LIMITE_CENTAVOS) {
      return err(
        new ErroValidacao("DINHEIRO_FORA_DO_LIMITE", "Valor monetário fora do limite.", {
          centavos: valor.toString(),
        }),
      );
    }

    return ok(new Dinheiro(valor));
  }

  /**
   * Constrói a partir de reais em texto ou número: `"10,50"`, `"10.50"`, `10.5`.
   *
   * O número é convertido via texto, e não multiplicado por 100, justamente para
   * não reintroduzir o erro de ponto flutuante que a classe existe para evitar.
   * A terceira casa decimal é arredondada meio-para-cima, como manda a prática
   * comercial brasileira.
   */
  static deReais(reais: string | number): Result<Dinheiro, ErroValidacao> {
    const texto = typeof reais === "number" ? numeroParaTexto(reais) : reais.trim();

    if (texto === "") {
      return err(new ErroValidacao("DINHEIRO_VAZIO", "Informe um valor."));
    }

    const partes = separarDecimal(texto);

    if (partes === undefined) {
      return err(
        new ErroValidacao("DINHEIRO_FORMATO_INVALIDO", "Valor monetário inválido.", {
          valorRecebido: texto,
        }),
      );
    }

    const { negativo, inteiros, decimais } = partes;

    // Duas casas para os centavos; a terceira decide o arredondamento.
    const centavosTexto = (decimais + "000").slice(0, 2);
    const terceiraCasa = Number((decimais + "000").charAt(2));

    let total = BigInt(inteiros) * 100n + BigInt(centavosTexto);
    if (terceiraCasa >= 5) {
      total += 1n;
    }

    return Dinheiro.deCentavos(negativo ? -total : total);
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get centavos(): bigint {
    return this.#centavos;
  }

  // ── Aritmética ─────────────────────────────────────────────────────────

  somar(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.#centavos + outro.#centavos);
  }

  subtrair(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.#centavos - outro.#centavos);
  }

  /**
   * Multiplica por um fator escalado.
   *
   * `fator` e `escala` são inteiros: para multiplicar por 2,5 use
   * `escalar(25n, 10n)`. É assim que `Quantidade` multiplica preço por peso sem
   * jamais passar por ponto flutuante.
   */
  escalar(fator: bigint, escala = 1n): Dinheiro {
    return new Dinheiro(dividirArredondando(this.#centavos * fator, escala));
  }

  negar(): Dinheiro {
    return new Dinheiro(-this.#centavos);
  }

  absoluto(): Dinheiro {
    return this.#centavos < 0n ? new Dinheiro(-this.#centavos) : this;
  }

  // ── Rateio ─────────────────────────────────────────────────────────────

  /**
   * Divide em `partes` iguais, distribuindo a sobra.
   *
   * Dividir R$ 10,00 em 3 devolve `[3,34 · 3,33 · 3,33]` — a soma bate exatamente
   * com o total. Uma divisão que arredonda cada parte independentemente devolveria
   * `[3,33 · 3,33 · 3,33]`, perdendo um centavo. Esse centavo é o motivo clássico
   * de a SEFAZ **rejeitar** a nota, porque a soma dos itens não fecha com o total.
   */
  ratear(partes: number): Result<Dinheiro[], ErroValidacao> {
    if (!Number.isInteger(partes) || partes <= 0) {
      return err(
        new ErroValidacao("RATEIO_PARTES_INVALIDO", "Número de parcelas inválido.", {
          partes,
        }),
      );
    }

    const divisor = BigInt(partes);
    const sinal = this.#centavos < 0n ? -1n : 1n;
    const total = this.#centavos * sinal;

    const base = total / divisor;
    const sobra = total % divisor;

    const resultado: Dinheiro[] = [];
    for (let i = 0n; i < divisor; i += 1n) {
      const extra = i < sobra ? 1n : 0n;
      resultado.push(new Dinheiro((base + extra) * sinal));
    }

    return ok(resultado);
  }

  /**
   * Rateia proporcionalmente aos pesos, garantindo que a soma feche com o total.
   *
   * É o cálculo usado para distribuir um desconto dado na venda inteira entre os
   * itens, que é obrigatório no XML fiscal. Usa o método do **maior resto**: cada
   * parte recebe o piso da sua fração, e os centavos restantes vão para quem tem
   * o maior resto — o critério que menos distorce a proporção.
   */
  ratearProporcional(pesos: readonly bigint[]): Result<Dinheiro[], ErroValidacao> {
    if (pesos.length === 0) {
      return err(
        new ErroValidacao("RATEIO_SEM_PESOS", "Não há itens para ratear o valor."),
      );
    }

    if (pesos.some((peso) => peso < 0n)) {
      return err(new ErroValidacao("RATEIO_PESO_NEGATIVO", "Peso de rateio inválido."));
    }

    const somaPesos = pesos.reduce((total, peso) => total + peso, 0n);

    if (somaPesos === 0n) {
      return err(
        new ErroValidacao(
          "RATEIO_PESO_TOTAL_ZERO",
          "Não é possível ratear o valor: os itens somam zero.",
        ),
      );
    }

    const sinal = this.#centavos < 0n ? -1n : 1n;
    const total = this.#centavos * sinal;

    const partes = pesos.map((peso, indice) => ({
      indice,
      valor: (total * peso) / somaPesos,
      resto: (total * peso) % somaPesos,
    }));

    const distribuido = partes.reduce((soma, parte) => soma + parte.valor, 0n);
    let sobra = total - distribuido;

    // Maior resto primeiro; empate resolvido pela ordem original, para que o
    // rateio seja determinístico — reprocessar a mesma venda dá o mesmo XML.
    const ordenadas = [...partes].sort((a, b) =>
      a.resto === b.resto ? a.indice - b.indice : a.resto > b.resto ? -1 : 1,
    );

    for (const parte of ordenadas) {
      if (sobra <= 0n) break;
      parte.valor += 1n;
      sobra -= 1n;
    }

    return ok(partes.map((parte) => new Dinheiro(parte.valor * sinal)));
  }

  /**
   * Média ponderada de vários valores.
   *
   * É o cálculo do **custo médio ponderado móvel** do estoque: entrou 10 peças
   * a R$ 3,00 e depois 5 a R$ 4,00, o custo passa a ser R$ 3,33.
   * Fica aqui, e não no estoque, porque o arredondamento é regra monetária — e
   * espalhar arredondamento pelo código é como se perde centavo.
   */
  static mediaPonderada(
    entradas: readonly { readonly valor: Dinheiro; readonly peso: bigint }[],
  ): Result<Dinheiro, ErroValidacao> {
    if (entradas.length === 0) {
      return err(
        new ErroValidacao("MEDIA_SEM_ENTRADAS", "Não há valores para calcular a média."),
      );
    }

    if (entradas.some((entrada) => entrada.peso < 0n)) {
      return err(
        new ErroValidacao("MEDIA_PESO_NEGATIVO", "Peso inválido no cálculo da média."),
      );
    }

    const pesoTotal = entradas.reduce((total, entrada) => total + entrada.peso, 0n);

    if (pesoTotal === 0n) {
      return err(
        new ErroValidacao(
          "MEDIA_PESO_TOTAL_ZERO",
          "Não é possível calcular a média: os pesos somam zero.",
        ),
      );
    }

    const somaPonderada = entradas.reduce(
      (total, entrada) => total + entrada.valor.#centavos * entrada.peso,
      0n,
    );

    return Dinheiro.deCentavos(dividirArredondando(somaPonderada, pesoTotal));
  }

  // ── Comparação ─────────────────────────────────────────────────────────

  equals(outro: Dinheiro): boolean {
    return this.#centavos === outro.#centavos;
  }

  maiorQue(outro: Dinheiro): boolean {
    return this.#centavos > outro.#centavos;
  }

  maiorOuIgualA(outro: Dinheiro): boolean {
    return this.#centavos >= outro.#centavos;
  }

  menorQue(outro: Dinheiro): boolean {
    return this.#centavos < outro.#centavos;
  }

  menorOuIgualA(outro: Dinheiro): boolean {
    return this.#centavos <= outro.#centavos;
  }

  ehZero(): boolean {
    return this.#centavos === 0n;
  }

  ehPositivo(): boolean {
    return this.#centavos > 0n;
  }

  ehNegativo(): boolean {
    return this.#centavos < 0n;
  }

  // ── Apresentação ───────────────────────────────────────────────────────

  /**
   * Formata no padrão brasileiro: `R$ 1.234,56`.
   *
   * Formatação manual, sem `Intl`: a saída do `Intl` varia conforme a build de
   * ICU do runtime (inclusive o tipo de espaço após "R$"), e cupom fiscal não
   * pode sair diferente conforme a máquina do cliente.
   */
  formatar(opcoes?: { readonly comSimbolo?: boolean }): string {
    const comSimbolo = opcoes?.comSimbolo ?? true;
    const negativo = this.#centavos < 0n;
    const absoluto = negativo ? -this.#centavos : this.#centavos;

    const inteiros = (absoluto / 100n).toString();
    const centavos = (absoluto % 100n).toString().padStart(2, "0");

    const inteirosComSeparador = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const numero = `${inteirosComSeparador},${centavos}`;

    const prefixo = comSimbolo ? "R$ " : "";
    return negativo ? `-${prefixo}${numero}` : `${prefixo}${numero}`;
  }

  /** Representação decimal para XML fiscal e API: `"1234.56"`. */
  paraDecimal(): string {
    const negativo = this.#centavos < 0n;
    const absoluto = negativo ? -this.#centavos : this.#centavos;
    const inteiros = (absoluto / 100n).toString();
    const centavos = (absoluto % 100n).toString().padStart(2, "0");
    return `${negativo ? "-" : ""}${inteiros}.${centavos}`;
  }

  toString(): string {
    return this.formatar();
  }

  /** `bigint` não é serializável por JSON — expõe centavos como texto. */
  toJSON(): string {
    return this.#centavos.toString();
  }
}

/**
 * Divisão inteira com arredondamento meio-para-cima, afastando-se do zero.
 *
 * É o arredondamento comercial usado no Brasil: R$ 0,125 vira R$ 0,13. O
 * arredondamento bancário (meio-para-par) distorceria totais de cupom em
 * relação ao que o cliente espera ver.
 */
function dividirArredondando(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) {
    // Divisor zero é bug de programação, não regra de negócio (CLAUDE.md §4.7).
    throw new Error("Divisão por zero no cálculo monetário");
  }

  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;

  const quociente = n / d;
  const resto = n % d;
  const magnitude = resto * 2n >= d ? quociente + 1n : quociente;

  return negativo ? -magnitude : magnitude;
}
