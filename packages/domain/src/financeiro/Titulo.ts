import { textoOpcional } from "@erp/utils";

import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";

/**
 * Um título a receber ou a pagar.
 *
 * ### É a caderneta, e a caderneta é onde o dono mais perde dinheiro
 *
 * `docs/ANALISE-SEGMENTOS.md` §3.3: o fiado em papel é a realidade dominante do
 * varejo de bairro, e é justamente onde o dinheiro some. O que o papel não faz
 * — e o motivo de o lojista comprar o sistema — é responder "quem me deve, e
 * desde quando".
 *
 * ### Baixas são append-only
 *
 * O saldo **não** é coluna: é o valor original menos a soma das baixas
 * (princípio 5). Corrigir um recebimento errado gera um estorno, nunca um
 * `UPDATE` — porque o cliente que pagou R$ 50 e viu o valor sumir do histórico
 * não confia mais na caderneta do sistema do que confiava na de papel.
 *
 * ### Sem juros nem multa, por decisão
 *
 * A caderneta de bairro é relação de confiança, e cobrar encargos exige
 * contrato assinado — sem ele, é risco jurídico para o lojista. O **vencimento
 * é gravado desde já**, então ligar juros depois não exige migrar dado nenhum.
 */

export const TIPOS_TITULO = ["RECEBER", "PAGAR"] as const;
export type TipoTitulo = (typeof TIPOS_TITULO)[number];

export function ehTipoTitulo(valor: string): valor is TipoTitulo {
  return (TIPOS_TITULO as readonly string[]).includes(valor);
}

/**
 * De onde o título veio.
 *
 * `VENDA` e `COMPRA` apontam para o documento que os gerou — é o que permite,
 * meses depois, responder "de que compra é esta dívida" sem adivinhação.
 * `MANUAL` é o aluguel, a luz, o contador: despesa que não nasce de documento
 * nenhum dentro do sistema.
 */
export const ORIGENS_TITULO = ["VENDA", "COMPRA", "MANUAL"] as const;
export type OrigemTitulo = (typeof ORIGENS_TITULO)[number];

export function ehOrigemTitulo(valor: string): valor is OrigemTitulo {
  return (ORIGENS_TITULO as readonly string[]).includes(valor);
}

export const SITUACOES_TITULO = ["ABERTO", "PARCIAL", "QUITADO", "CANCELADO"] as const;
export type SituacaoTitulo = (typeof SITUACOES_TITULO)[number];

/**
 * Um lançamento no título.
 *
 * `PAGAMENTO` abate, `ESTORNO` devolve. Guardar os dois em vez de apagar o
 * errado é o que mantém o histórico legível: "recebi R$ 50 dia 3, estornei dia
 * 4 porque foi lançado no cliente errado" conta a história inteira.
 */
export interface Baixa {
  readonly id: Identificador;
  readonly tipo: "PAGAMENTO" | "ESTORNO";
  readonly valor: Dinheiro;
  readonly ocorridaEm: Date;
  readonly usuarioId: Identificador;
  /** Como o dinheiro entrou ou saiu. Ausente no estorno. */
  readonly forma?: string | undefined;
  readonly observacao?: string | undefined;
  /** Preenchido no estorno: qual baixa ele desfaz. */
  readonly estornaId?: Identificador | undefined;
}

export interface DadosTitulo {
  readonly id: Identificador;
  readonly tipo: TipoTitulo;
  readonly origem: OrigemTitulo;
  /** Venda ou nota de compra que o gerou. Ausente quando `MANUAL`. */
  readonly documentoId?: Identificador | undefined;
  /**
   * Cliente (a receber) ou fornecedor (a pagar).
   *
   * Obrigatório quando vem de venda ou compra; opcional no manual, porque a
   * conta de luz não tem fornecedor cadastrado e exigi-lo faria o lojista
   * cadastrar a concessionária para lançar uma despesa.
   */
  readonly contraparteId?: Identificador | undefined;
  /** Nome de quem deve ou de quem se deve, congelado no lançamento. */
  readonly contraparteNome: string;
  readonly valorOriginal: Dinheiro;
  readonly vencimento: Date;
  readonly emitidoEm: Date;
  /** `2 de 6`, para o crediário parcelado. Ausente no título único. */
  readonly parcela?: { readonly numero: number; readonly de: number } | undefined;
  readonly descricao?: string | undefined;
  readonly baixas?: readonly Baixa[] | undefined;
  readonly canceladoEm?: Date | undefined;
  readonly motivoCancelamento?: string | undefined;
}

const TAMANHO_MAXIMO_DESCRICAO = 200;

export class Titulo extends AggregateRoot {
  readonly #tipo: TipoTitulo;
  readonly #origem: OrigemTitulo;
  readonly #documentoId: Identificador | undefined;
  readonly #contraparteId: Identificador | undefined;
  readonly #contraparteNome: string;
  readonly #valorOriginal: Dinheiro;
  #vencimento: Date;
  readonly #emitidoEm: Date;
  readonly #parcela: { readonly numero: number; readonly de: number } | undefined;
  #descricao: string | undefined;
  #baixas: Baixa[];
  #canceladoEm: Date | undefined;
  #motivoCancelamento: string | undefined;

  private constructor(dados: DadosTitulo) {
    super(dados.id);
    this.#tipo = dados.tipo;
    this.#origem = dados.origem;
    this.#documentoId = dados.documentoId;
    this.#contraparteId = dados.contraparteId;
    this.#contraparteNome = dados.contraparteNome.trim();
    this.#valorOriginal = dados.valorOriginal;
    this.#vencimento = dados.vencimento;
    this.#emitidoEm = dados.emitidoEm;
    this.#parcela = dados.parcela;
    this.#descricao = textoOpcional(dados.descricao);
    this.#baixas = [...(dados.baixas ?? [])];
    this.#canceladoEm = dados.canceladoEm;
    this.#motivoCancelamento = textoOpcional(dados.motivoCancelamento);
  }

  // ── Construção ─────────────────────────────────────────────────────────

  static criar(dados: DadosTitulo): Result<Titulo, ErroValidacao[]> {
    const erros = validar(dados);

    return erros.length > 0 ? err(erros) : ok(new Titulo(dados));
  }

  /** Reconstrói o que já está no banco. Não revalida — ver `Produto`. */
  static reconstituir(dados: DadosTitulo): Titulo {
    return new Titulo(dados);
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get tipo(): TipoTitulo {
    return this.#tipo;
  }

  get origem(): OrigemTitulo {
    return this.#origem;
  }

  get documentoId(): Identificador | undefined {
    return this.#documentoId;
  }

  get contraparteId(): Identificador | undefined {
    return this.#contraparteId;
  }

  get contraparteNome(): string {
    return this.#contraparteNome;
  }

  get valorOriginal(): Dinheiro {
    return this.#valorOriginal;
  }

  get vencimento(): Date {
    return this.#vencimento;
  }

  get emitidoEm(): Date {
    return this.#emitidoEm;
  }

  get parcela(): { readonly numero: number; readonly de: number } | undefined {
    return this.#parcela;
  }

  get descricao(): string | undefined {
    return this.#descricao;
  }

  get baixas(): readonly Baixa[] {
    return this.#baixas;
  }

  get canceladoEm(): Date | undefined {
    return this.#canceladoEm;
  }

  get motivoCancelamento(): string | undefined {
    return this.#motivoCancelamento;
  }

  /** Quanto já foi pago, líquido de estornos. */
  get totalBaixado(): Dinheiro {
    return this.#baixas.reduce(
      (acumulado, baixa) =>
        baixa.tipo === "PAGAMENTO"
          ? acumulado.somar(baixa.valor)
          : acumulado.subtrair(baixa.valor),
      Dinheiro.zero(),
    );
  }

  /** Quanto ainda falta. Nunca negativo: pagamento a mais é recusado na entrada. */
  get saldo(): Dinheiro {
    return this.#valorOriginal.subtrair(this.totalBaixado);
  }

  /**
   * Situação derivada, nunca guardada.
   *
   * Coluna de status é um segundo lugar onde a verdade mora, e o dia em que ela
   * discordar das baixas ninguém saberá qual das duas está certa.
   */
  get situacao(): SituacaoTitulo {
    if (this.#canceladoEm !== undefined) return "CANCELADO";
    if (this.saldo.ehZero()) return "QUITADO";
    if (this.totalBaixado.ehPositivo()) return "PARCIAL";

    return "ABERTO";
  }

  get estaQuitado(): boolean {
    return this.situacao === "QUITADO";
  }

  get estaCancelado(): boolean {
    return this.situacao === "CANCELADO";
  }

  /**
   * Vencido em relação a uma data.
   *
   * A data chega por parâmetro em vez de vir de `new Date()`: o domínio não
   * conhece relógio (princípio 2), e teste com relógio real não é
   * determinístico.
   *
   * A comparação é por **dia**, não por instante. Um título que vence hoje não
   * está vencido às 8h da manhã e vencido às 18h — para o lojista, ele vence no
   * fim do dia.
   */
  estaVencidoEm(momento: Date): boolean {
    if (this.estaQuitado || this.estaCancelado) return false;

    return diaDe(momento) > diaDe(this.#vencimento);
  }

  /** Dias de atraso, ou zero. Serve ao relatório de cobrança. */
  diasEmAtrasoEm(momento: Date): number {
    if (!this.estaVencidoEm(momento)) return 0;

    const umDia = 24 * 60 * 60 * 1000;

    return Math.floor((diaDe(momento) - diaDe(this.#vencimento)) / umDia);
  }

  // ── Baixa ──────────────────────────────────────────────────────────────

  /**
   * Registra um recebimento ou pagamento parcial.
   *
   * Recusa valor acima do saldo. Aceitar produziria saldo negativo, que na tela
   * vira "a loja deve ao cliente" — e o operador que digitou um zero a mais só
   * descobriria no acerto de contas, meses depois.
   */
  registrarBaixa(
    baixa: Omit<Baixa, "tipo" | "estornaId">,
  ): Result<void, ErroRegraNegocio> {
    if (this.estaCancelado) {
      return err(
        new ErroRegraNegocio(
          "TITULO_CANCELADO",
          "Este título foi cancelado e não aceita baixa.",
        ),
      );
    }

    if (this.estaQuitado) {
      return err(
        new ErroRegraNegocio("TITULO_JA_QUITADO", "Este título já está quitado."),
      );
    }

    if (!baixa.valor.ehPositivo()) {
      return err(
        new ErroRegraNegocio("BAIXA_VALOR_INVALIDO", "Informe um valor maior que zero."),
      );
    }

    if (baixa.valor.maiorQue(this.saldo)) {
      return err(
        new ErroRegraNegocio(
          "BAIXA_ACIMA_DO_SALDO",
          `O valor é maior que o saldo de ${this.saldo.formatar()}.`,
          { saldo: this.saldo.centavos.toString() },
        ),
      );
    }

    this.#baixas.push({ ...baixa, tipo: "PAGAMENTO" });

    return ok(undefined);
  }

  /**
   * Desfaz uma baixa, sem apagá-la.
   *
   * O caso real é o recebimento lançado no cliente errado — acontece no balcão
   * cheio, com dois homônimos na lista. O estorno devolve o saldo e **deixa os
   * dois lançamentos à vista**, que é o que permite explicar ao cliente o que
   * houve.
   */
  estornarBaixa(
    baixaId: Identificador,
    estorno: {
      readonly id: Identificador;
      readonly ocorridaEm: Date;
      readonly usuarioId: Identificador;
      readonly observacao?: string | undefined;
    },
  ): Result<void, ErroRegraNegocio> {
    const alvo = this.#baixas.find(
      (baixa) => baixa.tipo === "PAGAMENTO" && baixa.id.equals(baixaId),
    );

    if (alvo === undefined) {
      return err(
        new ErroRegraNegocio(
          "BAIXA_NAO_ENCONTRADA",
          "O recebimento a estornar não foi encontrado neste título.",
        ),
      );
    }

    const jaEstornada = this.#baixas.some(
      (baixa) => baixa.tipo === "ESTORNO" && baixa.estornaId?.equals(baixaId) === true,
    );

    if (jaEstornada) {
      return err(
        new ErroRegraNegocio("BAIXA_JA_ESTORNADA", "Este recebimento já foi estornado."),
      );
    }

    this.#baixas.push({
      id: estorno.id,
      tipo: "ESTORNO",
      valor: alvo.valor,
      ocorridaEm: estorno.ocorridaEm,
      usuarioId: estorno.usuarioId,
      observacao: estorno.observacao,
      estornaId: baixaId,
    });

    return ok(undefined);
  }

  // ── Alteração ──────────────────────────────────────────────────────────

  /**
   * Adia o vencimento.
   *
   * É a renegociação de balcão: "consegue pagar dia 20?". Só para frente —
   * antecipar o vencimento transformaria em atraso uma dívida que estava em dia,
   * e o relatório de cobrança passaria a chamar quem não devia ser chamado.
   */
  adiarVencimento(novo: Date, motivo?: string): Result<void, ErroRegraNegocio> {
    if (this.estaCancelado) {
      return err(new ErroRegraNegocio("TITULO_CANCELADO", "Este título foi cancelado."));
    }

    if (this.estaQuitado) {
      return err(
        new ErroRegraNegocio(
          "TITULO_JA_QUITADO",
          "Este título já está quitado; não há vencimento a adiar.",
        ),
      );
    }

    if (diaDe(novo) <= diaDe(this.#vencimento)) {
      return err(
        new ErroRegraNegocio(
          "VENCIMENTO_NAO_ADIADO",
          "A nova data precisa ser posterior ao vencimento atual.",
        ),
      );
    }

    this.#vencimento = novo;

    const texto = textoOpcional(motivo);
    if (texto !== undefined) this.#descricao = texto;

    return ok(undefined);
  }

  /**
   * Cancela o título.
   *
   * Exige motivo por escrito: um título que some sem explicação é exatamente a
   * brecha que o controle de fiado existe para fechar. Título com recebimento
   * lançado **não** cancela — o caminho é estornar as baixas primeiro, para que
   * o dinheiro que entrou não desapareça junto.
   */
  cancelar(momento: Date, motivo: string): Result<void, ErroRegraNegocio> {
    if (this.estaCancelado) {
      return err(
        new ErroRegraNegocio("TITULO_CANCELADO", "Este título já foi cancelado."),
      );
    }

    if (this.totalBaixado.ehPositivo()) {
      return err(
        new ErroRegraNegocio(
          "TITULO_COM_BAIXA",
          "Estorne os recebimentos antes de cancelar o título.",
          { totalBaixado: this.totalBaixado.centavos.toString() },
        ),
      );
    }

    const texto = textoOpcional(motivo);

    if (texto === undefined) {
      return err(
        new ErroRegraNegocio("MOTIVO_OBRIGATORIO", "Informe o motivo do cancelamento."),
      );
    }

    this.#canceladoEm = momento;
    this.#motivoCancelamento = texto;

    return ok(undefined);
  }
}

/** Meia-noite do dia, para comparar vencimento sem depender da hora. */
function diaDe(momento: Date): number {
  return Date.UTC(momento.getUTCFullYear(), momento.getUTCMonth(), momento.getUTCDate());
}

function validar(dados: DadosTitulo): ErroValidacao[] {
  const erros: ErroValidacao[] = [];

  if (!dados.valorOriginal.ehPositivo()) {
    erros.push(
      new ErroValidacao("TITULO_VALOR_INVALIDO", "O valor do título deve ser positivo."),
    );
  }

  if (dados.contraparteNome.trim() === "") {
    erros.push(
      new ErroValidacao("TITULO_CONTRAPARTE_OBRIGATORIA", "Informe de quem é a conta."),
    );
  }

  // Título de venda sem cliente é fiado sem devedor: a caderneta perde a única
  // coisa que a torna útil.
  if (dados.origem !== "MANUAL" && dados.contraparteId === undefined) {
    erros.push(
      new ErroValidacao(
        "TITULO_CONTRAPARTE_OBRIGATORIA",
        "Título de venda ou compra precisa do cliente ou do fornecedor.",
      ),
    );
  }

  if (dados.origem !== "MANUAL" && dados.documentoId === undefined) {
    erros.push(
      new ErroValidacao(
        "TITULO_DOCUMENTO_OBRIGATORIO",
        "Título de venda ou compra precisa apontar para o documento de origem.",
      ),
    );
  }

  const descricao = textoOpcional(dados.descricao);

  if (descricao !== undefined && descricao.length > TAMANHO_MAXIMO_DESCRICAO) {
    erros.push(
      new ErroValidacao(
        "TITULO_DESCRICAO_LONGA",
        `A descrição deve ter no máximo ${String(TAMANHO_MAXIMO_DESCRICAO)} caracteres.`,
      ),
    );
  }

  if (dados.parcela !== undefined) {
    const { numero, de } = dados.parcela;

    if (!Number.isInteger(numero) || !Number.isInteger(de) || numero < 1 || de < 1) {
      erros.push(new ErroValidacao("TITULO_PARCELA_INVALIDA", "Parcela inválida."));
    } else if (numero > de) {
      erros.push(
        new ErroValidacao(
          "TITULO_PARCELA_INVALIDA",
          `Não existe parcela ${String(numero)} de ${String(de)}.`,
        ),
      );
    }
  }

  return erros;
}
