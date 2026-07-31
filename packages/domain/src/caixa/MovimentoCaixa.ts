import { Entity } from "../shared/Entity.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { Dinheiro } from "../valores/Dinheiro.js";

/**
 * Movimentação de dinheiro na gaveta fora da venda.
 *
 * **Sangria** é a retirada feita durante o expediente para não acumular
 * dinheiro no caixa — prática de segurança, não exceção. **Suprimento** é o
 * aporte, normalmente troco que faltou.
 */
export type TipoMovimentoCaixa = "SANGRIA" | "SUPRIMENTO";

export interface DadosMovimentoCaixa {
  readonly id: Identificador;
  readonly tipo: TipoMovimentoCaixa;
  readonly valor: Dinheiro;
  readonly motivo: string;
  readonly usuarioId: Identificador;
  /** Quem autorizou, quando a operação exige supervisão. */
  readonly autorizadoPorId?: Identificador | undefined;
  readonly ocorridoEm: Date;
}

/**
 * Movimento de caixa — fato imutável.
 *
 * Exige **motivo** sempre. Dinheiro saindo da gaveta sem justificativa é
 * exatamente o rastro que um desvio não deixa; obrigar o texto transforma a
 * retirada em registro auditável.
 */
export class MovimentoCaixa extends Entity {
  readonly #tipo: TipoMovimentoCaixa;
  readonly #valor: Dinheiro;
  readonly #motivo: string;
  readonly #usuarioId: Identificador;
  readonly #autorizadoPorId: Identificador | undefined;
  readonly #ocorridoEm: Date;

  private constructor(dados: DadosMovimentoCaixa, motivo: string) {
    super(dados.id);
    this.#tipo = dados.tipo;
    this.#valor = dados.valor;
    this.#motivo = motivo;
    this.#usuarioId = dados.usuarioId;
    this.#autorizadoPorId = dados.autorizadoPorId;
    this.#ocorridoEm = dados.ocorridoEm;
  }

  static criar(dados: DadosMovimentoCaixa): Result<MovimentoCaixa, ErroValidacao> {
    if (!dados.valor.ehPositivo()) {
      return err(
        new ErroValidacao(
          "MOVIMENTO_CAIXA_VALOR_INVALIDO",
          "O valor deve ser maior que zero.",
          { tipo: dados.tipo },
        ),
      );
    }

    const motivo = dados.motivo.trim();

    if (motivo === "") {
      return err(
        new ErroValidacao(
          "MOVIMENTO_CAIXA_MOTIVO_OBRIGATORIO",
          dados.tipo === "SANGRIA"
            ? "Informe o motivo da sangria."
            : "Informe o motivo do suprimento.",
          { tipo: dados.tipo },
        ),
      );
    }

    return ok(new MovimentoCaixa(dados, motivo));
  }

  get tipo(): TipoMovimentoCaixa {
    return this.#tipo;
  }

  get valor(): Dinheiro {
    return this.#valor;
  }

  get motivo(): string {
    return this.#motivo;
  }

  get usuarioId(): Identificador {
    return this.#usuarioId;
  }

  get autorizadoPorId(): Identificador | undefined {
    return this.#autorizadoPorId;
  }

  get ocorridoEm(): Date {
    return this.#ocorridoEm;
  }

  /** Efeito na gaveta: suprimento soma, sangria subtrai. */
  get delta(): Dinheiro {
    return this.#tipo === "SUPRIMENTO" ? this.#valor : this.#valor.negar();
  }
}
