import {
  type DomainError,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type Identificador,
  ok,
  type Result,
  type Venda,
} from "@erp/domain";

import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import { carregarVenda } from "./apoio.js";

export interface EntradaIdentificarCliente {
  readonly vendaId: Identificador;
  /** Ausente tira o cliente da venda. */
  readonly clienteId?: Identificador | undefined;
}

/**
 * Põe — ou tira — o cliente da venda.
 *
 * Opcional, sempre: a venda de balcão é anônima, e exigir cliente para vender
 * um pão é o tipo de pergunta que faz a fila andar devagar. Ele entra quando
 * serve a alguma coisa — o fiado, o histórico de compras, a nota com CPF.
 *
 * Cliente desativado não entra: a loja o desativou por um motivo, e o caso
 * clássico é o mau pagador que continuaria comprando fiado.
 */
export class IdentificarCliente {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(
    entrada: EntradaIdentificarCliente,
  ): Promise<Result<Venda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();

      if (entrada.clienteId !== undefined) {
        const cliente = await repositorios.clientes.porId(entrada.clienteId);

        if (cliente === undefined) {
          return err(
            new ErroNaoEncontrado("CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.", {
              clienteId: entrada.clienteId.valor,
            }),
          );
        }

        if (!cliente.ativo) {
          return err(
            new ErroRegraNegocio(
              "CLIENTE_INATIVO",
              `O cadastro de ${cliente.exibicao} está desativado.`,
              { clienteId: entrada.clienteId.valor },
            ),
          );
        }
      }

      const identificada = venda.identificarCliente(entrada.clienteId);
      if (identificada.isErr()) return err(identificada.error);

      await repositorios.vendas.salvar(venda);

      return ok(venda);
    });
  }
}
