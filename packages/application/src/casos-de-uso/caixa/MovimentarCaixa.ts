import {
  type Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  type Identificador,
  type MovimentoCaixa,
  ok,
  type Result,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type {
  AutorizarOperacao,
  CredencialSupervisor,
} from "../acesso/AutorizarOperacao.js";

/**
 * Dinheiro entrando e saindo da gaveta fora da venda.
 *
 * ### Por que sangria e suprimento são casos de uso distintos
 *
 * Parecem simétricos e não são. **Sangria tira dinheiro** — é a operação que um
 * caixa mal-intencionado usaria, e por isso passa pela política de autorização
 * com limite por valor: acima do teto do papel, exige supervisor. Suprimento
 * põe dinheiro, o que ninguém faz para fraudar.
 *
 * Unificá-las num caso de uso com um `if` no tipo economizaria trinta linhas e
 * colocaria a decisão de segurança dentro de um ramo — o lugar de onde ela some
 * na primeira refatoração.
 *
 * ### A sessão é encontrada pela estação, não pelo identificador
 *
 * O PDV sabe em que estação está; ele não guarda o identificador da sessão. Se
 * a rota exigisse o id, a tela teria de buscá-lo antes de cada sangria — e uma
 * tela que erra esse id sangra o caixa de outra estação.
 */

export interface EntradaSangria {
  readonly estacaoId: Identificador;
  readonly operadorId: Identificador;
  readonly valor: Dinheiro;
  readonly motivo: string;
  /** Só quando a primeira tentativa devolveu `AUTORIZACAO_NECESSARIA`. */
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
}

export interface EntradaSuprimento {
  readonly estacaoId: Identificador;
  readonly operadorId: Identificador;
  readonly valor: Dinheiro;
  readonly motivo: string;
}

export class RegistrarSangria {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
    private readonly autorizar: AutorizarOperacao,
  ) {}

  async executar(entrada: EntradaSangria): Promise<Result<MovimentoCaixa, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const sessao = await repositorios.caixas.abertaNaEstacao(entrada.estacaoId);

      if (sessao === undefined) return err(semCaixa());

      // A autorização vem **antes** de mexer no agregado. Avaliar depois faria
      // a recusa acontecer sobre uma sessão já alterada em memória — e o
      // registro de auditoria descreveria um estado que nunca foi gravado.
      const decisao = await this.autorizar.executar(repositorios, {
        solicitanteId: entrada.operadorId,
        acao: { tipo: "SANGRIA", valor: entrada.valor },
        descricao: `Sangria de ${entrada.valor.formatar()}: ${entrada.motivo}`,
        credencialSupervisor: entrada.credencialSupervisor,
      });

      if (decisao.isErr()) return err(decisao.error);

      const movimento = sessao.registrarSangria(
        this.geradorId.proximo(),
        entrada.valor,
        entrada.motivo,
        entrada.operadorId,
        this.relogio.agora(),
      );

      if (movimento.isErr()) return err(movimento.error);

      await repositorios.caixas.salvar(sessao);
      await repositorios.outbox.enfileirar(sessao.coletarEventos());

      return ok(movimento.unwrap());
    });
  }
}

export class RegistrarSuprimento {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaSuprimento,
  ): Promise<Result<MovimentoCaixa, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const sessao = await repositorios.caixas.abertaNaEstacao(entrada.estacaoId);

      if (sessao === undefined) return err(semCaixa());

      const movimento = sessao.registrarSuprimento(
        this.geradorId.proximo(),
        entrada.valor,
        entrada.motivo,
        entrada.operadorId,
        this.relogio.agora(),
      );

      if (movimento.isErr()) return err(movimento.error);

      await repositorios.caixas.salvar(sessao);
      await repositorios.outbox.enfileirar(sessao.coletarEventos());

      return ok(movimento.unwrap());
    });
  }
}

function semCaixa(): ErroNaoEncontrado {
  return new ErroNaoEncontrado("CAIXA_NAO_ABERTO", "Não há caixa aberto nesta estação.");
}
