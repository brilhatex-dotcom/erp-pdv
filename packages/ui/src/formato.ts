/**
 * Formatação para a tela.
 *
 * Vive no design system, e não numa `utils` qualquer, porque formatação é
 * decisão de **apresentação**: o mesmo centavo vira "R$ 9,90" na tela e "9.90"
 * no XML fiscal. Misturar as duas é como se perde a distinção.
 */

/**
 * Centavos (texto, como a API entrega) → "R$ 9,90".
 *
 * A API manda dinheiro como **texto de centavos** justamente para não passar
 * por `number` — `2^53` centavos é um teto que a soma anual de uma rede
 * alcança. Aqui a conversão é feita com `BigInt`, e só a parte já dividida
 * vira texto.
 */
export function formatarDinheiro(centavos: string | bigint): string {
  const valor = typeof centavos === "bigint" ? centavos : BigInt(centavos);
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;

  const reais = absoluto / 100n;
  const resto = absoluto % 100n;

  const inteiro = agruparMilhar(reais.toString());
  const decimais = resto.toString().padStart(2, "0");

  return `${negativo ? "-" : ""}R$ ${inteiro},${decimais}`;
}

/** Milésimos → "1,25" (sem zeros à direita desnecessários). */
export function formatarQuantidade(milesimos: string | bigint): string {
  const valor = typeof milesimos === "bigint" ? milesimos : BigInt(milesimos);
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;

  const inteiro = absoluto / 1000n;
  const fracao = (absoluto % 1000n).toString().padStart(3, "0").replace(/0+$/, "");

  const texto = fracao === "" ? inteiro.toString() : `${inteiro.toString()},${fracao}`;

  return negativo ? `-${texto}` : texto;
}

/** `1234567` → `"1.234.567"`. */
function agruparMilhar(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `"1990"` → `"19,90"`. Para preencher um campo de digitação, não para exibir. */
export function centavosParaReais(centavos: string | bigint): string {
  const valor = typeof centavos === "bigint" ? centavos : BigInt(centavos);
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;

  const texto = `${(absoluto / 100n).toString()},${(absoluto % 100n).toString().padStart(2, "0")}`;

  return negativo ? `-${texto}` : texto;
}

/**
 * `"19,90"` → `"1990"`. Devolve `undefined` quando o texto não é um valor.
 *
 * Como no PDV, número **sem separador é reais**: `"2000"` é R$ 2.000,00. A
 * interpretação inversa daria um valor cem vezes menor que o pretendido, e o
 * erro só apareceria no balcão — no limite de crédito recusado, ou na etiqueta
 * que não bate com a gôndola.
 *
 * Vive aqui, e não em cada tela, porque é a mesma regra para preço, custo e
 * limite de crédito. Duas cópias divergem no dia em que uma passa a aceitar
 * ponto como separador de milhar.
 */
export function reaisParaCentavos(texto: string): string | undefined {
  const limpo = texto.trim().replace(/\./g, ",");

  if (!/^\d+(,\d{0,2})?$/.test(limpo)) return undefined;

  const [inteiro = "0", decimais = ""] = limpo.split(",");
  return (BigInt(inteiro) * 100n + BigInt(decimais.padEnd(2, "0") || "0")).toString();
}
