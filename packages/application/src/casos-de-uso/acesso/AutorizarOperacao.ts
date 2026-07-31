import {
  type AcaoSolicitada,
  avaliar,
  type DomainError,
  err,
  ErroNaoAutorizado,
  type Identificador,
  Matricula,
  ok,
  operacaoAutorizadaPorSupervisor,
  type Permissao,
  podeAutorizar,
  type Result,
} from "@erp/domain";

import type { Hasher } from "../../portas/infraestrutura/Hasher.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";

/** Credencial que o supervisor digita no modal, sem trocar a sessão. */
export interface CredencialSupervisor {
  readonly matricula: string;
  readonly pin: string;
}

export interface EntradaAutorizar {
  readonly solicitanteId: Identificador;
  readonly acao: AcaoSolicitada;
  /** Texto que vai para a auditoria: "Desconto de 20% no item 3". */
  readonly descricao: string;
  /** Informada só quando a operação exigiu liberação. */
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
}

/**
 * Decide, e quando necessário registra quem liberou.
 *
 * ### Por que a autorização acontece aqui e não na rota
 *
 * A decisão é regra de negócio: envolve papel, limite por valor e a distinção
 * entre "não pode" e "não pode sozinho". Numa rota HTTP, ela ficaria fora do
 * domínio e não teria como ser testada sem subir um servidor — e é a regra que
 * decide quem mexe no dinheiro.
 *
 * ### A sessão nunca troca
 *
 * O supervisor digita a credencial num modal e a operação segue **em nome do
 * operador**. É a diferença entre uma auditoria que serve e uma que mente: se o
 * supervisor logasse no lugar dele, a venda inteira passaria a ser atribuída à
 * pessoa errada, e o rastro do que realmente aconteceu se perderia.
 */
export class AutorizarOperacao {
  constructor(
    private readonly relogio: Relogio,
    private readonly hasher: Hasher,
  ) {}

  async executar(
    repositorios: Repositorios,
    entrada: EntradaAutorizar,
  ): Promise<Result<void, DomainError>> {
    const agora = this.relogio.agora();
    const solicitante = await repositorios.usuarios.porId(entrada.solicitanteId);

    if (solicitante === undefined) {
      return err(new ErroNaoAutorizado("USUARIO_DESCONHECIDO", "Sessão inválida."));
    }

    const decisao = avaliar(solicitante, entrada.acao);

    if (decisao.tipo === "PERMITIDO") return ok(undefined);

    if (decisao.tipo === "NEGADO") {
      return err(new ErroNaoAutorizado("OPERACAO_NEGADA", decisao.motivo));
    }

    const credencial = entrada.credencialSupervisor;

    if (credencial === undefined) {
      // Não é erro ainda: é o sinal para o PDV abrir o modal de supervisor.
      // O código diferencia isso de uma negação para que a interface saiba que
      // existe caminho adiante, em vez de só mostrar "não pode".
      return err(
        new ErroNaoAutorizado("AUTORIZACAO_NECESSARIA", decisao.motivo, {
          permissaoNecessaria: decisao.permissaoNecessaria,
        }),
      );
    }

    const supervisor = await this.#conferirSupervisor(repositorios, credencial, agora);
    if (supervisor.isErr()) return err(supervisor.error);

    const autorizador = supervisor.unwrap();

    if (!podeAutorizar(autorizador, decisao, entrada.acao)) {
      return err(
        new ErroNaoAutorizado(
          "SUPERVISOR_SEM_ALCADA",
          "Este supervisor não pode liberar esta operação.",
          { permissaoNecessaria: decisao.permissaoNecessaria },
        ),
      );
    }

    await repositorios.outbox.enfileirar([
      operacaoAutorizadaPorSupervisor(
        solicitante.id,
        autorizador.id,
        decisao.permissaoNecessaria,
        entrada.descricao,
        agora,
      ),
    ]);

    return ok(undefined);
  }

  /**
   * Confere a credencial do supervisor com o mesmo rigor de um login.
   *
   * Bloqueio e tentativa falha contam igual: o modal de supervisor não pode
   * virar a porta dos fundos por onde se testa PIN sem limite.
   */
  async #conferirSupervisor(
    repositorios: Repositorios,
    credencial: CredencialSupervisor,
    agora: Date,
  ): Promise<
    Result<
      NonNullable<Awaited<ReturnType<Repositorios["usuarios"]["porId"]>>>,
      DomainError
    >
  > {
    const matricula = Matricula.criar(credencial.matricula);

    if (matricula.isErr()) {
      await this.hasher.gastarTempoEquivalente();
      return err(supervisorInvalido());
    }

    const supervisor = await repositorios.usuarios.porMatricula(matricula.unwrap());

    if (supervisor === undefined || supervisor.hashPin === undefined) {
      await this.hasher.gastarTempoEquivalente();
      return err(supervisorInvalido());
    }

    const permitido = supervisor.podeTentarAcesso(agora);
    if (permitido.isErr()) return err(permitido.error);

    const confere = await this.hasher.confere(credencial.pin, supervisor.hashPin);

    if (!confere) {
      supervisor.registrarTentativaFalha(agora);
      await repositorios.usuarios.salvar(supervisor);
      await repositorios.outbox.enfileirar(supervisor.coletarEventos());
      return err(supervisorInvalido());
    }

    return ok(supervisor);
  }
}

/** Permissão exigida do supervisor, exposta para a interface montar o modal. */
export type PermissaoDeAutorizacao = Permissao;

function supervisorInvalido(): ErroNaoAutorizado {
  return new ErroNaoAutorizado(
    "SUPERVISOR_CREDENCIAL_INVALIDA",
    "Matrícula ou PIN do supervisor incorreto.",
  );
}
