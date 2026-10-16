import {
  type DomainError,
  err,
  ErroRegraNegocio,
  type Identificador,
  ok,
  type Result,
  type Venda,
} from "@erp/domain";

import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import { carregarVenda } from "./apoio.js";

export interface EntradaSuspenderVenda {
  readonly vendaId: Identificador;
  /** Como a venda aparece na lista: "Dona Maria", "mesa 3". */
  readonly rotulo?: string | undefined;
}

export interface EntradaRetomarVenda {
  readonly vendaId: Identificador;
  /** A estação que retoma. A venda guardada continua sendo do caixa dela. */
  readonly estacaoId: Identificador;
}

/**
 * Guarda a venda para depois — a cliente que foi buscar a carteira no carro.
 *
 * A venda guardada sai da frente do operador, que atende o próximo da fila, e
 * continua no servidor: um F5 ou a queda da estação não a perdem.
 */
export class SuspenderVenda {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
  ) {}

  async executar(entrada: EntradaSuspenderVenda): Promise<Result<Venda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();

      const guardada = venda.suspender(this.relogio.agora(), entrada.rotulo);
      if (guardada.isErr()) return err(guardada.error);

      await repositorios.vendas.salvar(venda);

      return ok(venda);
    });
  }
}

/**
 * Traz de volta uma venda guardada.
 *
 * Só no caixa que a guardou, e só enquanto ele está aberto: o dinheiro dela
 * entra na gaveta daquela sessão. Retomar num caixa fechado concluiria uma
 * venda num turno já conferido, e o fechamento de ontem mudaria hoje.
 */
export class RetomarVenda {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(entrada: EntradaRetomarVenda): Promise<Result<Venda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();

      if (!venda.estacaoId.equals(entrada.estacaoId)) {
        return err(
          new ErroRegraNegocio(
            "VENDA_DE_OUTRA_ESTACAO",
            "Esta venda foi guardada em outro caixa. Retome-a lá.",
            { vendaId: venda.id.valor },
          ),
        );
      }

      const sessao = await repositorios.caixas.porId(venda.sessaoCaixaId);

      if (sessao?.estaAberta !== true) {
        return err(
          new ErroRegraNegocio(
            "VENDA_DE_CAIXA_FECHADO",
            "Esta venda é de um caixa que já foi fechado e não pode mais ser concluída.",
            { vendaId: venda.id.valor },
          ),
        );
      }

      const retomada = venda.retomar();
      if (retomada.isErr()) return err(retomada.error);

      await repositorios.vendas.salvar(venda);

      return ok(venda);
    });
  }
}
