import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import type { Quantidade } from "../valores/Quantidade.js";

import type { CodigoFormaPagamento } from "./FormaPagamento.js";
import { Pagamento } from "./Pagamento.js";
import type { ItemVendido, VendaCancelada, VendaFinalizada } from "./eventos.js";
import { type DadosItemVenda, VendaItem } from "./VendaItem.js";

export type StatusVenda = "ABERTA" | "FINALIZADA" | "CANCELADA";

/**
 * Erro de uma operação de venda.
 *
 * Reúne as duas categorias porque quem chama trata as duas do mesmo jeito:
 * exibe a mensagem ao operador. A distinção serve ao adapter HTTP, que escolhe
 * o status a partir de `tipo`.
 */
export type ErroVenda = ErroValidacao | ErroRegraNegocio;

export interface DadosVenda {
  readonly id: Identificador;
  /** Sequencial dentro da série da estação. */
  readonly numero: number;
  readonly sessaoCaixaId: Identificador;
  readonly operadorId: Identificador;
  readonly estacaoId: Identificador;
  readonly clienteId?: Identificador | undefined;
  readonly abertaEm: Date;
}

/**
 * Venda — o agregado central do PDV.
 *
 * Protege a invariante que sustenta o cupom e o XML fiscal:
 *
 * > **o total é exatamente a soma dos itens.**
 *
 * Parece óbvio, e é justamente onde os sistemas erram: um desconto dado na
 * venda inteira precisa ser distribuído entre os itens, porque o documento
 * fiscal exige valor por item. Se o rateio perder um centavo, a soma dos itens
 * não bate com o total e a SEFAZ **rejeita a nota** — com a venda já feita e o
 * cliente já fora da loja.
 *
 * Uma venda finalizada é **imutável**. Correção gera evento novo, nunca
 * alteração (princípio 5 do CLAUDE.md).
 */
export class Venda extends AggregateRoot {
  readonly #numero: number;
  readonly #sessaoCaixaId: Identificador;
  readonly #operadorId: Identificador;
  readonly #estacaoId: Identificador;
  #clienteId: Identificador | undefined;
  readonly #abertaEm: Date;
  readonly #itens: VendaItem[] = [];
  readonly #pagamentos: Pagamento[] = [];
  #descontoVenda: Dinheiro = Dinheiro.zero();
  #status: StatusVenda = "ABERTA";
  #finalizadaEm: Date | undefined;
  #proximoNumeroItem = 1;

  private constructor(dados: DadosVenda) {
    super(dados.id);
    this.#numero = dados.numero;
    this.#sessaoCaixaId = dados.sessaoCaixaId;
    this.#operadorId = dados.operadorId;
    this.#estacaoId = dados.estacaoId;
    this.#clienteId = dados.clienteId;
    this.#abertaEm = dados.abertaEm;
  }

  static iniciar(dados: DadosVenda): Result<Venda, ErroValidacao> {
    if (!Number.isInteger(dados.numero) || dados.numero < 1) {
      return err(
        new ErroValidacao("VENDA_NUMERO_INVALIDO", "Número de venda inválido.", {
          numero: dados.numero,
        }),
      );
    }

    return ok(new Venda(dados));
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get numero(): number {
    return this.#numero;
  }

  get sessaoCaixaId(): Identificador {
    return this.#sessaoCaixaId;
  }

  get operadorId(): Identificador {
    return this.#operadorId;
  }

  get estacaoId(): Identificador {
    return this.#estacaoId;
  }

  get clienteId(): Identificador | undefined {
    return this.#clienteId;
  }

  get abertaEm(): Date {
    return this.#abertaEm;
  }

  get finalizadaEm(): Date | undefined {
    return this.#finalizadaEm;
  }

  get status(): StatusVenda {
    return this.#status;
  }

  get estaAberta(): boolean {
    return this.#status === "ABERTA";
  }

  get itens(): readonly VendaItem[] {
    return this.#itens;
  }

  get pagamentos(): readonly Pagamento[] {
    return this.#pagamentos;
  }

  get quantidadeItens(): number {
    return this.#itens.length;
  }

  get estaVazia(): boolean {
    return this.#itens.length === 0;
  }

  /** Soma dos itens antes de qualquer desconto. */
  get subtotal(): Dinheiro {
    return this.#itens.reduce(
      (soma, item) => soma.somar(item.totalBruto),
      Dinheiro.zero(),
    );
  }

  /** Descontos dados item a item. */
  get descontoItens(): Dinheiro {
    return this.#itens.reduce((soma, item) => soma.somar(item.desconto), Dinheiro.zero());
  }

  /** Desconto concedido sobre a venda inteira. */
  get descontoVenda(): Dinheiro {
    return this.#descontoVenda;
  }

  get descontoTotal(): Dinheiro {
    return this.descontoItens.somar(this.#descontoVenda);
  }

  /** Valor a cobrar do cliente. */
  get total(): Dinheiro {
    return this.subtotal.subtrair(this.descontoTotal);
  }

  get totalPago(): Dinheiro {
    return this.#pagamentos.reduce(
      (soma, pagamento) => soma.somar(pagamento.valor),
      Dinheiro.zero(),
    );
  }

  /** Quanto ainda falta receber. Zero quando o pagamento já cobre o total. */
  get faltaPagar(): Dinheiro {
    const restante = this.total.subtrair(this.totalPago);
    return restante.ehPositivo() ? restante : Dinheiro.zero();
  }

  /**
   * Troco a devolver.
   *
   * Só existe contra dinheiro: o excedente pago em cartão ou PIX não vira
   * troco — é cobrança a mais, que precisa ser corrigida, não devolvida da
   * gaveta.
   */
  get troco(): Dinheiro {
    const excedente = this.totalPago.subtrair(this.total);
    if (!excedente.ehPositivo()) return Dinheiro.zero();

    const emDinheiro = this.#pagamentos
      .filter((pagamento) => pagamento.forma.permiteTroco)
      .reduce((soma, pagamento) => soma.somar(pagamento.valor), Dinheiro.zero());

    return excedente.menorQue(emDinheiro) ? excedente : emDinheiro;
  }

  /** Valor lançado em crediário — a receber, não recebido. */
  get valorAReceber(): Dinheiro {
    return this.#pagamentos
      .filter((pagamento) => pagamento.geraContaReceber)
      .reduce((soma, pagamento) => soma.somar(pagamento.valor), Dinheiro.zero());
  }

  /** Valor que entra fisicamente na gaveta, descontado o troco. */
  get valorEmGaveta(): Dinheiro {
    const recebidoEmDinheiro = this.#pagamentos
      .filter((pagamento) => pagamento.entraNaGaveta)
      .reduce((soma, pagamento) => soma.somar(pagamento.valor), Dinheiro.zero());

    return recebidoEmDinheiro.subtrair(this.troco);
  }

  // ── Itens ──────────────────────────────────────────────────────────────

  adicionarItem(dados: DadosItemVenda): Result<VendaItem, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    const item = VendaItem.criar(this.#proximoNumeroItem, dados);
    if (item.isErr()) return err(item.error);

    this.#proximoNumeroItem += 1;
    this.#itens.push(item.unwrap());

    // O desconto da venda foi calculado sobre outro conjunto de itens.
    this.#descontoVenda = Dinheiro.zero();

    return item;
  }

  encontrarItem(numero: number): VendaItem | undefined {
    return this.#itens.find((item) => item.numero === numero);
  }

  removerItem(numero: number): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    const posicao = this.#itens.findIndex((item) => item.numero === numero);

    if (posicao === -1) {
      return err(
        new ErroValidacao("VENDA_ITEM_NAO_ENCONTRADO", "Item não encontrado na venda.", {
          numero,
        }),
      );
    }

    this.#itens.splice(posicao, 1);
    this.#descontoVenda = Dinheiro.zero();

    return ok(undefined);
  }

  alterarQuantidadeItem(numero: number, quantidade: Quantidade): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    const item = this.encontrarItem(numero);
    if (item === undefined) {
      return err(
        new ErroValidacao("VENDA_ITEM_NAO_ENCONTRADO", "Item não encontrado na venda.", {
          numero,
        }),
      );
    }

    const resultado = item.alterarQuantidade(quantidade);
    if (resultado.isErr()) return resultado;

    this.#descontoVenda = Dinheiro.zero();
    return ok(undefined);
  }

  aplicarDescontoItem(numero: number, valor: Dinheiro): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    const item = this.encontrarItem(numero);
    if (item === undefined) {
      return err(
        new ErroValidacao("VENDA_ITEM_NAO_ENCONTRADO", "Item não encontrado na venda.", {
          numero,
        }),
      );
    }

    return item.aplicarDesconto(valor);
  }

  // ── Desconto da venda ──────────────────────────────────────────────────

  /**
   * Aplica desconto sobre a venda inteira.
   *
   * O rateio entre os itens só é materializado na finalização — antes disso o
   * carrinho ainda muda, e recalcular a cada tecla seria trabalho jogado fora
   * num caminho onde a meta é responder em menos de 50 ms.
   */
  aplicarDescontoVenda(valor: Dinheiro): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    if (valor.ehNegativo()) {
      return err(
        new ErroValidacao("VENDA_DESCONTO_NEGATIVO", "O desconto não pode ser negativo."),
      );
    }

    const maximo = this.subtotal.subtrair(this.descontoItens);

    if (valor.maiorQue(maximo)) {
      return err(
        new ErroValidacao(
          "VENDA_DESCONTO_MAIOR_QUE_TOTAL",
          `O desconto não pode ser maior que o valor da venda (${maximo.formatar()}).`,
          { desconto: valor.centavos.toString(), maximo: maximo.centavos.toString() },
        ),
      );
    }

    this.#descontoVenda = valor;
    return ok(undefined);
  }

  // ── Pagamentos ─────────────────────────────────────────────────────────

  registrarPagamento(
    codigo: CodigoFormaPagamento,
    valor: Dinheiro,
    opcoes?: {
      readonly autorizacao?: string | undefined;
      readonly parcelas?: number | undefined;
    },
  ): Result<Pagamento, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    if (this.estaVazia) {
      return err(
        new ErroRegraNegocio(
          "VENDA_SEM_ITENS",
          "Adicione ao menos um item antes de receber o pagamento.",
        ),
      );
    }

    // Fiado exige saber de quem se está cobrando. Vender a prazo sem cliente
    // identificado é dinheiro que ninguém consegue receber depois.
    if (codigo === "CREDIARIO" && this.#clienteId === undefined) {
      return err(
        new ErroRegraNegocio(
          "CREDIARIO_SEM_CLIENTE",
          "Identifique o cliente para vender no crediário.",
        ),
      );
    }

    const pagamento = Pagamento.criar(codigo, valor, opcoes);
    if (pagamento.isErr()) return err(pagamento.error);

    this.#pagamentos.push(pagamento.unwrap());
    return pagamento;
  }

  removerPagamento(indice: number): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    if (!Number.isInteger(indice) || indice < 0 || indice >= this.#pagamentos.length) {
      return err(
        new ErroValidacao("VENDA_PAGAMENTO_NAO_ENCONTRADO", "Pagamento não encontrado.", {
          indice,
        }),
      );
    }

    this.#pagamentos.splice(indice, 1);
    return ok(undefined);
  }

  identificarCliente(clienteId: Identificador | undefined): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    // Remover o cliente deixaria um crediário sem devedor.
    if (clienteId === undefined && this.valorAReceber.ehPositivo()) {
      return err(
        new ErroValidacao(
          "VENDA_CLIENTE_OBRIGATORIO",
          "Não é possível remover o cliente: há pagamento no crediário.",
        ),
      );
    }

    this.#clienteId = clienteId;
    return ok(undefined);
  }

  // ── Finalização ────────────────────────────────────────────────────────

  /**
   * Fecha a venda.
   *
   * É aqui que o desconto da venda é **rateado entre os itens**, garantindo
   * que a soma dos itens feche exatamente com o total — a condição que a SEFAZ
   * confere.
   */
  finalizar(agora: Date): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    if (this.estaVazia) {
      return err(
        new ErroRegraNegocio("VENDA_SEM_ITENS", "Não é possível fechar uma venda vazia."),
      );
    }

    if (this.faltaPagar.ehPositivo()) {
      return err(
        new ErroRegraNegocio(
          "VENDA_PAGAMENTO_INSUFICIENTE",
          `Ainda falta receber ${this.faltaPagar.formatar()}.`,
          {
            total: this.total.centavos.toString(),
            pago: this.totalPago.centavos.toString(),
          },
        ),
      );
    }

    const rateio = this.#ratearDescontoVenda();
    if (rateio.isErr()) return err(rateio.error);

    this.#status = "FINALIZADA";
    this.#finalizadaEm = agora;

    const evento: VendaFinalizada = {
      tipo: "VendaFinalizada",
      agregadoId: this.id,
      ocorridoEm: agora,
      numero: this.#numero,
      sessaoCaixaId: this.#sessaoCaixaId,
      operadorId: this.#operadorId,
      clienteId: this.#clienteId,
      total: this.total,
      itens: this.#itensVendidos(),
      valorAReceber: this.valorAReceber,
    };

    this.registrarEvento(evento);

    return ok(undefined);
  }

  /**
   * Cancela a venda.
   *
   * Exige quem autorizou: cancelamento é o vetor clássico de desvio — receber
   * do cliente e cancelar a venda depois. Sem autorizador registrado, o desvio
   * fica invisível.
   */
  cancelar(
    motivo: string,
    autorizadoPorId: Identificador,
    agora: Date,
  ): Result<void, ErroVenda> {
    if (this.#status === "CANCELADA") {
      return err(
        new ErroRegraNegocio("VENDA_JA_CANCELADA", "Esta venda já foi cancelada."),
      );
    }

    if (motivo.trim() === "") {
      return err(
        new ErroValidacao(
          "VENDA_MOTIVO_OBRIGATORIO",
          "Informe o motivo do cancelamento.",
        ),
      );
    }

    const eraFinalizada = this.#status === "FINALIZADA";
    this.#status = "CANCELADA";

    // Venda aberta nunca saiu do caixa: descartá-la não movimentou estoque nem
    // dinheiro, e não há o que estornar.
    if (eraFinalizada) {
      const evento: VendaCancelada = {
        tipo: "VendaCancelada",
        agregadoId: this.id,
        ocorridoEm: agora,
        numero: this.#numero,
        motivo: motivo.trim(),
        autorizadoPorId,
        total: this.total,
        itens: this.#itensVendidos(),
      };

      this.registrarEvento(evento);
    }

    return ok(undefined);
  }

  // ── Interno ────────────────────────────────────────────────────────────

  #exigirAberta(): ErroRegraNegocio | undefined {
    if (this.#status === "ABERTA") return undefined;

    return new ErroRegraNegocio(
      "VENDA_NAO_ESTA_ABERTA",
      this.#status === "FINALIZADA"
        ? "Esta venda já foi finalizada."
        : "Esta venda foi cancelada.",
      { status: this.#status },
    );
  }

  /**
   * Distribui o desconto da venda entre os itens, proporcionalmente ao valor
   * de cada um, sem perder nem criar centavo.
   */
  #ratearDescontoVenda(): Result<void, ErroValidacao> {
    if (this.#descontoVenda.ehZero()) {
      for (const item of this.#itens) {
        item.definirDescontoRateado(Dinheiro.zero());
      }
      return ok(undefined);
    }

    const pesos = this.#itens.map((item) => item.totalAposDescontoProprio.centavos);
    const partes = this.#descontoVenda.ratearProporcional(pesos);

    if (partes.isErr()) return err(partes.error);

    const valores = partes.unwrap();
    for (const [indice, item] of this.#itens.entries()) {
      item.definirDescontoRateado(valores[indice] ?? Dinheiro.zero());
    }

    return ok(undefined);
  }

  #itensVendidos(): readonly ItemVendido[] {
    return this.#itens.map((item) => ({
      produtoId: item.produtoId,
      quantidade: item.quantidade,
    }));
  }
}
