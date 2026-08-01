import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { Dinheiro } from "../valores/Dinheiro.js";

/**
 * Divide uma venda a prazo em parcelas com vencimento.
 *
 * ### Um título ou vários, e os dois são caderneta
 *
 * `parcelas: 1` é o fiado clássico do bairro: leva hoje, paga quando puder,
 * podendo pagar em pedaços — o título aceita baixa parcial. `parcelas: 3` é o
 * crediário formal da loja de material de construção, com datas combinadas na
 * hora da venda. O mesmo modelo cobre os dois porque a diferença está aqui, na
 * geração — e não no título.
 *
 * ### O centavo da divisão
 *
 * R$ 100,00 em 3 vezes é `33,34 · 33,33 · 33,33`, e não três vezes 33,33. A
 * diferença é um centavo, e é o centavo que faz a soma das parcelas não bater
 * com a venda — o tipo de divergência que o cliente encontra na conferência e
 * que destrói a confiança no sistema inteiro. `Dinheiro.ratear` já resolve isso;
 * aqui só se escolhe **onde** a sobra cai.
 */

/** Prazo padrão do fiado: o cliente leva hoje e acerta no mês que vem. */
export const DIAS_PRIMEIRO_VENCIMENTO_PADRAO = 30;
export const DIAS_ENTRE_PARCELAS_PADRAO = 30;

/** Acima disso não é mais varejo de bairro — é financiamento. */
const MAXIMO_PARCELAS = 36;

export interface Parcela {
  readonly numero: number;
  readonly de: number;
  readonly valor: Dinheiro;
  readonly vencimento: Date;
}

export interface PedidoDeParcelamento {
  readonly total: Dinheiro;
  readonly parcelas: number;
  /** Data da venda. O vencimento é contado a partir dela. */
  readonly emitidoEm: Date;
  readonly diasParaPrimeiroVencimento?: number | undefined;
  readonly diasEntreParcelas?: number | undefined;
}

export function montarPlanoDeParcelas(
  pedido: PedidoDeParcelamento,
): Result<readonly Parcela[], ErroValidacao> {
  const { total, parcelas } = pedido;

  if (!Number.isInteger(parcelas) || parcelas < 1) {
    return err(
      new ErroValidacao("PARCELAS_INVALIDAS", "Informe ao menos uma parcela.", {
        parcelas,
      }),
    );
  }

  if (parcelas > MAXIMO_PARCELAS) {
    return err(
      new ErroValidacao(
        "PARCELAS_DEMAIS",
        `O máximo é ${String(MAXIMO_PARCELAS)} parcelas.`,
        { parcelas },
      ),
    );
  }

  if (!total.ehPositivo()) {
    return err(
      new ErroValidacao("PARCELAMENTO_VALOR_INVALIDO", "O valor deve ser positivo."),
    );
  }

  const primeiro = pedido.diasParaPrimeiroVencimento ?? DIAS_PRIMEIRO_VENCIMENTO_PADRAO;
  const intervalo = pedido.diasEntreParcelas ?? DIAS_ENTRE_PARCELAS_PADRAO;

  if (!Number.isInteger(primeiro) || primeiro < 0) {
    return err(
      new ErroValidacao("PRAZO_INVALIDO", "O prazo do primeiro vencimento é inválido."),
    );
  }

  if (!Number.isInteger(intervalo) || intervalo < 1) {
    return err(
      new ErroValidacao("INTERVALO_INVALIDO", "O intervalo entre parcelas é inválido."),
    );
  }

  const valores = total.ratear(parcelas);

  /* v8 ignore next -- inalcançável: `parcelas` já foi validado como inteiro ≥ 1 */
  if (valores.isErr()) return err(valores.error);

  return ok(
    valores.unwrap().map((valor, indice) => ({
      numero: indice + 1,
      de: parcelas,
      valor,
      vencimento: somarDias(pedido.emitidoEm, primeiro + indice * intervalo),
    })),
  );
}

/**
 * Soma dias em UTC.
 *
 * `setDate` no fuso local erraria por uma hora duas vezes por ano, no horário
 * de verão — e um vencimento que cai um dia antes coloca na lista de cobrança
 * quem está em dia.
 */
function somarDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);
}
