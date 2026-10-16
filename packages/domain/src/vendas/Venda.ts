import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import type { Quantidade } from "../valores/Quantidade.js";

import { type CodigoFormaPagamento, obterFormaPagamento } from "./FormaPagamento.js";
import { type OpcoesPagamento, Pagamento } from "./Pagamento.js";
import type { ItemVendido, VendaCancelada, VendaFinalizada } from "./eventos.js";
import { type DadosItemVenda, VendaItem } from "./VendaItem.js";

export type StatusVenda = "ABERTA" | "FINALIZADA" | "CANCELADA";

/** Tamanho máximo do motivo de cancelamento e do rótulo de venda guardada. */
const TAMANHO_MAXIMO_MOTIVO = 200;
const TAMANHO_MAXIMO_ROTULO = 40;

/**
 * Venda guardada para depois.
 *
 * É a cliente que esqueceu a carteira no carro, ou o pedido grande que
 * ainda espera um item do estoque: a venda sai da frente do operador sem ser
 * perdida, e a fila anda. O rótulo é o que a identifica na lista — "Dona
 * Maria", "mesa 3" —, porque "venda 1047" não diz nada a ninguém no balcão.
 */
export interface SuspensaoVenda {
  readonly em: Date;
  readonly rotulo: string | undefined;
}

/**
 * Registro do cancelamento, guardado na própria venda.
 *
 * Quem pediu e quem autorizou ficam separados de propósito: é a pergunta que
 * se faz quando o caixa não bate. Guardar só um dos dois — ou só no evento —
 * faria o relatório de cancelamentos depender de reconstruir a outbox.
 */
export interface CancelamentoVenda {
  readonly em: Date;
  readonly motivo: string;
  readonly solicitadoPorId: Identificador;
  /** Ausente quando quem cancelou tinha alçada própria. */
  readonly autorizadoPorId: Identificador | undefined;
}

/** O que mudou com uma leitura: um item novo, ou a quantidade de um existente. */
export interface LeituraRegistrada {
  readonly item: VendaItem;
  /** Verdadeiro quando a leitura somou a um item que já estava na venda. */
  readonly somado: boolean;
}

/**
 * Erro de uma operação de venda.
 *
 * Reúne as duas categorias porque quem chama trata as duas do mesmo jeito:
 * exibe a mensagem ao operador. A distinção serve ao adapter HTTP, que escolhe
 * o status a partir de `tipo`.
 */
export type ErroVenda = ErroValidacao | ErroRegraNegocio;

/** Estado completo de uma venda vinda do banco. */
export interface DadosReconstituicaoVenda extends DadosVenda {
  readonly status: StatusVenda;
  readonly finalizadaEm: Date | undefined;
  readonly descontoVenda: Dinheiro;
  readonly itens: readonly VendaItem[];
  readonly pagamentos: readonly Pagamento[];
  readonly suspensao?: SuspensaoVenda | undefined;
  readonly cancelamento?: CancelamentoVenda | undefined;
}

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
  #suspensao: SuspensaoVenda | undefined;
  #cancelamento: CancelamentoVenda | undefined;
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

  /**
   * Reconstrói uma venda já persistida.
   *
   * Uso exclusivo do repositório. Não revalida nem recalcula: os itens voltam
   * com os descontos que tinham, inclusive o rateado, para que uma venda
   * finalizada reimpressa mostre exatamente os mesmos valores do cupom
   * original — inclusive se a regra de rateio mudar depois.
   */
  static reconstituir(dados: DadosReconstituicaoVenda): Venda {
    const venda = new Venda(dados);

    venda.#status = dados.status;
    venda.#finalizadaEm = dados.finalizadaEm;
    venda.#suspensao = dados.suspensao;
    venda.#cancelamento = dados.cancelamento;
    venda.#descontoVenda = dados.descontoVenda;
    venda.#itens.push(...dados.itens);
    venda.#pagamentos.push(...dados.pagamentos);
    venda.#proximoNumeroItem =
      dados.itens.reduce((maior, item) => Math.max(maior, item.numero), 0) + 1;

    return venda;
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

  /** Guardada para depois: aberta, mas fora da frente do operador. */
  get estaSuspensa(): boolean {
    return this.#status === "ABERTA" && this.#suspensao !== undefined;
  }

  get suspensao(): SuspensaoVenda | undefined {
    return this.#suspensao;
  }

  get cancelamento(): CancelamentoVenda | undefined {
    return this.#cancelamento;
  }

  /** Foi cancelada depois de concluída — o caso que estorna estoque e caixa. */
  get foiCanceladaAposFinalizar(): boolean {
    return this.#status === "CANCELADA" && this.#finalizadaEm !== undefined;
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

  /**
   * Sobre o que o desconto da venda incide: os itens já com os descontos
   * próprios. É também a base do percentual que a política de alçada confere —
   * medir o desconto da venda contra o subtotal bruto deixaria um desconto de
   * 10% passar como 8% depois de um desconto de item.
   */
  get baseParaDescontoDaVenda(): Dinheiro {
    return this.subtotal.subtrair(this.descontoItens);
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

  /**
   * Registra uma leitura do balcão: soma ao item igual, ou acrescenta um novo.
   *
   * É o caminho da bipada. A regra de quando somar mora no item
   * (`VendaItem.aceitaSomar`); aqui só se decide **qual** item recebe — o
   * primeiro que aceita, para que o mesmo produto nunca apareça em duas linhas
   * que poderiam ser uma.
   *
   * `adicionarItem` continua existindo para o caminho que precisa repetir a
   * venda exatamente como foi feita: a importação da fila offline traz os itens
   * já decididos pela estação, e somar de novo ali mudaria a venda.
   */
  registrarLeitura(dados: DadosItemVenda): Result<LeituraRegistrada, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    const existente = this.#itens.find((item) => item.aceitaSomar(dados));

    if (existente === undefined) {
      return this.adicionarItem(dados).map((item) => ({ item, somado: false }));
    }

    if (!dados.quantidade.ehPositiva()) {
      return err(
        new ErroValidacao(
          "ITEM_QUANTIDADE_INVALIDA",
          "A quantidade do item deve ser maior que zero.",
        ),
      );
    }

    const somada = existente.quantidade.somar(dados.quantidade);
    if (somada.isErr()) return err(somada.error);

    const alterada = existente.alterarQuantidade(somada.unwrap());
    /* v8 ignore next -- inalcançável: mesma unidade e soma de positivas */
    if (alterada.isErr()) return err(alterada.error);

    this.#descontoVenda = Dinheiro.zero();

    return ok({ item: existente, somado: true });
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

  /**
   * Registra um pagamento.
   *
   * Duas regras protegem o fechamento do caixa:
   *
   * - **Só dinheiro passa do que falta.** O excedente em dinheiro vira troco; o
   *   excedente no cartão ou no Pix é cobrança a mais, que não sai da gaveta e
   *   que ninguém conseguiria explicar depois. Recusar na hora custa uma
   *   correção de digitação; aceitar custa uma divergência no fim do dia.
   * - **Reenvio não duplica.** Com a mesma `chave`, a venda devolve o pagamento
   *   que já tem. É o que torna seguro a estação repetir um envio cuja resposta
   *   se perdeu na rede.
   */
  registrarPagamento(
    codigo: CodigoFormaPagamento,
    valor: Dinheiro,
    opcoes?: OpcoesPagamento,
  ): Result<Pagamento, ErroVenda> {
    const chave = opcoes?.chave?.trim();
    const repetido =
      chave === undefined
        ? undefined
        : this.#pagamentos.find((pagamento) => pagamento.chave === chave);

    // Antes de qualquer outra regra: o reenvio de um pagamento que fechou a
    // venda chegaria com "nada falta" e seria recusado — o oposto do que se
    // quer de uma repetição.
    if (repetido !== undefined) {
      if (repetido.mesmoConteudoQue(codigo, valor)) return ok(repetido);

      return err(
        new ErroValidacao(
          "PAGAMENTO_CHAVE_REPETIDA",
          "Este pagamento já foi registrado com outro valor. Confira a lista de pagamentos.",
          { chave },
        ),
      );
    }

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

    const falta = this.faltaPagar;

    if (falta.ehZero()) {
      return err(
        new ErroRegraNegocio(
          "VENDA_JA_PAGA",
          "O pagamento já cobre o total da venda. Conclua a venda ou remova um pagamento.",
        ),
      );
    }

    const forma = obterFormaPagamento(codigo);

    if (!forma.permiteTroco && valor.maiorQue(falta)) {
      return err(
        new ErroRegraNegocio(
          "PAGAMENTO_ACIMA_DO_RESTANTE",
          `Em ${forma.descricao.toLowerCase()}, o valor não pode passar do que falta (${falta.formatar()}). Só dinheiro tem troco.`,
          { falta: falta.centavos.toString(), valor: valor.centavos.toString() },
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

  // ── Guardar para depois ────────────────────────────────────────────────

  /**
   * Tira a venda da frente do operador sem perdê-la.
   *
   * Venda vazia não se guarda: não há o que retomar, e uma lista de vendas
   * guardadas cheia de nada é o tipo de ruído que faz o operador parar de
   * confiar nela.
   */
  suspender(agora: Date, rotulo?: string): Result<void, ErroVenda> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    if (this.estaVazia) {
      return err(
        new ErroRegraNegocio("VENDA_SEM_ITENS", "Não há itens para guardar nesta venda."),
      );
    }

    const texto = rotulo?.trim();

    if (texto !== undefined && texto.length > TAMANHO_MAXIMO_ROTULO) {
      return err(
        new ErroValidacao(
          "VENDA_ROTULO_LONGO",
          `Use até ${String(TAMANHO_MAXIMO_ROTULO)} letras para identificar a venda guardada.`,
        ),
      );
    }

    this.#suspensao = { em: agora, rotulo: texto === "" ? undefined : texto };

    return ok(undefined);
  }

  /**
   * Traz de volta uma venda guardada.
   *
   * Retomar o que não estava guardado é inofensivo e responde `ok`: a mesma
   * venda pode ser chamada de volta por dois cliques, e o segundo não tem por
   * que virar erro na tela.
   */
  retomar(): Result<void, ErroVenda> {
    if (this.#status !== "ABERTA") {
      return err(
        new ErroRegraNegocio(
          "VENDA_NAO_ESTA_ABERTA",
          this.#status === "FINALIZADA"
            ? "Esta venda já foi finalizada."
            : "Esta venda foi cancelada.",
          { status: this.#status },
        ),
      );
    }

    this.#suspensao = undefined;

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
   * Registra **quem pediu e quem autorizou**: cancelamento é o vetor clássico
   * de desvio — receber do cliente e cancelar a venda depois. Sem os dois
   * nomes, o desvio fica invisível. Quem decide se o pedido precisa de
   * autorização é a política de alçada, fora daqui; o agregado só garante que
   * a resposta fique gravada.
   *
   * Venda guardada também se cancela: é o destino natural da venda que o
   * cliente desistiu de buscar.
   */
  cancelar(dados: {
    readonly motivo: string;
    readonly solicitadoPorId: Identificador;
    readonly autorizadoPorId?: Identificador | undefined;
    readonly agora: Date;
  }): Result<void, ErroVenda> {
    if (this.#status === "CANCELADA") {
      return err(
        new ErroRegraNegocio("VENDA_JA_CANCELADA", "Esta venda já foi cancelada."),
      );
    }

    const motivo = dados.motivo.trim();

    if (motivo === "") {
      return err(
        new ErroValidacao(
          "VENDA_MOTIVO_OBRIGATORIO",
          "Informe o motivo do cancelamento.",
        ),
      );
    }

    if (motivo.length > TAMANHO_MAXIMO_MOTIVO) {
      return err(
        new ErroValidacao(
          "VENDA_MOTIVO_LONGO",
          `Resuma o motivo em até ${String(TAMANHO_MAXIMO_MOTIVO)} letras.`,
        ),
      );
    }

    const eraFinalizada = this.#status === "FINALIZADA";
    this.#status = "CANCELADA";
    this.#suspensao = undefined;
    this.#cancelamento = {
      em: dados.agora,
      motivo,
      solicitadoPorId: dados.solicitadoPorId,
      autorizadoPorId: dados.autorizadoPorId,
    };

    // Venda aberta nunca saiu do caixa: descartá-la não movimentou estoque nem
    // dinheiro, e não há o que estornar.
    if (eraFinalizada) {
      const evento: VendaCancelada = {
        tipo: "VendaCancelada",
        agregadoId: this.id,
        ocorridoEm: dados.agora,
        numero: this.#numero,
        motivo,
        solicitadoPorId: dados.solicitadoPorId,
        autorizadoPorId: dados.autorizadoPorId,
        total: this.total,
        itens: this.#itensVendidos(),
      };

      this.registrarEvento(evento);
    }

    return ok(undefined);
  }

  // ── Interno ────────────────────────────────────────────────────────────

  /**
   * A venda aceita mudança? Aberta **e** na frente do operador.
   *
   * Guardada não aceita: duas estações mexendo na mesma venda guardada é como
   * um item some sem ninguém ter removido. Quem quer alterar, retoma antes.
   */
  #exigirAberta(): ErroRegraNegocio | undefined {
    if (this.#status === "ABERTA") {
      if (this.#suspensao === undefined) return undefined;

      return new ErroRegraNegocio(
        "VENDA_SUSPENSA",
        "Esta venda está guardada. Retome-a para continuar.",
      );
    }

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
