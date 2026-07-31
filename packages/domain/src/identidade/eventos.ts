import type { DomainEvent } from "../shared/DomainEvent.js";
import type { Identificador } from "../shared/Identificador.js";

import type { Permissao } from "./Permissao.js";

/**
 * Tentativa de acesso recusada.
 *
 * Registrada **sempre**, inclusive quando não houve bloqueio. Uma tentativa
 * isolada parece um dedo errado; a mesma tentativa repetida em várias contas na
 * mesma hora é alguém testando PINs — e esse padrão só aparece se cada evento
 * tiver sido gravado.
 */
export interface TentativaRecusada extends DomainEvent {
  readonly tipo: "TentativaDeAcessoRecusada";
  readonly matricula: string;
  readonly tentativasSeguidas: number;
}

export function tentativaRecusada(
  usuarioId: Identificador,
  matricula: string,
  tentativasSeguidas: number,
  ocorridoEm: Date,
): TentativaRecusada {
  return {
    tipo: "TentativaDeAcessoRecusada",
    agregadoId: usuarioId,
    matricula,
    tentativasSeguidas,
    ocorridoEm,
  };
}

/** Credencial bloqueada por excesso de tentativas. */
export interface CredencialBloqueada extends DomainEvent {
  readonly tipo: "CredencialBloqueada";
  readonly matricula: string;
  readonly minutos: number;
  readonly bloqueadoAte: Date;
}

export function credencialBloqueada(
  usuarioId: Identificador,
  matricula: string,
  minutos: number,
  bloqueadoAte: Date,
  ocorridoEm: Date,
): CredencialBloqueada {
  return {
    tipo: "CredencialBloqueada",
    agregadoId: usuarioId,
    matricula,
    minutos,
    bloqueadoAte,
    ocorridoEm,
  };
}

/**
 * Operação liberada por um supervisor.
 *
 * Carrega **os dois** usuários. É o que responde, meses depois, quem pediu o
 * desconto de 40% e quem autorizou — pergunta que aparece exatamente quando a
 * margem do mês não fecha.
 */
export interface OperacaoAutorizadaPorSupervisor extends DomainEvent {
  readonly tipo: "OperacaoAutorizadaPorSupervisor";
  readonly solicitanteId: Identificador;
  readonly autorizadorId: Identificador;
  readonly permissao: Permissao;
  /** O que estava sendo tentado, em texto legível na tela de auditoria. */
  readonly descricao: string;
}

export function operacaoAutorizadaPorSupervisor(
  solicitanteId: Identificador,
  autorizadorId: Identificador,
  permissao: Permissao,
  descricao: string,
  ocorridoEm: Date,
): OperacaoAutorizadaPorSupervisor {
  return {
    tipo: "OperacaoAutorizadaPorSupervisor",
    agregadoId: solicitanteId,
    solicitanteId,
    autorizadorId,
    permissao,
    descricao,
    ocorridoEm,
  };
}

export type EventoIdentidade =
  TentativaRecusada | CredencialBloqueada | OperacaoAutorizadaPorSupervisor;
