import { DomainError, type TipoErro } from "@erp/domain";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Corpo de erro da API.
 *
 * `mensagem` é escrita **para o operador** e vai para a tela. `codigo` é para o
 * cliente decidir o que fazer — abrir o modal de supervisor, por exemplo. Não
 * existe campo de stack trace: erro técnico na tela do caixa é veto do papel
 * UX (CLAUDE.md §9).
 */
export interface CorpoErro {
  readonly erro: {
    readonly codigo: string;
    readonly mensagem: string;
    /** Só o que o cliente precisa para reagir. Nunca dado interno. */
    readonly detalhes?: Readonly<Record<string, unknown>> | undefined;
  };
}

/**
 * Status HTTP por tipo de erro de domínio.
 *
 * O mapeamento mora aqui, e não no domínio, porque status HTTP é vocabulário de
 * transporte: o mesmo caso de uso serve a uma fila e a um job, onde 404 não
 * significa nada.
 */
const STATUS_POR_TIPO: Record<TipoErro, number> = {
  VALIDACAO: 400,
  REGRA_NEGOCIO: 422,
  NAO_ENCONTRADO: 404,
  NAO_AUTORIZADO: 403,
  CONFLITO: 409,
};

/** Códigos que exigem tratamento próprio, fora do mapa por tipo. */
const STATUS_POR_CODIGO: Readonly<Record<string, number>> = {
  // Credencial errada é 401, não 403: o cliente precisa saber que deve
  // reautenticar, e não que está autenticado sem permissão.
  CREDENCIAL_INVALIDA: 401,
  SESSAO_INVALIDA: 401,
  SESSAO_EXPIRADA: 401,
  SESSAO_REVOGADA: 401,
  SESSAO_REUSO_DETECTADO: 401,
  TOKEN_AUSENTE: 401,
  TOKEN_INVALIDO: 401,
  USUARIO_DESCONHECIDO: 401,
  // Bloqueio é 429: é limitação de tentativa, e o cliente pode tentar depois.
  USUARIO_BLOQUEADO: 429,
};

export function statusDe(erro: DomainError): number {
  return STATUS_POR_CODIGO[erro.codigo] ?? STATUS_POR_TIPO[erro.tipo];
}

export function corpoDe(erro: DomainError): CorpoErro {
  return {
    erro: {
      codigo: erro.codigo,
      mensagem: erro.mensagem,
      detalhes: detalhesPublicos(erro),
    },
  };
}

/** Responde um erro de domínio já traduzido. */
export async function responderErro(
  resposta: FastifyReply,
  erro: DomainError,
): Promise<void> {
  await resposta.status(statusDe(erro)).send(corpoDe(erro));
}

/**
 * O que dos detalhes pode atravessar a fronteira.
 *
 * Lista de permissão, nunca de bloqueio: `detalhes` foi projetado para o log e
 * carrega identificadores internos, valores de credencial e nomes de coluna.
 * Devolvê-lo inteiro entregaria de graça o mapa interno do sistema — e uma lista
 * de bloqueio esqueceria justamente o campo novo que alguém acabou de acrescentar.
 */
const DETALHES_PUBLICOS = new Set(["permissaoNecessaria", "disponivel", "bloqueadoAte"]);

function detalhesPublicos(
  erro: DomainError,
): Readonly<Record<string, unknown>> | undefined {
  if (erro.detalhes === undefined) return undefined;

  const publicos: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(erro.detalhes)) {
    if (DETALHES_PUBLICOS.has(chave)) publicos[chave] = valor;
  }

  return Object.keys(publicos).length > 0 ? publicos : undefined;
}

/**
 * Último anteparo: transforma qualquer exceção em resposta compreensível.
 *
 * Bug de programação vira 500 com mensagem genérica; o detalhe técnico vai para
 * o log do servidor, onde o suporte alcança. É o que permite diagnosticar
 * remotamente sem ir à loja — e sem despejar interno na tela do caixa.
 */
export function tratadorDeErro(
  erro: unknown,
  requisicao: FastifyRequest,
  resposta: FastifyReply,
): void {
  // `unknown`, e não `Error`: `DomainError` **não** estende `Error` por decisão
  // de projeto, e JavaScript deixa lançar qualquer coisa. Um anteparo que só
  // aceita `Error` mente sobre o que pode chegar até ele.
  if (erro instanceof DomainError) {
    void resposta.status(statusDe(erro)).send(corpoDe(erro));
    return;
  }

  // Validação de corpo/rota falhada pelo próprio Fastify.
  const comStatus = erro as { statusCode?: number };
  if (comStatus.statusCode !== undefined && comStatus.statusCode < 500) {
    void resposta.status(comStatus.statusCode).send({
      erro: { codigo: "REQUISICAO_INVALIDA", mensagem: "Requisição inválida." },
    });
    return;
  }

  requisicao.log.error({ err: erro }, "falha não tratada");

  void resposta.status(500).send({
    erro: {
      codigo: "FALHA_INTERNA",
      mensagem: "Não foi possível concluir a operação. Tente novamente.",
    },
  });
}
