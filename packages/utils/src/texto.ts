/** Mantém apenas os dígitos de `0` a `9`. */
export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Mantém apenas letras `A-Z` e dígitos, convertendo letras para maiúsculas. */
export function apenasAlfanumericos(valor: string): string {
  return valor.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Normaliza texto para busca: sem acento, sem caixa, sem espaço duplicado.
 *
 * O operador digita "acucar" e precisa encontrar "Açúcar". Exigir acento numa
 * busca de balcão é falha de produto, não do usuário.
 */
export function normalizarParaBusca(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normaliza um campo opcional: ausente e vazio significam a mesma coisa.
 *
 * Sem isto, um formulário que envia `""` para "não informado" grava string
 * vazia no banco, e a consulta `WHERE apelido IS NULL` deixa de encontrar
 * justamente os registros sem apelido.
 */
export function textoOpcional(bruto: string | undefined): string | undefined {
  const valor = bruto?.trim();
  return valor === undefined || valor === "" ? undefined : valor;
}

/** Repete `caractere` à esquerda até `valor` atingir `tamanho`. */
export function preencherEsquerda(
  valor: string,
  tamanho: number,
  caractere: string,
): string {
  return valor.padStart(tamanho, caractere);
}
