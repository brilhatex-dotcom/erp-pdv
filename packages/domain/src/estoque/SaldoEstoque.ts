import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import type { CodigoUnidade } from "../valores/UnidadeMedida.js";

import type { MovimentoEstoque } from "./MovimentoEstoque.js";
import { afetaCustoMedio } from "./TipoMovimento.js";

/**
 * Saldo de um produto — **projeção**, não estado guardado.
 *
 * O saldo é derivado da soma dos movimentos. Materializá-lo numa tabela é
 * otimização de leitura (ARQUITETURA.md §6.2, padrão Projection), nunca a
 * fonte da verdade: divergir a projeção do histórico é recuperável recalculando;
 * perder o histórico não é.
 *
 * A soma é **comutativa**: aplicar os mesmos movimentos em qualquer ordem
 * produz o mesmo saldo. É essa propriedade que faz duas estações de PDV
 * convergirem sem trava distribuída — a garantia central do ADR-0007.
 */
export class SaldoEstoque {
  readonly #produtoId: Identificador;
  readonly #unidade: CodigoUnidade;
  readonly #milesimos: bigint;
  readonly #custoMedio: Dinheiro;

  private constructor(
    produtoId: Identificador,
    unidade: CodigoUnidade,
    milesimos: bigint,
    custoMedio: Dinheiro,
  ) {
    this.#produtoId = produtoId;
    this.#unidade = unidade;
    this.#milesimos = milesimos;
    this.#custoMedio = custoMedio;
  }

  /** Saldo inicial de um produto que ainda não teve movimento. */
  static vazio(produtoId: Identificador, unidade: CodigoUnidade): SaldoEstoque {
    return new SaldoEstoque(produtoId, unidade, 0n, Dinheiro.zero());
  }

  /**
   * Reconstrói um saldo já materializado.
   *
   * Uso exclusivo do repositório. É o atalho que torna a projeção útil: sem
   * ele, ler o saldo exigiria somar todos os movimentos do produto, que é
   * exatamente o custo que a materialização existe para evitar (RNF-02).
   */
  static reconstituir(
    produtoId: Identificador,
    unidade: CodigoUnidade,
    milesimos: bigint,
    custoMedio: Dinheiro,
  ): SaldoEstoque {
    return new SaldoEstoque(produtoId, unidade, milesimos, custoMedio);
  }

  /**
   * Projeta o saldo a partir de uma lista de movimentos.
   *
   * A ordem só importa para o **custo médio**, que é histórico por natureza —
   * comprar caro depois de barato dá média diferente de comprar barato depois
   * de caro. A **quantidade** independe da ordem.
   */
  static projetar(
    produtoId: Identificador,
    unidade: CodigoUnidade,
    movimentos: readonly MovimentoEstoque[],
  ): Result<SaldoEstoque, ErroValidacao> {
    let saldo = SaldoEstoque.vazio(produtoId, unidade);

    for (const movimento of movimentos) {
      const resultado = saldo.aplicar(movimento);
      if (resultado.isErr()) {
        return err(resultado.error);
      }
      saldo = resultado.unwrap();
    }

    return ok(saldo);
  }

  /**
   * Aplica um movimento, devolvendo um saldo novo.
   *
   * Imutável de propósito: um saldo já calculado não muda por baixo de quem o
   * está lendo.
   */
  aplicar(movimento: MovimentoEstoque): Result<SaldoEstoque, ErroValidacao> {
    if (!movimento.produtoId.equals(this.#produtoId)) {
      return err(
        new ErroValidacao(
          "SALDO_PRODUTO_DIFERENTE",
          "O movimento não pertence a este produto.",
          {
            esperado: this.#produtoId.valor,
            recebido: movimento.produtoId.valor,
          },
        ),
      );
    }

    if (movimento.quantidade.unidade.codigo !== this.#unidade) {
      return err(
        new ErroValidacao(
          "SALDO_UNIDADE_DIFERENTE",
          "O movimento está em unidade diferente da do produto.",
          {
            esperada: this.#unidade,
            recebida: movimento.quantidade.unidade.codigo,
          },
        ),
      );
    }

    const novoMilesimos = this.#milesimos + movimento.delta;
    const custoMedio = this.#recalcularCustoMedio(movimento, novoMilesimos);

    return ok(
      new SaldoEstoque(this.#produtoId, this.#unidade, novoMilesimos, custoMedio),
    );
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get produtoId(): Identificador {
    return this.#produtoId;
  }

  get quantidade(): Quantidade {
    // A unidade já foi validada na entrada de cada movimento.
    return Quantidade.deMilesimos(this.#milesimos, this.#unidade).unwrap();
  }

  get milesimos(): bigint {
    return this.#milesimos;
  }

  /** Custo médio ponderado móvel, base do cálculo de margem. */
  get custoMedio(): Dinheiro {
    return this.#custoMedio;
  }

  /** Valor total imobilizado neste produto. */
  get valorEmEstoque(): Dinheiro {
    return this.#custoMedio.escalar(this.#milesimos, 1000n);
  }

  get estaZerado(): boolean {
    return this.#milesimos === 0n;
  }

  /**
   * Saldo negativo.
   *
   * Não é impossível nem necessariamente erro: acontece quando a venda é
   * lançada antes da entrada da nota de compra, o que é rotina em comércio de
   * bairro. Vira alerta na retaguarda, não bloqueio no caixa.
   */
  get estaNegativo(): boolean {
    return this.#milesimos < 0n;
  }

  /** Indica se o saldo está igual ou abaixo do mínimo configurado. */
  precisaRepor(minimo: Quantidade): boolean {
    return this.#milesimos <= minimo.milesimos;
  }

  /**
   * Verifica se dá para retirar a quantidade pedida.
   *
   * `permitirNegativo` é configuração da loja, e o padrão é **permitir**: o
   * princípio 1 diz que o PDV nunca para, e recusar a venda porque o cadastro
   * de estoque está atrasado é justamente parar a loja por um problema
   * administrativo. Quem controla estoque com rigor liga o bloqueio.
   */
  podeRetirar(
    quantidade: Quantidade,
    permitirNegativo = true,
  ): Result<void, ErroRegraNegocio> {
    if (quantidade.unidade.codigo !== this.#unidade) {
      return err(
        new ErroRegraNegocio(
          "ESTOQUE_UNIDADE_DIFERENTE",
          "A quantidade está em unidade diferente da do produto.",
          { esperada: this.#unidade, recebida: quantidade.unidade.codigo },
        ),
      );
    }

    if (permitirNegativo) {
      return ok(undefined);
    }

    if (this.#milesimos < quantidade.milesimos) {
      return err(
        new ErroRegraNegocio(
          "ESTOQUE_INSUFICIENTE",
          `Estoque insuficiente. Disponível: ${this.quantidade.formatar()}.`,
          {
            disponivel: this.#milesimos.toString(),
            solicitado: quantidade.milesimos.toString(),
          },
        ),
      );
    }

    return ok(undefined);
  }

  // ── Interno ────────────────────────────────────────────────────────────

  /**
   * Custo médio ponderado móvel.
   *
   * Entraram 10 a R$ 3,00 e depois 5 a R$ 4,00: o custo passa a ser R$ 3,33.
   * Só entrada de compra recalcula — saída consome pelo custo vigente, e é isso
   * que mantém a margem coerente com o que foi efetivamente pago.
   */
  #recalcularCustoMedio(movimento: MovimentoEstoque, novoMilesimos: bigint): Dinheiro {
    const custoEntrada = movimento.custoUnitario;

    if (!afetaCustoMedio(movimento.tipo) || custoEntrada === undefined) {
      return this.#custoMedio;
    }

    // Sem saldo positivo anterior não há o que ponderar: o custo passa a ser o
    // da entrada. Cobre o primeiro recebimento e o caso de saldo negativo.
    if (this.#milesimos <= 0n || novoMilesimos <= 0n) {
      return custoEntrada;
    }

    // Os pesos aqui são sempre positivos — o saldo anterior foi verificado
    // acima e a quantidade do movimento é validada na criação. `unwrapOr`
    // fecha o tipo sem deixar um ramo de erro que nenhum teste alcança.
    return Dinheiro.mediaPonderada([
      { valor: this.#custoMedio, peso: this.#milesimos },
      { valor: custoEntrada, peso: movimento.quantidade.milesimos },
    ]).unwrapOr(custoEntrada);
  }
}
