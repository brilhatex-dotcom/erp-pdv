import {
  type Dinheiro,
  type DomainError,
  err,
  ErroConflito,
  type Identificador,
  ok,
  type Result,
  SessaoCaixa,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

export interface EntradaAbrirCaixa {
  readonly estacaoId: Identificador;
  readonly operadorId: Identificador;
  /** Dinheiro deixado na gaveta para dar troco. */
  readonly fundoTroco: Dinheiro;
}

/**
 * Abre o caixa da estação.
 *
 * É a primeira coisa do dia, e precisa ser **idempotente na prática**: se já
 * existe sessão aberta nesta estação, devolve conflito com a sessão existente
 * em vez de abrir uma segunda. Duas gavetas abertas na mesma estação
 * duplicariam o fundo de troco e o fechamento acusaria sobra que não existe.
 *
 * A garantia final não está aqui: está no índice parcial
 * `uq_sessao_aberta_por_estacao`. Esta verificação apenas troca um erro de
 * banco por uma mensagem que o operador entende.
 */
export class AbrirCaixa {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(entrada: EntradaAbrirCaixa): Promise<Result<SessaoCaixa, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const aberta = await repositorios.caixas.abertaNaEstacao(entrada.estacaoId);

      if (aberta !== undefined) {
        return err(
          new ErroConflito(
            "CAIXA_JA_ABERTO",
            "Já existe um caixa aberto nesta estação.",
            { sessaoId: aberta.id.valor },
          ),
        );
      }

      const sessao = SessaoCaixa.abrir({
        id: this.geradorId.proximo(),
        estacaoId: entrada.estacaoId,
        operadorId: entrada.operadorId,
        fundoTroco: entrada.fundoTroco,
        abertaEm: this.relogio.agora(),
      });

      if (sessao.isErr()) return err(sessao.error);

      const nova = sessao.unwrap();

      await repositorios.caixas.salvar(nova);
      await repositorios.outbox.enfileirar(nova.coletarEventos());

      return ok(nova);
    });
  }
}
