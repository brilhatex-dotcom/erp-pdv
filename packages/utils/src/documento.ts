import { apenasAlfanumericos, apenasDigitos } from "./texto.js";

const PESOS_CPF_PRIMEIRO = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CPF_SEGUNDO = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CNPJ_PRIMEIRO = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_CNPJ_SEGUNDO = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * Valida um CPF pelos dígitos verificadores.
 *
 * Aceita com ou sem máscara. Rejeita sequências de dígito repetido
 * (`111.111.111-11`), que passam no cálculo mas não são CPFs reais — e são o
 * que aparece quando alguém quer "pular" o campo.
 */
export function ehCpfValido(valor: string): boolean {
  const digitos = apenasDigitos(valor);

  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const primeiro = calcularDigitoVerificador(digitos, PESOS_CPF_PRIMEIRO);
  if (primeiro !== valorNumerico(digitos, 9)) return false;

  const segundo = calcularDigitoVerificador(digitos, PESOS_CPF_SEGUNDO);
  return segundo === valorNumerico(digitos, 10);
}

/**
 * Valida um CNPJ, nos formatos **numérico** (legado) e **alfanumérico**.
 *
 * A Receita Federal passou a emitir CNPJ alfanumérico em 2026: os 12 primeiros
 * caracteres podem conter letras, e apenas os 2 dígitos verificadores
 * permanecem numéricos. O cálculo do DV substitui cada caractere pelo seu
 * código ASCII menos 48 — o que faz `0-9` valerem 0 a 9 e `A-Z` valerem 17 a 42.
 *
 * Validar apenas o formato numérico faria o sistema recusar CNPJs legítimos de
 * empresas abertas a partir de 2026, e a recusa apareceria na emissão fiscal —
 * ou seja, com a venda já feita.
 */
export function ehCnpjValido(valor: string): boolean {
  const caracteres = apenasAlfanumericos(valor);

  if (caracteres.length !== 14) return false;
  if (/^(.)\1{13}$/.test(caracteres)) return false;

  // Os dois dígitos verificadores são sempre numéricos, mesmo no alfanumérico.
  if (!/^\d{2}$/.test(caracteres.slice(12))) return false;

  const primeiro = calcularDigitoVerificador(caracteres, PESOS_CNPJ_PRIMEIRO);
  if (primeiro !== valorNumerico(caracteres, 12)) return false;

  const segundo = calcularDigitoVerificador(caracteres, PESOS_CNPJ_SEGUNDO);
  return segundo === valorNumerico(caracteres, 13);
}

/** Indica se o CNPJ usa o formato alfanumérico introduzido em 2026. */
export function ehCnpjAlfanumerico(valor: string): boolean {
  const caracteres = apenasAlfanumericos(valor);
  return caracteres.length === 14 && /[A-Z]/.test(caracteres.slice(0, 12));
}

/**
 * Calcula um dígito verificador pelo módulo 11.
 *
 * O mesmo cálculo serve para CPF e CNPJ — inclusive o alfanumérico — porque
 * ambos convertem o caractere em `ASCII − 48`. Para dígitos isso devolve o
 * próprio número (`'7'` → 7); para letras, o valor previsto pela Receita
 * (`'A'` → 17). Uma única implementação significa um único lugar para errar.
 *
 * O laço percorre `pesos.entries()` em vez de indexar por número: assim o peso
 * nunca é `undefined`, o que elimina um ramo defensivo que nenhum teste
 * conseguiria exercitar — o comprimento já foi validado por quem chama.
 */
function calcularDigitoVerificador(caracteres: string, pesos: readonly number[]): number {
  let soma = 0;
  for (const [posicao, peso] of pesos.entries()) {
    soma += (caracteres.charCodeAt(posicao) - 48) * peso;
  }

  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Valor numérico do dígito na posição informada. */
function valorNumerico(caracteres: string, posicao: number): number {
  return caracteres.charCodeAt(posicao) - 48;
}
