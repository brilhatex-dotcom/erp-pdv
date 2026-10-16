import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";

import type { DevolucaoRegistrada } from "./eventos.js";
import type { Venda } from "./Venda.js";

/**
 * Para onde vai o produto que voltou.
 *
 * `PERDA` é o iogurte aberto, a fruta amassada: voltou, mas não volta para a
 * prateleira. A distinção decide o estoque **e** o relatório de perdas — tratar
 * tudo como retorno ao estoque faria o sistema oferecer à venda o que foi para
 * o lixo.
 */
export type DestinoDevolucao = "ESTOQUE" | "PERDA";

/**
 * Como o dinheiro volta ao cliente.
 *
 * Só `DINHEIRO` sai da gaveta. Pix e cartão são estornados fora do sistema —
 * no aplicativo do banco ou na maquininha —, e o registro aqui é o que permite
 * conferir depois que o estorno aconteceu. `ABATER_FIADO` não devolve dinheiro
 * nenhum: reduz o que o cliente ainda deve.
 */
export type FormaReembolso = "DINHEIRO" | "PIX" | "CARTAO" | "ABATER_FIADO";

export const FORMAS_REEMBOLSO: readonly FormaReembolso[] = [
  "DINHEIRO",
  "PIX",
  "CARTAO",
  "ABATER_FIADO",
];

export function ehFormaReembolso(valor: string): valor is FormaReembolso {
  return (FORMAS_REEMBOLSO as readonly string[]).includes(valor);
}

export function ehDestinoDevolucao(valor: string): valor is DestinoDevolucao {
  return valor === "ESTOQUE" || valor === "PERDA";
}

const TAMANHO_MAXIMO_MOTIVO = 200;

/** O que o operador escolheu devolver de um item. */
export interface PedidoDeItemDevolvido {
  /** Número do item **na venda original** — o `nItem` do cupom. */
  readonly numeroItem: number;
  readonly quantidade: Quantidade;
  readonly destino: DestinoDevolucao;
}

/** O que já voltou de um item em devoluções anteriores. */
export interface JaDevolvido {
  readonly milesimos: bigint;
  readonly valor: Dinheiro;
}

export interface ItemDevolvido {
  readonly numeroItem: number;
  readonly produtoId: Identificador;
  /** Congelada como na venda: é o que o cliente leu no cupom. */
  readonly descricao: string;
  readonly quantidade: Quantidade;
  /** Valor devolvido por este item, já com os descontos que ele teve. */
  readonly valor: Dinheiro;
  readonly destino: DestinoDevolucao;
}

export interface DadosDevolucao {
  readonly id: Identificador;
  readonly venda: Venda;
  readonly itens: readonly PedidoDeItemDevolvido[];
  /** Por número de item. Ausente significa que nada daquele item voltou ainda. */
  readonly jaDevolvido: ReadonlyMap<number, JaDevolvido>;
  /**
   * Quanto desta venda já foi devolvido **em dinheiro, Pix ou cartão**.
   *
   * É o teto do que ainda pode sair à vista. Sem ele, a venda feita inteira no
   * fiado poderia ser "devolvida" em dinheiro da gaveta — o cliente sairia com
   * reais por uma mercadoria que nunca pagou.
   */
  readonly jaReembolsadoAVista: Dinheiro;
  readonly formaReembolso: FormaReembolso;
  readonly motivo: string;
  readonly usuarioId: Identificador;
  readonly autorizadoPorId?: Identificador | undefined;
  /** Caixa de onde saiu o dinheiro. Só existe quando o reembolso é em dinheiro. */
  readonly sessaoCaixaId?: Identificador | undefined;
  readonly agora: Date;
}

export interface DadosReconstituicaoDevolucao {
  readonly id: Identificador;
  readonly vendaId: Identificador;
  readonly numeroVenda: number;
  readonly itens: readonly ItemDevolvido[];
  readonly formaReembolso: FormaReembolso;
  readonly motivo: string;
  readonly usuarioId: Identificador;
  readonly autorizadoPorId: Identificador | undefined;
  readonly sessaoCaixaId: Identificador | undefined;
  readonly ocorridaEm: Date;
}

/**
 * Devolução de mercadoria — total ou parcial, sempre ligada à venda original.
 *
 * ### Por que um agregado próprio, e não uma alteração da venda
 *
 * A venda finalizada é imutável (princípio 5): ela aconteceu, com aquele valor,
 * naquele dia, e é o que o cupom e a nota dizem. A devolução é **outro fato**,
 * de outro dia, com outro responsável. Reescrever a venda apagaria a resposta
 * à pergunta que o dono faz no fechamento: quanto eu vendi, e quanto voltou.
 *
 * ### O valor devolvido é o que o cliente pagou, não o preço de tabela
 *
 * Cada item devolve a sua parte do total **líquido** — com o desconto do item
 * e a parcela rateada do desconto da venda. Devolver pelo preço cheio daria ao
 * cliente mais do que ele pagou, e uma promoção virava lucro no balcão de
 * trocas. A última devolução de um item leva exatamente o que sobrou, para que
 * a soma das devoluções feche com o item ao centavo.
 */
export class Devolucao extends AggregateRoot {
  readonly #vendaId: Identificador;
  readonly #numeroVenda: number;
  readonly #itens: readonly ItemDevolvido[];
  readonly #formaReembolso: FormaReembolso;
  readonly #motivo: string;
  readonly #usuarioId: Identificador;
  readonly #autorizadoPorId: Identificador | undefined;
  readonly #sessaoCaixaId: Identificador | undefined;
  readonly #ocorridaEm: Date;

  private constructor(dados: DadosReconstituicaoDevolucao) {
    super(dados.id);
    this.#vendaId = dados.vendaId;
    this.#numeroVenda = dados.numeroVenda;
    this.#itens = dados.itens;
    this.#formaReembolso = dados.formaReembolso;
    this.#motivo = dados.motivo;
    this.#usuarioId = dados.usuarioId;
    this.#autorizadoPorId = dados.autorizadoPorId;
    this.#sessaoCaixaId = dados.sessaoCaixaId;
    this.#ocorridaEm = dados.ocorridaEm;
  }

  static registrar(
    dados: DadosDevolucao,
  ): Result<Devolucao, ErroValidacao | ErroRegraNegocio> {
    const { venda } = dados;

    if (venda.status === "CANCELADA") {
      return err(
        new ErroRegraNegocio(
          "DEVOLUCAO_VENDA_CANCELADA",
          "Esta venda foi cancelada; não há o que devolver.",
        ),
      );
    }

    if (venda.status !== "FINALIZADA") {
      return err(
        new ErroRegraNegocio(
          "DEVOLUCAO_VENDA_NAO_FINALIZADA",
          "Só é possível devolver itens de uma venda concluída.",
        ),
      );
    }

    if (dados.itens.length === 0) {
      return err(
        new ErroValidacao(
          "DEVOLUCAO_SEM_ITENS",
          "Escolha ao menos um item para devolver.",
        ),
      );
    }

    const motivo = dados.motivo.trim();

    if (motivo === "") {
      return err(
        new ErroValidacao(
          "DEVOLUCAO_MOTIVO_OBRIGATORIO",
          "Informe o motivo da devolução.",
        ),
      );
    }

    if (motivo.length > TAMANHO_MAXIMO_MOTIVO) {
      return err(
        new ErroValidacao(
          "DEVOLUCAO_MOTIVO_LONGO",
          `Resuma o motivo em até ${String(TAMANHO_MAXIMO_MOTIVO)} letras.`,
        ),
      );
    }

    const itens: ItemDevolvido[] = [];

    for (const pedido of dados.itens) {
      if (itens.some((atual) => atual.numeroItem === pedido.numeroItem)) {
        return err(
          new ErroValidacao(
            "DEVOLUCAO_ITEM_REPETIDO",
            "O mesmo item aparece duas vezes na devolução.",
            { numeroItem: pedido.numeroItem },
          ),
        );
      }

      const item = calcularItem(venda, pedido, dados.jaDevolvido.get(pedido.numeroItem));
      if (item.isErr()) return err(item.error);

      itens.push(item.unwrap());
    }

    const valorTotal = somar(itens);

    if (dados.formaReembolso === "ABATER_FIADO") {
      if (!venda.valorAReceber.ehPositivo()) {
        return err(
          new ErroRegraNegocio(
            "DEVOLUCAO_SEM_FIADO",
            "Esta venda não foi feita no fiado. Escolha outra forma de devolver o valor.",
          ),
        );
      }
    } else {
      const pagoAVista = venda.total.subtrair(venda.valorAReceber);
      const disponivel = pagoAVista.subtrair(dados.jaReembolsadoAVista);

      if (valorTotal.maiorQue(disponivel)) {
        return err(
          new ErroRegraNegocio(
            "DEVOLUCAO_ACIMA_DO_PAGO",
            disponivel.ehPositivo()
              ? `Desta venda, só ${disponivel.formatar()} ainda podem voltar à vista. Use "abater do fiado" para o restante.`
              : 'Esta venda foi paga no fiado. Use "abater do fiado" para devolver o valor.',
            {
              valor: valorTotal.centavos.toString(),
              disponivel: disponivel.centavos.toString(),
            },
          ),
        );
      }
    }

    const devolucao = new Devolucao({
      id: dados.id,
      vendaId: venda.id,
      numeroVenda: venda.numero,
      itens,
      formaReembolso: dados.formaReembolso,
      motivo,
      usuarioId: dados.usuarioId,
      autorizadoPorId: dados.autorizadoPorId,
      sessaoCaixaId: dados.sessaoCaixaId,
      ocorridaEm: dados.agora,
    });

    const evento: DevolucaoRegistrada = {
      tipo: "DevolucaoRegistrada",
      agregadoId: dados.id,
      ocorridoEm: dados.agora,
      vendaId: venda.id,
      valor: valorTotal,
      formaReembolso: dados.formaReembolso,
      itens: itens.map((item) => ({
        produtoId: item.produtoId,
        quantidade: item.quantidade,
        destino: item.destino,
      })),
    };

    devolucao.registrarEvento(evento);

    return ok(devolucao);
  }

  /** Uso exclusivo do repositório. Não recalcula: o valor devolvido é fato. */
  static reconstituir(dados: DadosReconstituicaoDevolucao): Devolucao {
    return new Devolucao(dados);
  }

  get vendaId(): Identificador {
    return this.#vendaId;
  }

  get numeroVenda(): number {
    return this.#numeroVenda;
  }

  get itens(): readonly ItemDevolvido[] {
    return this.#itens;
  }

  get valorTotal(): Dinheiro {
    return somar(this.#itens);
  }

  get formaReembolso(): FormaReembolso {
    return this.#formaReembolso;
  }

  /** Só o reembolso em dinheiro sai da gaveta — e só ele mexe na conferência. */
  get saiDaGaveta(): boolean {
    return this.#formaReembolso === "DINHEIRO";
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

  get sessaoCaixaId(): Identificador | undefined {
    return this.#sessaoCaixaId;
  }

  get ocorridaEm(): Date {
    return this.#ocorridaEm;
  }
}

function calcularItem(
  venda: Venda,
  pedido: PedidoDeItemDevolvido,
  jaDevolvido: JaDevolvido | undefined,
): Result<ItemDevolvido, ErroValidacao | ErroRegraNegocio> {
  const item = venda.encontrarItem(pedido.numeroItem);

  if (item === undefined) {
    return err(
      new ErroValidacao(
        "DEVOLUCAO_ITEM_NAO_ENCONTRADO",
        `O item ${String(pedido.numeroItem)} não faz parte desta venda.`,
        { numeroItem: pedido.numeroItem },
      ),
    );
  }

  if (pedido.quantidade.unidade.codigo !== item.quantidade.unidade.codigo) {
    return err(
      new ErroValidacao(
        "DEVOLUCAO_UNIDADE_DIFERENTE",
        `${item.descricao} foi vendido em ${item.quantidade.unidade.descricao.toLowerCase()}.`,
        { numeroItem: pedido.numeroItem },
      ),
    );
  }

  if (!pedido.quantidade.ehPositiva()) {
    return err(
      new ErroValidacao(
        "DEVOLUCAO_QUANTIDADE_INVALIDA",
        "A quantidade devolvida deve ser maior que zero.",
        { numeroItem: pedido.numeroItem },
      ),
    );
  }

  const vendido = item.quantidade.milesimos;
  const devolvidoAntes = jaDevolvido?.milesimos ?? 0n;
  const restante = vendido - devolvidoAntes;

  if (pedido.quantidade.milesimos > restante) {
    const sobra = Quantidade.deMilesimos(
      restante > 0n ? restante : 0n,
      item.quantidade.unidade.codigo,
    ).unwrapOr(Quantidade.zero(item.quantidade.unidade.codigo));

    return err(
      new ErroRegraNegocio(
        "DEVOLUCAO_ACIMA_DO_VENDIDO",
        restante > 0n
          ? `De ${item.descricao}, ainda podem voltar ${sobra.formatar()}.`
          : `${item.descricao} já foi devolvido por inteiro.`,
        { numeroItem: pedido.numeroItem, restante: restante.toString() },
      ),
    );
  }

  // A última parte leva o que sobrou do valor, e não a proporção: três
  // devoluções de um terço cada somariam um centavo a menos que o item, e esse
  // centavo ficaria preso no caixa sem dono.
  const valor =
    pedido.quantidade.milesimos === restante
      ? naoNegativo(item.total.subtrair(jaDevolvido?.valor ?? Dinheiro.zero()))
      : item.total.escalar(pedido.quantidade.milesimos, vendido);

  return ok({
    numeroItem: item.numero,
    produtoId: item.produtoId,
    descricao: item.descricao,
    quantidade: pedido.quantidade,
    valor,
    destino: pedido.destino,
  });
}

function somar(itens: readonly ItemDevolvido[]): Dinheiro {
  return itens.reduce((soma, item) => soma.somar(item.valor), Dinheiro.zero());
}

function naoNegativo(valor: Dinheiro): Dinheiro {
  return valor.ehNegativo() ? Dinheiro.zero() : valor;
}
