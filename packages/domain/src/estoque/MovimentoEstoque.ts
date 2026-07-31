import { Entity } from "../shared/Entity.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { Dinheiro } from "../valores/Dinheiro.js";
import type { Quantidade } from "../valores/Quantidade.js";

import {
  afetaCustoMedio,
  efeitoDoTipo,
  ehSaida,
  type TipoMovimento,
} from "./TipoMovimento.js";

/** De onde o movimento veio, para rastrear até o documento de origem. */
export interface OrigemMovimento {
  readonly tipo: "VENDA" | "COMPRA" | "INVENTARIO" | "TRANSFERENCIA" | "MANUAL";
  /** Documento que originou: venda, nota de compra, inventário. */
  readonly documentoId?: Identificador | undefined;
}

export interface DadosMovimento {
  readonly id: Identificador;
  readonly produtoId: Identificador;
  readonly tipo: TipoMovimento;
  /** Sempre positiva — o sinal vem do tipo. */
  readonly quantidade: Quantidade;
  readonly origem: OrigemMovimento;
  readonly usuarioId: Identificador;
  readonly ocorridoEm: Date;
  /** Custo unitário da compra. Só usado quando o tipo afeta o custo médio. */
  readonly custoUnitario?: Dinheiro | undefined;
  readonly lote?: string | undefined;
  readonly observacao?: string | undefined;
}

/**
 * Movimento de estoque — um **fato imutável**.
 *
 * Estoque não é uma coluna com saldo: é a soma dos movimentos (ADR-0007).
 * A diferença aparece exatamente onde mais importa, no PDV com várias estações:
 * se o PDV 1 vende 3 e o PDV 2 vende 2 ao mesmo tempo, somar movimentos dá o
 * mesmo resultado em qualquer ordem. Com saldo mutável, uma das vendas
 * sobrescreveria a outra e a loja perderia estoque sem ninguém perceber.
 *
 * Correção nunca altera um movimento: gera um movimento novo. É isso que
 * mantém o histórico auditável — dá para responder o que aconteceu, quando e
 * por quem, inclusive numa fiscalização.
 */
export class MovimentoEstoque extends Entity {
  readonly #produtoId: Identificador;
  readonly #tipo: TipoMovimento;
  readonly #quantidade: Quantidade;
  readonly #origem: OrigemMovimento;
  readonly #usuarioId: Identificador;
  readonly #ocorridoEm: Date;
  readonly #custoUnitario: Dinheiro | undefined;
  readonly #lote: string | undefined;
  readonly #observacao: string | undefined;

  private constructor(dados: DadosMovimento) {
    super(dados.id);
    this.#produtoId = dados.produtoId;
    this.#tipo = dados.tipo;
    this.#quantidade = dados.quantidade;
    this.#origem = dados.origem;
    this.#usuarioId = dados.usuarioId;
    this.#ocorridoEm = dados.ocorridoEm;
    this.#custoUnitario = dados.custoUnitario;
    this.#lote = dados.lote?.trim() === "" ? undefined : dados.lote?.trim();
    this.#observacao =
      dados.observacao?.trim() === "" ? undefined : dados.observacao?.trim();
  }

  static criar(dados: DadosMovimento): Result<MovimentoEstoque, ErroValidacao> {
    if (dados.quantidade.ehNegativa()) {
      return err(
        new ErroValidacao(
          "MOVIMENTO_QUANTIDADE_NEGATIVA",
          "A quantidade deve ser positiva. Use o tipo de movimento para indicar entrada ou saída.",
          { tipo: dados.tipo },
        ),
      );
    }

    if (dados.quantidade.ehZero()) {
      return err(
        new ErroValidacao(
          "MOVIMENTO_QUANTIDADE_ZERO",
          "A quantidade deve ser maior que zero.",
          { tipo: dados.tipo },
        ),
      );
    }

    if (dados.custoUnitario !== undefined && dados.custoUnitario.ehNegativo()) {
      return err(
        new ErroValidacao(
          "MOVIMENTO_CUSTO_NEGATIVO",
          "O custo unitário não pode ser negativo.",
        ),
      );
    }

    // Ajuste sem justificativa é a porta de saída preferida de quem desvia
    // mercadoria: exigir motivo torna o desvio rastreável.
    if (
      (dados.tipo === "AJUSTE_POSITIVO" ||
        dados.tipo === "AJUSTE_NEGATIVO" ||
        dados.tipo === "PERDA") &&
      (dados.observacao === undefined || dados.observacao.trim() === "")
    ) {
      return err(
        new ErroValidacao(
          "MOVIMENTO_JUSTIFICATIVA_OBRIGATORIA",
          "Informe o motivo do ajuste ou da perda.",
          { tipo: dados.tipo },
        ),
      );
    }

    return ok(new MovimentoEstoque(dados));
  }

  get produtoId(): Identificador {
    return this.#produtoId;
  }

  get tipo(): TipoMovimento {
    return this.#tipo;
  }

  /** Quantidade informada, sempre positiva. */
  get quantidade(): Quantidade {
    return this.#quantidade;
  }

  get origem(): OrigemMovimento {
    return this.#origem;
  }

  get usuarioId(): Identificador {
    return this.#usuarioId;
  }

  get ocorridoEm(): Date {
    return this.#ocorridoEm;
  }

  get custoUnitario(): Dinheiro | undefined {
    return this.#custoUnitario;
  }

  get lote(): string | undefined {
    return this.#lote;
  }

  get observacao(): string | undefined {
    return this.#observacao;
  }

  /** Efeito no saldo, em milésimos com sinal. É o que a projeção soma. */
  get delta(): bigint {
    return this.#quantidade.milesimos * efeitoDoTipo(this.#tipo);
  }

  get ehSaida(): boolean {
    return ehSaida(this.#tipo);
  }

  /** Indica se este movimento recalcula o custo médio do produto. */
  get atualizaCustoMedio(): boolean {
    return afetaCustoMedio(this.#tipo) && this.#custoUnitario !== undefined;
  }
}
