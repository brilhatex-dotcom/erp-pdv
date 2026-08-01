import {
  type CodigoFormaPagamento,
  type ConferenciaCaixa,
  type Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type Identificador,
  ok,
  type Result,
  type SessaoCaixa,
} from "@erp/domain";

import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

/**
 * Fecha o caixa da estação e produz a conferência.
 *
 * ### A contagem chega de fora, e é isso que faz a conferência valer
 *
 * O caso de uso **não sugere** o valor esperado a quem conta. Quem conta digita
 * o que achou na gaveta, e só então o sistema calcula a diferença. Uma tela que
 * mostra "esperado: R$ 1.240,00" antes da contagem transforma a conferência em
 * teatro: o operador confirma o número que está na frente dele, e a falta que o
 * controle existe para achar passa despercebida todos os dias.
 *
 * ### Divergência não bloqueia
 *
 * É decisão do domínio (`SessaoCaixa.fechar`) e vale repetir aqui, porque é
 * contraintuitivo: caixa que não fecha por diferença deixa a loja com a gaveta
 * aberta e o operador sem saída — e a diferença continua existindo. Ela é
 * registrada, e o gerente resolve.
 *
 * ### Venda offline pendente **bloqueia**
 *
 * Esta é a exceção, e por um motivo diferente: a venda que ainda está na fila
 * da estação não entrou no esperado. Fechar assim produz uma falta que não é
 * falta — e ninguém consegue explicar de onde veio, porque o dinheiro está
 * certo na gaveta. Diferente da divergência real, esta some sozinha: basta a
 * estação sincronizar.
 */

export interface EntradaFecharCaixa {
  readonly estacaoId: Identificador;
  readonly contadoEmDinheiro: Dinheiro;
  readonly contagemPorForma?: Partial<Record<CodigoFormaPagamento, Dinheiro>> | undefined;
  /**
   * Quantas vendas a estação ainda não conseguiu enviar.
   *
   * Vem do PDV, que é quem conhece a própria fila. O servidor não tem como
   * saber: uma venda que nunca chegou não deixa rastro nele.
   */
  readonly vendasPendentesNaEstacao?: number | undefined;
}

export interface ResultadoFechamento {
  readonly sessao: SessaoCaixa;
  readonly conferencia: ConferenciaCaixa;
}

export class FecharCaixa {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
  ) {}

  async executar(
    entrada: EntradaFecharCaixa,
  ): Promise<Result<ResultadoFechamento, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const sessao = await repositorios.caixas.abertaNaEstacao(entrada.estacaoId);

      if (sessao === undefined) {
        return err(
          new ErroNaoEncontrado("CAIXA_NAO_ABERTO", "Não há caixa aberto nesta estação."),
        );
      }

      const pendentes = entrada.vendasPendentesNaEstacao ?? 0;

      if (pendentes > 0) {
        return err(
          new ErroRegraNegocio(
            "CAIXA_COM_VENDAS_PENDENTES",
            pendentes === 1
              ? "Há 1 venda ainda não enviada ao servidor. Aguarde a sincronização para fechar."
              : `Há ${String(pendentes)} vendas ainda não enviadas ao servidor. Aguarde a sincronização para fechar.`,
            { pendentes },
          ),
        );
      }

      const conferencia = sessao.fechar(
        entrada.contadoEmDinheiro,
        this.relogio.agora(),
        entrada.contagemPorForma,
      );

      if (conferencia.isErr()) return err(conferencia.error);

      await repositorios.caixas.salvar(sessao);
      await repositorios.outbox.enfileirar(sessao.coletarEventos());

      return ok({ sessao, conferencia: conferencia.unwrap() });
    });
  }
}
