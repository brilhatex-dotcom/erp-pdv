import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import type { Quantidade } from "../valores/Quantidade.js";

/**
 * Retrato do produto no instante da venda.
 *
 * Descrição e preço são **copiados**, não referenciados. Se o produto mudar de
 * preço amanhã, a venda de hoje continua valendo o que foi cobrado — e o cupom
 * reimpresso mostra o mesmo valor do original. Referenciar o cadastro faria o
 * histórico mudar retroativamente, o que além de errado é indefensável numa
 * fiscalização.
 */
export interface DadosItemVenda {
  readonly produtoId: Identificador;
  readonly descricao: string;
  readonly quantidade: Quantidade;
  readonly precoUnitario: Dinheiro;
  /**
   * Custo da unidade **no instante da venda**, congelado como o preço.
   *
   * É o que permite responder "quanto eu ganhei em julho" em dezembro: o custo
   * do cadastro muda a cada compra, e calcular a margem de uma venda antiga com
   * o custo de hoje produz um lucro que nunca existiu. Ausente quando a loja
   * ainda não informou custo nenhum — e aí a margem dessa venda é desconhecida,
   * não zero.
   */
  readonly custoUnitario?: Dinheiro | undefined;
}

/**
 * Item de uma venda.
 *
 * Carrega dois descontos distintos, e a diferença importa para o XML fiscal:
 * o **desconto do item** foi dado nele diretamente; o **desconto rateado** é a
 * parcela que cabe a ele do desconto concedido na venda inteira.
 */
export class VendaItem {
  readonly #numero: number;
  readonly #produtoId: Identificador;
  readonly #descricao: string;
  #quantidade: Quantidade;
  readonly #precoUnitario: Dinheiro;
  readonly #custoUnitario: Dinheiro | undefined;
  #desconto: Dinheiro;
  #descontoRateado: Dinheiro;

  private constructor(numero: number, dados: DadosItemVenda) {
    this.#numero = numero;
    this.#produtoId = dados.produtoId;
    this.#descricao = dados.descricao.trim();
    this.#quantidade = dados.quantidade;
    this.#precoUnitario = dados.precoUnitario;
    this.#custoUnitario = dados.custoUnitario;
    this.#desconto = Dinheiro.zero();
    this.#descontoRateado = Dinheiro.zero();
  }

  static criar(numero: number, dados: DadosItemVenda): Result<VendaItem, ErroValidacao> {
    if (!Number.isInteger(numero) || numero < 1) {
      return err(
        new ErroValidacao("ITEM_NUMERO_INVALIDO", "Número do item inválido.", { numero }),
      );
    }

    if (dados.descricao.trim() === "") {
      return err(
        new ErroValidacao("ITEM_DESCRICAO_VAZIA", "O item precisa de uma descrição."),
      );
    }

    if (!dados.quantidade.ehPositiva()) {
      return err(
        new ErroValidacao(
          "ITEM_QUANTIDADE_INVALIDA",
          "A quantidade do item deve ser maior que zero.",
        ),
      );
    }

    if (dados.precoUnitario.ehNegativo()) {
      return err(
        new ErroValidacao(
          "ITEM_PRECO_NEGATIVO",
          "O preço do item não pode ser negativo.",
        ),
      );
    }

    if (dados.custoUnitario?.ehNegativo() === true) {
      return err(
        new ErroValidacao(
          "ITEM_CUSTO_NEGATIVO",
          "O custo do item não pode ser negativo.",
        ),
      );
    }

    return ok(new VendaItem(numero, dados));
  }

  /**
   * Reconstrói um item já persistido, com os descontos que ele tinha.
   *
   * Uso exclusivo do repositório. Ver `Produto.reconstituir` sobre não revalidar.
   */
  static reconstituir(
    numero: number,
    dados: DadosItemVenda,
    desconto: Dinheiro,
    descontoRateado: Dinheiro,
  ): VendaItem {
    const item = new VendaItem(numero, dados);
    item.#desconto = desconto;
    item.#descontoRateado = descontoRateado;
    return item;
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  /** Sequencial dentro da venda. Vira `nItem` no XML fiscal. */
  get numero(): number {
    return this.#numero;
  }

  get produtoId(): Identificador {
    return this.#produtoId;
  }

  get descricao(): string {
    return this.#descricao;
  }

  get quantidade(): Quantidade {
    return this.#quantidade;
  }

  get precoUnitario(): Dinheiro {
    return this.#precoUnitario;
  }

  get desconto(): Dinheiro {
    return this.#desconto;
  }

  /** Parcela do desconto da venda que coube a este item. */
  get descontoRateado(): Dinheiro {
    return this.#descontoRateado;
  }

  /** Custo da unidade congelado na venda. Ausente quando desconhecido. */
  get custoUnitario(): Dinheiro | undefined {
    return this.#custoUnitario;
  }

  /**
   * Custo da quantidade vendida — a parcela deste item no CMV.
   *
   * Arredonda como o preço (meio-para-cima), pela mesma conta: custo × peso em
   * milésimos. Ausente quando o custo é desconhecido, para que o relatório
   * diga "margem estimada sem X itens" em vez de tratá-los como custo zero e
   * inflar o lucro.
   */
  get custoTotal(): Dinheiro | undefined {
    return this.#custoUnitario?.escalar(this.#quantidade.milesimos, 1000n);
  }

  /**
   * Se uma nova leitura do mesmo produto deve **somar** a este item.
   *
   * É o que deixa a rebipada previsível: a segunda leitura do refrigerante vira
   * "2 un" na mesma linha, em vez de uma linha nova que o operador precisa
   * conferir. Mas só soma quando não há nada que distinga as duas leituras:
   *
   * - **unidade inteira** — cada pesagem é uma embalagem diferente, com etiqueta
   *   própria; juntá-las esconderia do cliente qual pacote pesou quanto;
   * - **mesmo preço** — uma promoção que começou entre as duas leituras não
   *   pode ser aplicada retroativamente à primeira;
   * - **sem desconto próprio** — o desconto foi calculado sobre a quantidade
   *   antiga, e somar quantidade a ele mudaria o percentual sem ninguém pedir.
   */
  aceitaSomar(dados: DadosItemVenda): boolean {
    return (
      this.#produtoId.equals(dados.produtoId) &&
      !this.#quantidade.unidade.fracionavel &&
      this.#quantidade.unidade.codigo === dados.quantidade.unidade.codigo &&
      this.#precoUnitario.equals(dados.precoUnitario) &&
      this.#desconto.ehZero()
    );
  }

  /** Preço × quantidade, antes de qualquer desconto. */
  get totalBruto(): Dinheiro {
    return this.#precoUnitario.escalar(this.#quantidade.milesimos, 1000n);
  }

  /** Base do rateio: o que sobra depois do desconto dado no próprio item. */
  get totalAposDescontoProprio(): Dinheiro {
    return this.totalBruto.subtrair(this.#desconto);
  }

  /** Valor final do item, já com os dois descontos. */
  get total(): Dinheiro {
    return this.totalAposDescontoProprio.subtrair(this.#descontoRateado);
  }

  // ── Alterações (só enquanto a venda está aberta) ───────────────────────

  alterarQuantidade(quantidade: Quantidade): Result<void, ErroValidacao> {
    if (quantidade.unidade.codigo !== this.#quantidade.unidade.codigo) {
      return err(
        new ErroValidacao(
          "ITEM_UNIDADE_DIFERENTE",
          `Este item é vendido em ${this.#quantidade.unidade.descricao.toLowerCase()}.`,
          {
            esperada: this.#quantidade.unidade.codigo,
            recebida: quantidade.unidade.codigo,
          },
        ),
      );
    }

    if (!quantidade.ehPositiva()) {
      return err(
        new ErroValidacao(
          "ITEM_QUANTIDADE_INVALIDA",
          "A quantidade do item deve ser maior que zero.",
        ),
      );
    }

    this.#quantidade = quantidade;

    // O desconto foi calculado sobre a quantidade anterior; mantê-lo poderia
    // deixá-lo maior que o próprio item.
    if (this.#desconto.maiorQue(this.totalBruto)) {
      this.#desconto = this.totalBruto;
    }

    return ok(undefined);
  }

  aplicarDesconto(valor: Dinheiro): Result<void, ErroValidacao> {
    if (valor.ehNegativo()) {
      return err(
        new ErroValidacao("ITEM_DESCONTO_NEGATIVO", "O desconto não pode ser negativo."),
      );
    }

    if (valor.maiorQue(this.totalBruto)) {
      return err(
        new ErroValidacao(
          "ITEM_DESCONTO_MAIOR_QUE_ITEM",
          `O desconto não pode ser maior que o valor do item (${this.totalBruto.formatar()}).`,
          {
            desconto: valor.centavos.toString(),
            item: this.totalBruto.centavos.toString(),
          },
        ),
      );
    }

    this.#desconto = valor;
    return ok(undefined);
  }

  /** Define a parcela do desconto da venda. Chamado apenas pelo agregado. */
  definirDescontoRateado(valor: Dinheiro): void {
    this.#descontoRateado = valor;
  }
}
