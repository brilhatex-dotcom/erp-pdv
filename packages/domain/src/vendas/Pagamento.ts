import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { Dinheiro } from "../valores/Dinheiro.js";

import {
  type CodigoFormaPagamento,
  type FormaPagamento,
  obterFormaPagamento,
} from "./FormaPagamento.js";

/**
 * Quem confirmou que o dinheiro entrou.
 *
 * A distinção existe porque **as três situações pedem conferências diferentes**
 * no fim do dia, e misturá-las esconde exatamente o que a conferência procura:
 *
 * - `MANUAL` — o operador registrou: contou a cédula, viu o Pix cair no
 *   aplicativo do banco, leu "aprovado" na maquininha. É o caso de toda loja
 *   sem integração, e o que o fechamento confere contra o extrato.
 * - `INTEGRACAO` — um sistema externo (TEF, provedor de Pix) confirmou. Não há
 *   integração hoje; o valor existe para que ela entre sem migrar histórico.
 * - `SIMULADA` — ninguém recebeu nada. Só o modo treinamento produz, e a
 *   operação real recusa: simulação fica restrita ao ambiente de demonstração
 *   (ADR-0026).
 */
export type ConfirmacaoPagamento = "MANUAL" | "INTEGRACAO" | "SIMULADA";

export const CONFIRMACOES_PAGAMENTO: readonly ConfirmacaoPagamento[] = [
  "MANUAL",
  "INTEGRACAO",
  "SIMULADA",
];

export function ehConfirmacaoPagamento(valor: string): valor is ConfirmacaoPagamento {
  return (CONFIRMACOES_PAGAMENTO as readonly string[]).includes(valor);
}

/** Tamanho máximo da chave de reenvio. Cabe um UUID com folga. */
const TAMANHO_MAXIMO_CHAVE = 64;

export interface OpcoesPagamento {
  /** NSU ou código de autorização da maquininha. **Nunca** o número do cartão. */
  readonly autorizacao?: string | undefined;
  readonly parcelas?: number | undefined;
  /** Ausente significa `MANUAL` — a realidade de quem não tem integração. */
  readonly confirmacao?: ConfirmacaoPagamento | undefined;
  /**
   * Identificador que a estação gera **antes** de enviar o pagamento.
   *
   * É o que torna o reenvio inofensivo: a resposta pode se perder depois de o
   * servidor gravar, e a estação, sem saber, manda de novo. Com a chave, a
   * venda reconhece o pagamento que já tem em vez de somar outro — e o caixa
   * não fecha com dinheiro que nunca entrou.
   */
  readonly chave?: string | undefined;
}

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
  readonly #confirmacao: ConfirmacaoPagamento;
  readonly #chave: string | undefined;

  private constructor(
    forma: FormaPagamento,
    valor: Dinheiro,
    autorizacao: string | undefined,
    parcelas: number,
    confirmacao: ConfirmacaoPagamento,
    chave: string | undefined,
  ) {
    this.#forma = forma;
    this.#valor = valor;
    this.#autorizacao = autorizacao;
    this.#parcelas = parcelas;
    this.#confirmacao = confirmacao;
    this.#chave = chave;
  }

  static criar(
    codigo: CodigoFormaPagamento,
    valor: Dinheiro,
    opcoes?: OpcoesPagamento,
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

    // O campo de autorização é texto livre, e texto livre num balcão recebe o
    // que o operador tiver na mão — inclusive o cartão do cliente. Guardar o
    // número completo colocaria a loja no escopo do PCI-DSS por um campo que
    // só precisava do NSU. Recusar aqui, com a explicação, é mais barato do que
    // descobrir o número num backup.
    if (autorizacao !== undefined && pareceNumeroDeCartao(autorizacao)) {
      return err(
        new ErroValidacao(
          "PAGAMENTO_NUMERO_DE_CARTAO",
          "Não digite o número do cartão. Informe só o código de autorização (NSU) do comprovante da maquininha.",
        ),
      );
    }

    const chave = opcoes?.chave?.trim();

    if (chave !== undefined && (chave === "" || chave.length > TAMANHO_MAXIMO_CHAVE)) {
      return err(
        new ErroValidacao(
          "PAGAMENTO_CHAVE_INVALIDA",
          "Identificação do pagamento inválida.",
          {
            tamanho: chave.length,
          },
        ),
      );
    }

    return ok(
      new Pagamento(
        forma,
        valor,
        autorizacao === "" ? undefined : autorizacao,
        parcelas,
        opcoes?.confirmacao ?? "MANUAL",
        chave,
      ),
    );
  }

  /**
   * Reconstrói um pagamento já persistido.
   *
   * Uso exclusivo do repositório. Não revalida, como `Produto.reconstituir`:
   * uma regra nova — a recusa de número de cartão, por exemplo — não pode
   * tornar ilegível uma venda gravada antes dela.
   */
  static reconstituir(dados: {
    readonly forma: CodigoFormaPagamento;
    readonly valor: Dinheiro;
    readonly autorizacao: string | undefined;
    readonly parcelas: number;
    readonly confirmacao: ConfirmacaoPagamento;
    readonly chave: string | undefined;
  }): Pagamento {
    return new Pagamento(
      obterFormaPagamento(dados.forma),
      dados.valor,
      dados.autorizacao,
      dados.parcelas,
      dados.confirmacao,
      dados.chave,
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

  get confirmacao(): ConfirmacaoPagamento {
    return this.#confirmacao;
  }

  get chave(): string | undefined {
    return this.#chave;
  }

  get entraNaGaveta(): boolean {
    return this.#forma.entraNaGaveta;
  }

  get geraContaReceber(): boolean {
    return this.#forma.geraContaReceber;
  }

  /** Mesmo pagamento, para a conferência de reenvio: forma e valor. */
  mesmoConteudoQue(codigo: CodigoFormaPagamento, valor: Dinheiro): boolean {
    return this.#forma.codigo === codigo && this.#valor.equals(valor);
  }
}

/**
 * Tem cara de número de cartão: 13 a 19 dígitos que passam no módulo 10.
 *
 * NSU de maquininha tem 6 a 12 dígitos e não segue Luhn de propósito nenhum, e
 * código de autorização costuma ter letras. A chance de um código legítimo cair
 * aqui é a de um número aleatório de 13+ dígitos passar no Luhn — uma em dez —
 * e mesmo assim só se tiver esse comprimento, que nenhuma adquirente usa.
 */
export function pareceNumeroDeCartao(texto: string): boolean {
  const digitos = texto.replace(/[\s.-]/g, "");

  if (!/^\d{13,19}$/.test(digitos)) return false;

  let soma = 0;
  let dobrar = false;

  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    let valor = Number(digitos.charAt(i));

    if (dobrar) {
      valor *= 2;
      if (valor > 9) valor -= 9;
    }

    soma += valor;
    dobrar = !dobrar;
  }

  return soma % 10 === 0;
}
