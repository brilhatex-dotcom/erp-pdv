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
  /**
   * Gerado pela estação antes do envio (UUIDv7, ADR-0008).
   *
   * É o que torna o primeiro bipe seguro de repetir: se a resposta se perder,
   * a estação manda o mesmo id, e recebe a mesma venda em vez de abrir uma
   * segunda — que ficaria esquecida no caixa, aberta e com número ocupado.
   * Ausente, o servidor gera.
   */
  readonly id?: Identificador | undefined;
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
      if (entrada.id !== undefined) {
        const existente = await repositorios.vendas.porId(entrada.id);

        if (existente !== undefined) {
          // Mesmo id de outra estação não é repetição: é colisão, ou alguém
          // tentando continuar a venda de outro caixa. Nos dois casos, não.
          if (!existente.estacaoId.equals(entrada.estacaoId)) {
            return err(
              new ErroRegraNegocio(
                "VENDA_DE_OUTRA_ESTACAO",
                "Esta venda pertence a outro caixa.",
                { vendaId: entrada.id.valor },
              ),
            );
          }

          return ok(existente);
        }
      }

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
        id: entrada.id ?? this.geradorId.proximo(),
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
