import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";

/**
 * Limites numéricos de um papel (ARQUITETURA.md §9.4).
 *
 * "Pode dar desconto" não responde a pergunta que importa no balcão: **quanto**.
 * Papel puro só sabe dizer sim ou não, e essa é a razão pela qual RBAC sozinho
 * não serve a um ERP.
 *
 * O ponto central do desenho: **ultrapassar um limite não bloqueia a operação.**
 * Dispara o fluxo de autorização de supervisor, que registra quem pediu e quem
 * autorizou. Bloquear puro faz a equipe procurar contorno — vender por fora,
 * usar o login do gerente, anotar num caderno — e aí a operação continua
 * acontecendo sem rastro nenhum. Autorizar-e-registrar preserva as duas coisas
 * que interessam: a venda e a prova.
 *
 * Percentual é **inteiro em centésimos de por cento** (5% = 500). Mesmo motivo
 * do dinheiro em centavos (ADR-0009): `0.05` em ponto flutuante multiplicado
 * pelo total produz o centavo de diferença que ninguém explica no fechamento.
 */

/** Valor sem teto. Existe porque "ilimitado" não é um número grande. */
export const ILIMITADO = "ILIMITADO" as const;

export type LimiteDinheiro = Dinheiro | typeof ILIMITADO;

export type LimiteMinutos = number | typeof ILIMITADO;

/** 100% em centésimos de por cento. */
export const PERCENTUAL_TOTAL = 10_000;

export interface DadosLimites {
  /** Desconto máximo em um item, em centésimos de por cento. */
  readonly descontoItem: number;
  /** Desconto máximo no total da venda, em centésimos de por cento. */
  readonly descontoVenda: number;
  readonly sangria: LimiteDinheiro;
  readonly estornoEmDinheiro: LimiteDinheiro;
  /**
   * Janela para cancelar uma venda finalizada.
   *
   * `0` significa "não cancela" — o operador de caixa (§9.4). A permissão diz se
   * a ação existe para o papel; este número diz até quando.
   */
  readonly cancelarVendaAteMinutos: LimiteMinutos;
}

export class LimitesPapel {
  readonly #dados: DadosLimites;

  private constructor(dados: DadosLimites) {
    this.#dados = dados;
  }

  static criar(dados: DadosLimites): Result<LimitesPapel, ErroValidacao> {
    const percentuais: readonly [string, number][] = [
      ["descontoItem", dados.descontoItem],
      ["descontoVenda", dados.descontoVenda],
    ];

    for (const [campo, valor] of percentuais) {
      if (!Number.isInteger(valor) || valor < 0 || valor > PERCENTUAL_TOTAL) {
        return err(
          new ErroValidacao(
            "LIMITE_PERCENTUAL_INVALIDO",
            "O limite de desconto deve estar entre 0% e 100%.",
            { campo, valorRecebido: valor },
          ),
        );
      }
    }

    if (
      dados.cancelarVendaAteMinutos !== ILIMITADO &&
      (!Number.isInteger(dados.cancelarVendaAteMinutos) ||
        dados.cancelarVendaAteMinutos < 0)
    ) {
      return err(
        new ErroValidacao(
          "LIMITE_MINUTOS_INVALIDO",
          "A janela de cancelamento deve ser um número inteiro de minutos.",
          { valorRecebido: dados.cancelarVendaAteMinutos },
        ),
      );
    }

    for (const [campo, limite] of [
      ["sangria", dados.sangria],
      ["estornoEmDinheiro", dados.estornoEmDinheiro],
    ] as const) {
      if (limite !== ILIMITADO && limite.ehNegativo()) {
        return err(
          new ErroValidacao(
            "LIMITE_VALOR_NEGATIVO",
            "O limite de valor não pode ser negativo.",
            { campo },
          ),
        );
      }
    }

    return ok(new LimitesPapel(dados));
  }

  get descontoItem(): number {
    return this.#dados.descontoItem;
  }

  get descontoVenda(): number {
    return this.#dados.descontoVenda;
  }

  get sangria(): LimiteDinheiro {
    return this.#dados.sangria;
  }

  get estornoEmDinheiro(): LimiteDinheiro {
    return this.#dados.estornoEmDinheiro;
  }

  get cancelarVendaAteMinutos(): LimiteMinutos {
    return this.#dados.cancelarVendaAteMinutos;
  }

  /** O desconto pedido no item cabe no papel? */
  cobreDescontoEmItem(centesimosDePorCento: number): boolean {
    return centesimosDePorCento <= this.#dados.descontoItem;
  }

  cobreDescontoNaVenda(centesimosDePorCento: number): boolean {
    return centesimosDePorCento <= this.#dados.descontoVenda;
  }

  cobreSangria(valor: Dinheiro): boolean {
    return cabe(valor, this.#dados.sangria);
  }

  cobreEstornoEmDinheiro(valor: Dinheiro): boolean {
    return cabe(valor, this.#dados.estornoEmDinheiro);
  }

  /** Cancelar uma venda finalizada há tantos minutos cabe no papel? */
  cobreCancelamentoApos(minutos: number): boolean {
    return (
      this.#dados.cancelarVendaAteMinutos === ILIMITADO ||
      minutos <= this.#dados.cancelarVendaAteMinutos
    );
  }

  /**
   * Limites de quem não tem alçada nenhuma.
   *
   * É o padrão para papel novo, e é deliberadamente restritivo: permissão
   * ausente significa negado, e limite ausente deve significar zero
   * (ARQUITETURA.md §9.5). Papel criado pela empresa não deve ganhar alçada por
   * esquecimento de quem o criou.
   */
  static nenhum(): LimitesPapel {
    return new LimitesPapel({
      descontoItem: 0,
      descontoVenda: 0,
      sangria: Dinheiro.zero(),
      estornoEmDinheiro: Dinheiro.zero(),
      cancelarVendaAteMinutos: 0,
    });
  }
}

function cabe(valor: Dinheiro, limite: LimiteDinheiro): boolean {
  return limite === ILIMITADO || valor.menorOuIgualA(limite);
}
