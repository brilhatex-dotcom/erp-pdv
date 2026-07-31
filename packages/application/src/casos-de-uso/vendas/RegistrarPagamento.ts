import {
  type CodigoFormaPagamento,
  type Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  type Identificador,
  ok,
  type Pagamento,
  type Result,
} from "@erp/domain";

import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

export interface EntradaRegistrarPagamento {
  readonly vendaId: Identificador;
  readonly forma: CodigoFormaPagamento;
  readonly valor: Dinheiro;
  readonly autorizacao?: string | undefined;
  readonly parcelas?: number | undefined;
}

export interface SaidaRegistrarPagamento {
  readonly pagamento: Pagamento;
  readonly faltaPagar: Dinheiro;
  readonly troco: Dinheiro;
}

/**
 * Registra um pagamento na venda.
 *
 * Devolve **quanto falta** e **quanto é de troco** junto com o pagamento: são
 * exatamente os dois números que a tela do PDV precisa mostrar em seguida, e
 * obrigá-la a uma segunda consulta acrescentaria latência no caminho onde o
 * operador está com o cliente esperando.
 */
export class RegistrarPagamento {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(
    entrada: EntradaRegistrarPagamento,
  ): Promise<Result<SaidaRegistrarPagamento, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const venda = await repositorios.vendas.porId(entrada.vendaId);

      if (venda === undefined) {
        return err(
          new ErroNaoEncontrado("VENDA_NAO_ENCONTRADA", "Venda não encontrada.", {
            vendaId: entrada.vendaId.valor,
          }),
        );
      }

      const pagamento = venda.registrarPagamento(entrada.forma, entrada.valor, {
        autorizacao: entrada.autorizacao,
        parcelas: entrada.parcelas,
      });

      if (pagamento.isErr()) return err(pagamento.error);

      await repositorios.vendas.salvar(venda);

      return ok({
        pagamento: pagamento.unwrap(),
        faltaPagar: venda.faltaPagar,
        troco: venda.troco,
      });
    });
  }
}
