import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import type { Quantidade } from "../valores/Quantidade.js";

/**
 * Uma linha da nota do fornecedor.
 *
 * A descrição é **copiada** do produto, não referenciada — mesmo motivo de
 * `VendaItem`: renomear o produto amanhã não pode reescrever a nota de ontem.
 *
 * A quantidade fica na **unidade em que a mercadoria chegou**, não na unidade
 * do estoque. Se a nota diz "3 fardos", o item guarda 3 fardos: ele é a cópia
 * fiel do papel, e é o que permite conferir linha a linha com o documento na
 * mão. A conversão para a unidade base acontece no movimento de estoque, que é
 * o **efeito** da nota — não a nota.
 */
export interface DadosItemDaNota {
  readonly produtoId: Identificador;
  readonly descricao: string;
  readonly quantidade: Quantidade;
  /** Centavos, por unidade **da nota**. */
  readonly custoUnitario: Dinheiro;
  /** Desconto dado nesta linha pelo fornecedor. */
  readonly desconto?: Dinheiro | undefined;
}

export class ItemDaNota {
  readonly #numero: number;
  readonly #produtoId: Identificador;
  readonly #descricao: string;
  readonly #quantidade: Quantidade;
  readonly #custoUnitario: Dinheiro;
  readonly #desconto: Dinheiro;

  private constructor(numero: number, dados: DadosItemDaNota, desconto: Dinheiro) {
    this.#numero = numero;
    this.#produtoId = dados.produtoId;
    this.#descricao = dados.descricao.trim();
    this.#quantidade = dados.quantidade;
    this.#custoUnitario = dados.custoUnitario;
    this.#desconto = desconto;
  }

  static criar(
    numero: number,
    dados: DadosItemDaNota,
  ): Result<ItemDaNota, ErroValidacao> {
    if (!Number.isInteger(numero) || numero < 1) {
      return err(
        new ErroValidacao("ITEM_NOTA_NUMERO_INVALIDO", "Número do item inválido.", {
          numero,
        }),
      );
    }

    if (dados.descricao.trim() === "") {
      return err(
        new ErroValidacao(
          "ITEM_NOTA_DESCRICAO_VAZIA",
          "O item precisa de uma descrição.",
        ),
      );
    }

    if (!dados.quantidade.ehPositiva()) {
      return err(
        new ErroValidacao(
          "ITEM_NOTA_QUANTIDADE_INVALIDA",
          "A quantidade do item deve ser maior que zero.",
        ),
      );
    }

    if (dados.custoUnitario.ehNegativo()) {
      return err(
        new ErroValidacao("ITEM_NOTA_CUSTO_NEGATIVO", "O custo não pode ser negativo."),
      );
    }

    const desconto = dados.desconto ?? Dinheiro.zero();

    if (desconto.ehNegativo()) {
      return err(
        new ErroValidacao(
          "ITEM_NOTA_DESCONTO_NEGATIVO",
          "O desconto não pode ser negativo.",
        ),
      );
    }

    const bruto = dados.custoUnitario.escalar(dados.quantidade.milesimos, 1000n);

    // Desconto maior que a linha inteira significaria mercadoria com valor
    // negativo, e o custo médio do produto iria junto. É erro de digitação,
    // e o lugar de pegá-lo é aqui — não no relatório de margem do mês seguinte.
    if (desconto.maiorQue(bruto)) {
      return err(
        new ErroValidacao(
          "ITEM_NOTA_DESCONTO_MAIOR_QUE_ITEM",
          "O desconto é maior que o valor do item. Confira a nota.",
          { desconto: desconto.centavos.toString(), item: bruto.centavos.toString() },
        ),
      );
    }

    return ok(new ItemDaNota(numero, dados, desconto));
  }

  /** Reconstrói um item já persistido. Ver `Produto.reconstituir` sobre não revalidar. */
  static reconstituir(numero: number, dados: DadosItemDaNota): ItemDaNota {
    return new ItemDaNota(numero, dados, dados.desconto ?? Dinheiro.zero());
  }

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

  get custoUnitario(): Dinheiro {
    return this.#custoUnitario;
  }

  get desconto(): Dinheiro {
    return this.#desconto;
  }

  /** Custo × quantidade, antes do desconto. */
  get bruto(): Dinheiro {
    return this.#custoUnitario.escalar(this.#quantidade.milesimos, 1000n);
  }

  /** O que a linha vale de fato: bruto menos o desconto. */
  get total(): Dinheiro {
    return this.bruto.subtrair(this.#desconto);
  }

  /**
   * Custo por unidade **já com o desconto embutido**.
   *
   * É este, e não o `custoUnitario` da nota, que vai para o estoque: o desconto
   * do fornecedor baixou o que a loja pagou de verdade, e ignorá-lo faria o
   * custo médio ficar acima do real — inflando o preço de reposição e encolhendo
   * a margem calculada em todo relatório.
   */
  get custoEfetivo(): Dinheiro {
    return this.total.escalar(1000n, this.#quantidade.milesimos);
  }
}
