import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { Dinheiro } from "../valores/Dinheiro.js";

import {
  type CodigoFormaPagamento,
  type FormaPagamento,
  obterFormaPagamento,
} from "./FormaPagamento.js";

/**
 * Um pagamento registrado numa venda.
 *
 * A venda aceita **vários**: metade no cartão, metade em dinheiro é rotina no
 * balcão. Modelar pagamento como lista, e não como campo único, evita a
 * gambiarra de "forma mista" que depois ninguém consegue conciliar.
 */
export class Pagamento {
  readonly #forma: FormaPagamento;
  readonly #valor: Dinheiro;
  readonly #autorizacao: string | undefined;
  readonly #parcelas: number;

  private constructor(
    forma: FormaPagamento,
    valor: Dinheiro,
    autorizacao: string | undefined,
    parcelas: number,
  ) {
    this.#forma = forma;
    this.#valor = valor;
    this.#autorizacao = autorizacao;
    this.#parcelas = parcelas;
  }

  static criar(
    codigo: CodigoFormaPagamento,
    valor: Dinheiro,
    opcoes?: {
      /** NSU ou código de autorização da maquininha. */
      readonly autorizacao?: string | undefined;
      readonly parcelas?: number | undefined;
    },
  ): Result<Pagamento, ErroValidacao> {
    if (!valor.ehPositivo()) {
      return err(
        new ErroValidacao(
          "PAGAMENTO_VALOR_INVALIDO",
          "O valor do pagamento deve ser maior que zero.",
        ),
      );
    }

    const forma = obterFormaPagamento(codigo);
    const parcelas = opcoes?.parcelas ?? 1;

    if (!Number.isInteger(parcelas) || parcelas < 1) {
      return err(
        new ErroValidacao(
          "PAGAMENTO_PARCELAS_INVALIDAS",
          "Número de parcelas inválido.",
          {
            parcelas,
          },
        ),
      );
    }

    if (parcelas > 1 && codigo !== "CARTAO_CREDITO" && codigo !== "CREDIARIO") {
      return err(
        new ErroValidacao(
          "PAGAMENTO_PARCELAMENTO_NAO_PERMITIDO",
          `${forma.descricao} não pode ser parcelado.`,
          { forma: codigo },
        ),
      );
    }

    const autorizacao = opcoes?.autorizacao?.trim();

    return ok(
      new Pagamento(forma, valor, autorizacao === "" ? undefined : autorizacao, parcelas),
    );
  }

  get forma(): FormaPagamento {
    return this.#forma;
  }

  get valor(): Dinheiro {
    return this.#valor;
  }

  get autorizacao(): string | undefined {
    return this.#autorizacao;
  }

  get parcelas(): number {
    return this.#parcelas;
  }

  get entraNaGaveta(): boolean {
    return this.#forma.entraNaGaveta;
  }

  get geraContaReceber(): boolean {
    return this.#forma.geraContaReceber;
  }
}
