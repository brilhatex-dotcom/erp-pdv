import { z } from "zod";

/**
 * Escalares do fio — como cada tipo do domínio aparece dentro do JSON.
 *
 * O motivo de existirem aqui, e não em cada rota, é que o formato do fio é
 * **contrato**: mudar como um valor monetário viaja quebra todo cliente
 * instalado. Definir uma vez e derivar tipo, validação do servidor e validação
 * do cliente da mesma expressão elimina a divergência silenciosa entre eles
 * (ARQUITETURA.md §2.6).
 */

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inteiro em texto, com uma representação **única** por valor.
 *
 * `0199` e `-0` são recusados de propósito: duas grafias do mesmo valor
 * transformam comparação de texto em fonte de defeito, e a comparação de texto
 * acontece — em log, em teste e em chave de idempotência.
 */
const FORMATO_INTEIRO = /^(?:0|-?[1-9]\d*)$/;

const FORMATO_INTEIRO_NAO_NEGATIVO = /^(?:0|[1-9]\d*)$/;

const FORMATO_DATA_HORA =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Identificador de entidade — UUID, normalizado em minúsculas.
 *
 * A normalização é do servidor porque `A1B2...` e `a1b2...` são o mesmo
 * identificador, e recusar a variação maiúscula geraria chamado de suporte por
 * um detalhe que o sistema resolve sozinho.
 */
export const zIdentificador = z
  .string()
  .regex(FORMATO_UUID, "Identificador inválido.")
  .transform((valor) => valor.toLowerCase());

/**
 * Valor monetário: **centavos inteiros em texto**.
 *
 * Texto, e não número, porque `JSON.parse` transforma número em `double` — e
 * `double` é exatamente o que o ADR-0009 proíbe para dinheiro. Ver ADR-0019.
 */
export const zCentavos = z.string().regex(FORMATO_INTEIRO, "Valor monetário inválido.");

/** Valor monetário que não admite sinal: preço, total, troco. */
export const zCentavosNaoNegativos = z
  .string()
  .regex(FORMATO_INTEIRO_NAO_NEGATIVO, "Valor monetário não pode ser negativo.");

/** Quantidade: **milésimos inteiros em texto**, pelo mesmo motivo do dinheiro. */
export const zMilesimos = z.string().regex(FORMATO_INTEIRO, "Quantidade inválida.");

/** Quantidade que não admite sinal: peso vendido, saldo disponível. */
export const zMilesimosNaoNegativos = z
  .string()
  .regex(FORMATO_INTEIRO_NAO_NEGATIVO, "Quantidade não pode ser negativa.");

/**
 * Instante em ISO 8601 com fuso explícito.
 *
 * Fuso obrigatório: o servidor da loja e a estação podem estar em
 * configurações diferentes, e data sem fuso viraria divergência de um dia no
 * fechamento de caixa perto da meia-noite.
 */
export const zDataHora = z.string().regex(FORMATO_DATA_HORA, "Data e hora inválidas.");

/** Converte o texto do fio no inteiro correspondente. */
export function inteiroDeTexto(valor: string): bigint {
  return BigInt(valor);
}

/** Converte o inteiro do domínio no texto que trafega. */
export function textoDeInteiro(valor: bigint): string {
  return valor.toString();
}
