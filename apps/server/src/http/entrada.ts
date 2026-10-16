import { ehCodigoUnidade, Identificador, Quantidade } from "@erp/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * Peças de entrada que as rotas do balcão compartilham.
 *
 * Moram juntas porque "o que é uma quantidade válida no fio" ou "como chega a
 * credencial do supervisor" precisam ter uma resposta só: duas rotas que
 * aceitam formatos diferentes para a mesma coisa obrigam a tela a saber qual
 * é qual, e a primeira divergência vira chamado.
 */

/** Inteiro positivo em texto — dinheiro e quantidade nunca viram `number` no fio. */
export const zInteiroPositivo = z.string().regex(/^[1-9]\d{0,14}$/, "valor inválido");

/** Inteiro não negativo em texto: o desconto zero existe (é tirar o desconto). */
export const zInteiroNaoNegativo = z.string().regex(/^\d{1,15}$/, "valor inválido");

export const zQuantidadeNoFio = z.object({
  milesimos: zInteiroPositivo,
  unidade: z.string().min(1).max(6),
});

/**
 * Matrícula e PIN de quem libera, digitados no próprio caixa.
 *
 * Só chega na segunda tentativa, depois de a primeira responder
 * `AUTORIZACAO_NECESSARIA`. A sessão continua sendo do operador.
 */
export const zSupervisor = z
  .object({
    matricula: z.string().trim().min(1).max(20),
    pin: z.string().min(4).max(12),
  })
  .optional();

/**
 * Converte a quantidade do fio, ou diz que ela não serve.
 *
 * Unidade desconhecida é recusada em vez de assumida: adivinhar "UN" para uma
 * etiqueta de quilo faria a balança cobrar por peça.
 */
export function interpretarQuantidade(
  bruta: { readonly milesimos: string; readonly unidade: string } | undefined,
): Quantidade | undefined | "INVALIDA" {
  if (bruta === undefined) return undefined;

  const unidade = bruta.unidade.toUpperCase();
  if (!ehCodigoUnidade(unidade)) return "INVALIDA";

  const quantidade = Quantidade.deMilesimos(BigInt(bruta.milesimos), unidade);

  return quantidade.isOk() ? quantidade.unwrap() : "INVALIDA";
}

/** O identificador de um parâmetro de rota, ou `undefined` se não for um. */
export function identificadorDaRota(
  requisicao: FastifyRequest,
  nome = "id",
): Identificador | undefined {
  // Parâmetro de rota é sempre texto; ausente vira vazio, que o `criar` recusa.
  const bruto = (requisicao.params as Record<string, string | undefined>)[nome] ?? "";
  const identificador = Identificador.criar(bruto);

  return identificador.isOk() ? identificador.unwrap() : undefined;
}

/**
 * Identificador de um texto que o Zod **já validou** como UUID.
 *
 * O formato do Zod (com a variante conferida) é mais estrito que o do
 * `Identificador`, então aqui não sobra o que recusar. Um ramo de recusa que
 * nunca executa só esconderia qual das duas validações vale de verdade.
 */
export function identificadorValidado(bruto: string): Identificador {
  return Identificador.criar(bruto).unwrap();
}

export function identificadorValidadoOpcional(
  bruto: string | undefined,
): Identificador | undefined {
  return bruto === undefined ? undefined : identificadorValidado(bruto);
}

/** Número inteiro positivo de um parâmetro de rota (o item 3, o pagamento 0). */
export function numeroDaRota(
  requisicao: FastifyRequest,
  nome: string,
  minimo = 1,
): number | undefined {
  const bruto = (requisicao.params as Record<string, unknown>)[nome];
  const numero = z.coerce.number().int().min(minimo).max(9999).safeParse(bruto);

  return numero.success ? numero.data : undefined;
}

/**
 * Quem está autenticado.
 *
 * Sempre do token, nunca do corpo: aceitar `operadorId` na requisição
 * permitiria a qualquer estação atribuir uma operação a outra pessoa, e a
 * auditoria passaria a apontar quem não fez — pior que não ter auditoria,
 * porque parece prova.
 */
export function usuarioAutenticado(
  requisicao: FastifyRequest,
): Identificador | undefined {
  return requisicao.autenticado?.usuarioId;
}

export function recusar(resposta: FastifyReply, mensagem: string): FastifyReply {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
