import type { DomainEvent } from "../shared/DomainEvent.js";
import type { Identificador } from "../shared/Identificador.js";

/**
 * Fatos de acesso — a matéria-prima da auditoria.
 *
 * O §7.5 exige auditar login, falha de login e bloqueio. Eles saem daqui como
 * eventos porque a auditoria **não pode** depender de quem chama: bastaria uma
 * rota nova esquecer de registrar para o rastro ficar incompleto exatamente no
 * caso que interessa. Sendo evento do agregado, o registro acontece na mesma
 * transação do fato, pela outbox (ADR-0006).
 *
 * Nenhum deles carrega credencial, nem hash, nem o valor digitado — só quem,
 * quando e por onde.
 */

/** Por onde a pessoa entrou. Distingue balcão de retaguarda na auditoria. */
export type MeioDeAcesso = "PIN" | "SENHA";

export interface AcessoAutorizado extends DomainEvent {
  readonly tipo: "AcessoAutorizado";
  readonly matricula: string;
  readonly meio: MeioDeAcesso;
}

export interface AcessoRecusado extends DomainEvent {
  readonly tipo: "AcessoRecusado";
  readonly matricula: string;
  readonly meio: MeioDeAcesso;
  /** Quantas falhas seguidas até esta. Revela ataque de força bruta em curso. */
  readonly tentativasSeguidas: number;
}

export interface UsuarioBloqueado extends DomainEvent {
  readonly tipo: "UsuarioBloqueado";
  readonly matricula: string;
  readonly bloqueadoAte: Date;
  /** Bloqueios seguidos sem acesso bem-sucedido entre eles. */
  readonly bloqueiosSeguidos: number;
}

export type EventoAcesso = AcessoAutorizado | AcessoRecusado | UsuarioBloqueado;

export function acessoAutorizado(
  usuarioId: Identificador,
  matricula: string,
  meio: MeioDeAcesso,
  ocorridoEm: Date,
): AcessoAutorizado {
  return { tipo: "AcessoAutorizado", agregadoId: usuarioId, matricula, meio, ocorridoEm };
}

export function acessoRecusado(
  usuarioId: Identificador,
  matricula: string,
  meio: MeioDeAcesso,
  tentativasSeguidas: number,
  ocorridoEm: Date,
): AcessoRecusado {
  return {
    tipo: "AcessoRecusado",
    agregadoId: usuarioId,
    matricula,
    meio,
    tentativasSeguidas,
    ocorridoEm,
  };
}

export function usuarioBloqueado(
  usuarioId: Identificador,
  matricula: string,
  bloqueadoAte: Date,
  bloqueiosSeguidos: number,
  ocorridoEm: Date,
): UsuarioBloqueado {
  return {
    tipo: "UsuarioBloqueado",
    agregadoId: usuarioId,
    matricula,
    bloqueadoAte,
    bloqueiosSeguidos,
    ocorridoEm,
  };
}
