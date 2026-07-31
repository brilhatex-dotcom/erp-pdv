import {
  type DomainError,
  err,
  ErroRegraNegocio,
  type Identificador,
  ok,
  type Result,
  Venda,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

export interface EntradaIniciarVenda {
  readonly estacaoId: Identificador;
  readonly operadorId: Identificador;
  readonly clienteId?: Identificador | undefined;
}

/**
 * Abre uma venda na estação.
 *
 * Exige **caixa aberto**: venda sem sessão de caixa não tem onde creditar o
 * dinheiro, e o fechamento do dia não fecharia. O erro é explícito para que a
 * tela do PDV possa oferecer a abertura de caixa em vez de só recusar.
 */
export class IniciarVenda {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(entrada: EntradaIniciarVenda): Promise<Result<Venda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const sessao = await repositorios.caixas.abertaNaEstacao(entrada.estacaoId);

      if (sessao === undefined) {
        return err(
          new ErroRegraNegocio(
            "CAIXA_FECHADO",
            "Abra o caixa antes de iniciar uma venda.",
            { estacaoId: entrada.estacaoId.valor },
          ),
        );
      }

      const numero = await repositorios.vendas.proximoNumero(entrada.estacaoId);

      const venda = Venda.iniciar({
        id: this.geradorId.proximo(),
        numero,
        sessaoCaixaId: sessao.id,
        operadorId: entrada.operadorId,
        estacaoId: entrada.estacaoId,
        clienteId: entrada.clienteId,
        abertaEm: this.relogio.agora(),
      });

      /* v8 ignore next -- inalcançável: proximoNumero nunca devolve menos que 1 */
      if (venda.isErr()) return err(venda.error);

      await repositorios.vendas.salvar(venda.unwrap());

      return ok(venda.unwrap());
    });
  }
}
