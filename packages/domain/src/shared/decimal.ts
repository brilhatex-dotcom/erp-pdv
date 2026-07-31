/**
 * Separa um decimal em sinal, parte inteira e parte decimal.
 *
 * Compartilhado por `Dinheiro` e `Quantidade`: ambos precisam converter texto
 * em inteiro escalado sem jamais passar por ponto flutuante, e duplicar essa
 * conversão significaria duas chances de errar o arredondamento.
 *
 * Feito com `indexOf` em vez de grupos de captura opcionais: grupo opcional é
 * tipado como possivelmente ausente, o que obriga a escrever um valor padrão
 * que jamais é usado — ramo que nenhum teste consegue exercitar e que só serve
 * para mascarar a cobertura.
 *
 * Aceita vírgula e ponto como separador decimal: o operador digita "1,5" e o
 * arquivo importado do fornecedor traz "1.5".
 */
export interface PartesDecimal {
  readonly negativo: boolean;
  readonly inteiros: string;
  readonly decimais: string;
}

export function separarDecimal(texto: string): PartesDecimal | undefined {
  const normalizado = texto.replace(/\s/g, "").replace(",", ".");

  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) {
    return undefined;
  }

  const negativo = normalizado.startsWith("-");
  const semSinal = negativo ? normalizado.slice(1) : normalizado;
  const separador = semSinal.indexOf(".");

  if (separador === -1) {
    return { negativo, inteiros: semSinal, decimais: "" };
  }

  return {
    negativo,
    inteiros: semSinal.slice(0, separador),
    decimais: semSinal.slice(separador + 1),
  };
}

/**
 * Converte número para texto decimal, sem notação científica.
 *
 * Quatro casas preservam precisão suficiente para o arredondamento de centavos
 * e de milésimos, descartando o ruído de ponto flutuante das casas seguintes —
 * é o que faz `0.1 + 0.2` virar exatamente 30 centavos.
 */
export function numeroParaTexto(valor: number): string {
  if (!Number.isFinite(valor)) return "";
  return valor.toFixed(4);
}
