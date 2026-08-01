import {
  type Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type Identificador,
  MovimentoEstoque,
  ok,
  type Result,
  type Titulo,
  type Venda,
} from "@erp/domain";

import {
  gerarTitulosDaVenda,
  type PedidoDeCrediario,
} from "../financeiro/gerarTitulosDaVenda.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";

export interface EntradaFinalizarVenda {
  readonly vendaId: Identificador;
  /**
   * Como o crediário desta venda vira título.
   *
   * Ausente significa **uma parcela** — a caderneta clássica, em que o cliente
   * leva hoje e acerta no mês que vem, podendo pagar em pedaços. Só faz
   * diferença quando há pagamento em crediário; nas outras vendas é ignorado.
   */
  readonly crediario?: PedidoDeCrediario | undefined;
}

export interface SaidaFinalizarVenda {
  readonly venda: Venda;
  /** Troco a devolver. Zero na maioria das vendas. */
  readonly troco: Dinheiro;
  /** Contas a receber geradas pelo crediário. Vazio na maioria das vendas. */
  readonly titulos: readonly Titulo[];
}

/**
 * Fecha a venda e propaga suas consequências.
 *
 * É o caso de uso que costura o sistema, e tudo acontece **numa transação só**:
 *
 * 1. a venda é finalizada (o desconto é rateado entre os itens);
 * 2. cada item gera um movimento de saída de estoque;
 * 3. o caixa registra os valores por forma de pagamento;
 * 4. o crediário, se houver, vira conta a receber;
 * 5. os eventos vão para a outbox.
 *
 * Se qualquer passo falhar, **nada acontece**. Meio caminho aqui é estoque
 * baixado de venda que não existe, ou dinheiro no caixa sem venda
 * correspondente — os dois indefensáveis numa conferência.
 *
 * Repare no que este caso de uso **não** faz: não emite documento fiscal e não
 * imprime. Ele publica `VendaFinalizada`, e quem precisa reage (ADR-0006,
 * ADR-0016). É isso que permite o módulo fiscal ser opcional sem um único `if`
 * aqui dentro.
 *
 * A **conta a receber**, ao contrário, entra na transação. Ela não depende de
 * rede externa nem é opcional: é consequência obrigatória da venda a prazo, e
 * venda gravada sem o fiado correspondente é mercadoria entregue sem registro
 * da dívida. Mesmo motivo de estoque e caixa estarem aqui (ADR-0025).
 */
export class FinalizarVenda {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaFinalizarVenda,
  ): Promise<Result<SaidaFinalizarVenda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const venda = await repositorios.vendas.porId(entrada.vendaId);

      if (venda === undefined) {
        return err(
          new ErroNaoEncontrado("VENDA_NAO_ENCONTRADA", "Venda não encontrada.", {
            vendaId: entrada.vendaId.valor,
          }),
        );
      }

      const sessao = await repositorios.caixas.porId(venda.sessaoCaixaId);

      if (sessao === undefined) {
        return err(
          new ErroNaoEncontrado(
            "CAIXA_NAO_ENCONTRADO",
            "A sessão de caixa desta venda não foi encontrada.",
            { sessaoCaixaId: venda.sessaoCaixaId.valor },
          ),
        );
      }

      if (!sessao.estaAberta) {
        return err(
          new ErroRegraNegocio(
            "CAIXA_JA_FECHADO",
            "O caixa desta venda já foi fechado.",
            { sessaoCaixaId: sessao.id.valor },
          ),
        );
      }

      const agora = this.relogio.agora();

      const finalizada = venda.finalizar(agora);
      if (finalizada.isErr()) return err(finalizada.error);

      const baixa = await this.#baixarEstoque(repositorios, venda, agora);
      /* v8 ignore next -- inalcançável: item de venda garante quantidade positiva */
      if (baixa.isErr()) return err(baixa.error);

      const registro = sessao.registrarVenda({
        vendaId: venda.id,
        total: venda.total,
        pagamentos: venda.pagamentos.map((pagamento) => ({
          forma: pagamento.forma.codigo,
          valor: pagamento.valor,
        })),
        troco: venda.troco,
      });

      /* v8 ignore next -- inalcançável: o caixa foi verificado como aberto acima */
      if (registro.isErr()) return err(registro.error);

      const titulos = await gerarTitulosDaVenda(repositorios, this.geradorId, {
        venda,
        momento: agora,
        crediario: entrada.crediario,
      });

      if (titulos.isErr()) return err(titulos.error);

      await repositorios.vendas.salvar(venda);
      await repositorios.caixas.salvar(sessao);

      // Na MESMA transação: ou a venda e o evento existem, ou nenhum dos dois.
      await repositorios.outbox.enfileirar(venda.coletarEventos());

      return ok({ venda, troco: venda.troco, titulos: titulos.unwrap() });
    });
  }

  /** Gera um movimento de saída por item vendido. */
  async #baixarEstoque(
    repositorios: Repositorios,
    venda: Venda,
    agora: Date,
  ): Promise<Result<void, DomainError>> {
    for (const item of venda.itens) {
      const movimento = MovimentoEstoque.criar({
        id: this.geradorId.proximo(),
        produtoId: item.produtoId,
        tipo: "SAIDA",
        quantidade: item.quantidade,
        origem: { tipo: "VENDA", documentoId: venda.id },
        usuarioId: venda.operadorId,
        ocorridoEm: agora,
      });

      /* v8 ignore next -- inalcançável: VendaItem recusa quantidade não positiva */
      if (movimento.isErr()) return err(movimento.error);

      await repositorios.estoque.registrar(movimento.unwrap());
    }

    return ok(undefined);
  }
}
