import type { GeradorId, Relogio, UnitOfWork } from "@erp/application";
import type { Verificacao } from "@erp/contracts";
import { type DomainError, Identificador, type Result } from "@erp/domain";

import type { Ambiente } from "../composicao/ambiente.js";
import type { Container } from "../composicao/container.js";

/**
 * Dublês da fronteira HTTP.
 *
 * O servidor é levantado com estes em vez de banco real porque o que estes
 * testes verificam é **a fronteira**: status, envelope de erro, cabeçalho,
 * limite. Banco real aqui só acrescentaria lentidão e uma segunda causa
 * possível para cada falha. A integração de verdade tem o seu próprio teste.
 */

/** Relógio parado, para que a resposta de `/saude` seja verificável. */
export class RelogioFixo implements Relogio {
  constructor(private instante: Date) {}

  agora(): Date {
    return this.instante;
  }

  avancar(milissegundos: number): void {
    this.instante = new Date(this.instante.getTime() + milissegundos);
  }
}

/** Gera identificadores previsíveis, para o teste poder afirmar sobre eles. */
export class GeradorIdSequencial implements GeradorId {
  #proximo = 1;

  proximo(): Identificador {
    const sufixo = String(this.#proximo).padStart(12, "0");
    this.#proximo += 1;

    return Identificador.criar(`01952a3b-4c5d-7e8f-9a0b-${sufixo}`).unwrap();
  }
}

/** `UnitOfWork` que nunca é usada: as rotas desta etapa não tocam o banco. */
const unitOfWorkInerte: UnitOfWork = {
  transacao<T, E extends DomainError>(): Promise<Result<T, E>> {
    throw new Error("Nenhuma rota desta etapa abre transação.");
  },
};

export interface OpcoesContainerFalso {
  readonly banco?: Verificacao;
  readonly relogio?: Relogio;
}

export function criarContainerFalso(opcoes: OpcoesContainerFalso = {}): Container {
  return {
    relogio: opcoes.relogio ?? new RelogioFixo(new Date("2026-07-31T14:05:09.000Z")),
    geradorId: new GeradorIdSequencial(),
    unitOfWork: unitOfWorkInerte,

    verificarBanco(): Promise<Verificacao> {
      return Promise.resolve(opcoes.banco ?? { ok: true, latenciaMs: 1 });
    },

    encerrar(): Promise<void> {
      return Promise.resolve();
    },
  };
}

export function criarAmbienteFalso(sobrescritas: Partial<Ambiente> = {}): Ambiente {
  return {
    modo: "test",
    endereco: "127.0.0.1",
    porta: 0,
    urlBanco: "postgresql://erp:segredo@localhost:55432/erp_teste",
    // `silent`: o teste que exercita falha de servidor imprimiria pilha no meio
    // do relatório, e ruído esperado esconde a falha que importa.
    nivelLog: "silent",
    registrarConsultasSql: false,
    limiteRequisicoesPorMinuto: 600,
    tempoLimiteEncerramentoMs: 1_000,
    ...sobrescritas,
  };
}
