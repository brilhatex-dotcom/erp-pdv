/**
 * O que o operador digitou no campo de código, interpretado.
 *
 * Um campo só para tudo — leitor de código de barras, código interno, "3 ×
 * código" e nome do produto. É o que deixa o foco parado num lugar a venda
 * inteira: o operador nunca precisa escolher em que campo digitar.
 *
 * Esta função só **lê** o texto. Se o código existe, quem diz é o servidor.
 */

export type LeituraDoCampo =
  | { readonly tipo: "VAZIO" }
  | {
      readonly tipo: "CODIGO";
      readonly codigo: string;
      /** Milésimos na unidade do produto. Ausente: um. */
      readonly multiplicador?: string | undefined;
      /** Tem letra: se o código não existir, vale procurar pelo nome. */
      readonly podeSerNome: boolean;
    }
  | { readonly tipo: "INVALIDA"; readonly mensagem: string };

/** Até 3 casas: `"0,5"` → `"500"`; `"3"` → `"3000"`. */
export function milesimosDoTexto(texto: string): string | undefined {
  const limpo = texto.trim().replace(".", ",");
  if (!/^\d{1,6}(,\d{1,3})?$/.test(limpo)) return undefined;

  const [inteiro = "0", fracao = ""] = limpo.split(",");
  const milesimos = BigInt(inteiro) * 1000n + BigInt(fracao.padEnd(3, "0") || "0");

  return milesimos > 0n ? milesimos.toString() : undefined;
}

export function interpretarLeitura(texto: string): LeituraDoCampo {
  const limpo = texto.trim();
  if (limpo === "") return { tipo: "VAZIO" };

  const asterisco = limpo.indexOf("*");

  if (asterisco === -1) {
    return { tipo: "CODIGO", codigo: limpo, podeSerNome: /[a-zà-ú]/i.test(limpo) };
  }

  const multiplicador = milesimosDoTexto(limpo.slice(0, asterisco));
  const codigo = limpo.slice(asterisco + 1).trim();

  if (multiplicador === undefined) {
    return {
      tipo: "INVALIDA",
      mensagem: "Antes do * vai a quantidade. Exemplo: 3*7891000315507.",
    };
  }

  if (codigo === "") {
    return {
      tipo: "INVALIDA",
      mensagem: "Depois do * bipe ou digite o código do produto.",
    };
  }

  return {
    tipo: "CODIGO",
    codigo,
    multiplicador,
    podeSerNome: /[a-zà-ú]/i.test(codigo),
  };
}
