import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import {
  type CodigoFormaPagamento,
  type FormaPagamento,
  obterFormaPagamento,
} from "../vendas/FormaPagamento.js";

import { MovimentoCaixa } from "./MovimentoCaixa.js";

export type StatusCaixa = "ABERTA" | "FECHADA";

export type ErroCaixa = ErroValidacao | ErroRegraNegocio;

/** Pagamento de uma venda, no formato que o caixa precisa acumular. */
export interface PagamentoResumido {
  readonly forma: CodigoFormaPagamento;
  readonly valor: Dinheiro;
}

/**
 * Resumo de uma venda para o caixa.
 *
 * A sessão recebe o **resumo**, não a venda inteira: uma sessão com 2.000
 * vendas carregadas para abrir a gaveta quebraria a meta de resposta do PDV
 * (RNF-01). O caixa só precisa dos totais.
 */
export interface ResumoVenda {
  readonly vendaId: Identificador;
  readonly total: Dinheiro;
  readonly pagamentos: readonly PagamentoResumido[];
  readonly troco: Dinheiro;
}

/** Conferência de uma forma de pagamento no fechamento. */
export interface ConferenciaForma {
  readonly forma: FormaPagamento;
  readonly esperado: Dinheiro;
  readonly contado: Dinheiro | undefined;
  /** `contado − esperado`. Positivo é sobra, negativo é falta. */
  readonly divergencia: Dinheiro | undefined;
}

/** Resultado completo do fechamento. */
export interface ConferenciaCaixa {
  readonly fundoTroco: Dinheiro;
  readonly recebidoEmDinheiro: Dinheiro;
  readonly trocoDevolvido: Dinheiro;
  readonly suprimentos: Dinheiro;
  readonly sangrias: Dinheiro;
  /** Quanto deveria haver fisicamente na gaveta. */
  readonly esperadoEmDinheiro: Dinheiro;
  readonly contadoEmDinheiro: Dinheiro;
  readonly divergenciaEmDinheiro: Dinheiro;
  readonly porForma: readonly ConferenciaForma[];
  /** Vendido no crediário — a receber, e por isso fora da conferência. */
  readonly totalAReceber: Dinheiro;
  readonly totalVendido: Dinheiro;
  readonly quantidadeVendas: number;
}

/** Estado completo de uma sessão vinda do banco. */
export interface DadosReconstituicaoCaixa extends DadosSessaoCaixa {
  readonly status: StatusCaixa;
  readonly fechadaEm: Date | undefined;
  readonly trocoDevolvido: Dinheiro;
  readonly totalVendido: Dinheiro;
  readonly quantidadeVendas: number;
  readonly movimentos: readonly MovimentoCaixa[];
  /** Totais por forma de pagamento. */
  readonly recebidos: ReadonlyMap<CodigoFormaPagamento, Dinheiro>;
}

export interface DadosSessaoCaixa {
  readonly id: Identificador;
  readonly estacaoId: Identificador;
  readonly operadorId: Identificador;
  /** Dinheiro deixado na gaveta para dar troco. */
  readonly fundoTroco: Dinheiro;
  readonly abertaEm: Date;
}

/**
 * Sessão de caixa — do "bom dia" ao fechamento.
 *
 * O fechamento é o momento em que o dono descobre se o dia fechou. Por isso a
 * regra que mais importa aqui é a separação entre **recebido** e **a receber**:
 * crediário não entra na gaveta e não pode ser confrontado com a contagem
 * (`docs/ANALISE-SEGMENTOS.md` §3.3). Somá-lo faria o caixa acusar falta todo
 * dia, e o operador aprenderia a ignorar a divergência — que é justamente o
 * sinal que precisa ser levado a sério.
 *
 * **Divergência nunca impede o fechamento.** Bloquear deixaria o caixa aberto
 * indefinidamente, com a loja parada. A divergência é registrada e vira alerta
 * na retaguarda.
 */
export class SessaoCaixa extends AggregateRoot {
  readonly #estacaoId: Identificador;
  readonly #operadorId: Identificador;
  readonly #fundoTroco: Dinheiro;
  readonly #abertaEm: Date;
  readonly #recebidoPorForma = new Map<CodigoFormaPagamento, Dinheiro>();
  readonly #movimentos: MovimentoCaixa[] = [];
  #trocoDevolvido = Dinheiro.zero();
  #totalVendido = Dinheiro.zero();
  #quantidadeVendas = 0;
  #status: StatusCaixa = "ABERTA";
  #fechadaEm: Date | undefined;
  #conferencia: ConferenciaCaixa | undefined;

  private constructor(dados: DadosSessaoCaixa) {
    super(dados.id);
    this.#estacaoId = dados.estacaoId;
    this.#operadorId = dados.operadorId;
    this.#fundoTroco = dados.fundoTroco;
    this.#abertaEm = dados.abertaEm;
  }

  static abrir(dados: DadosSessaoCaixa): Result<SessaoCaixa, ErroValidacao> {
    if (dados.fundoTroco.ehNegativo()) {
      return err(
        new ErroValidacao(
          "CAIXA_FUNDO_NEGATIVO",
          "O fundo de troco não pode ser negativo.",
        ),
      );
    }

    return ok(new SessaoCaixa(dados));
  }

  /**
   * Reconstrói uma sessão já persistida.
   *
   * Uso exclusivo do repositório. Recebe os **totais** por forma de pagamento,
   * não a lista de vendas — que é justamente o que mantém a abertura de caixa
   * rápida mesmo com milhares de vendas no dia.
   */
  static reconstituir(dados: DadosReconstituicaoCaixa): SessaoCaixa {
    const sessao = new SessaoCaixa(dados);

    sessao.#status = dados.status;
    sessao.#fechadaEm = dados.fechadaEm;
    sessao.#trocoDevolvido = dados.trocoDevolvido;
    sessao.#totalVendido = dados.totalVendido;
    sessao.#quantidadeVendas = dados.quantidadeVendas;
    sessao.#movimentos.push(...dados.movimentos);

    for (const [forma, valor] of dados.recebidos) {
      sessao.#recebidoPorForma.set(forma, valor);
    }

    return sessao;
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get estacaoId(): Identificador {
    return this.#estacaoId;
  }

  get operadorId(): Identificador {
    return this.#operadorId;
  }

  get fundoTroco(): Dinheiro {
    return this.#fundoTroco;
  }

  get abertaEm(): Date {
    return this.#abertaEm;
  }

  get fechadaEm(): Date | undefined {
    return this.#fechadaEm;
  }

  get status(): StatusCaixa {
    return this.#status;
  }

  get estaAberta(): boolean {
    return this.#status === "ABERTA";
  }

  get movimentos(): readonly MovimentoCaixa[] {
    return this.#movimentos;
  }

  get quantidadeVendas(): number {
    return this.#quantidadeVendas;
  }

  get totalVendido(): Dinheiro {
    return this.#totalVendido;
  }

  get trocoDevolvido(): Dinheiro {
    return this.#trocoDevolvido;
  }

  /** Conferência produzida no fechamento. */
  get conferencia(): ConferenciaCaixa | undefined {
    return this.#conferencia;
  }

  /** Total recebido numa forma específica. */
  recebidoEm(forma: CodigoFormaPagamento): Dinheiro {
    return this.#recebidoPorForma.get(forma) ?? Dinheiro.zero();
  }

  get suprimentos(): Dinheiro {
    return this.#somarMovimentos("SUPRIMENTO");
  }

  get sangrias(): Dinheiro {
    return this.#somarMovimentos("SANGRIA");
  }

  /**
   * Dinheiro que deveria estar na gaveta agora.
   *
   * Conta apenas o que é físico: fundo de troco, dinheiro recebido menos o
   * troco devolvido, mais suprimentos, menos sangrias. Cartão, PIX e crediário
   * ficam de fora — não passam pela gaveta.
   */
  get esperadoEmDinheiro(): Dinheiro {
    return this.#fundoTroco
      .somar(this.recebidoEm("DINHEIRO"))
      .subtrair(this.#trocoDevolvido)
      .somar(this.suprimentos)
      .subtrair(this.sangrias);
  }

  /** Vendido no crediário: a receber, fora da conferência de caixa. */
  get totalAReceber(): Dinheiro {
    let total = Dinheiro.zero();
    for (const [codigo, valor] of this.#recebidoPorForma) {
      if (obterFormaPagamento(codigo).geraContaReceber) {
        total = total.somar(valor);
      }
    }
    return total;
  }

  // ── Vendas ─────────────────────────────────────────────────────────────

  registrarVenda(resumo: ResumoVenda): Result<void, ErroCaixa> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    for (const pagamento of resumo.pagamentos) {
      this.#acumular(pagamento.forma, pagamento.valor);
    }

    this.#trocoDevolvido = this.#trocoDevolvido.somar(resumo.troco);
    this.#totalVendido = this.#totalVendido.somar(resumo.total);
    this.#quantidadeVendas += 1;

    return ok(undefined);
  }

  /**
   * Estorna uma venda cancelada.
   *
   * Subtrai os mesmos valores que a venda somou. O caixa precisa refletir o
   * cancelamento, senão fecha com sobra que não existe na gaveta.
   */
  registrarCancelamento(resumo: ResumoVenda): Result<void, ErroCaixa> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    for (const pagamento of resumo.pagamentos) {
      this.#acumular(pagamento.forma, pagamento.valor.negar());
    }

    this.#trocoDevolvido = this.#trocoDevolvido.subtrair(resumo.troco);
    this.#totalVendido = this.#totalVendido.subtrair(resumo.total);
    this.#quantidadeVendas -= 1;

    return ok(undefined);
  }

  // ── Sangria e suprimento ───────────────────────────────────────────────

  registrarSangria(
    id: Identificador,
    valor: Dinheiro,
    motivo: string,
    usuarioId: Identificador,
    agora: Date,
    autorizadoPorId?: Identificador,
  ): Result<MovimentoCaixa, ErroCaixa> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    // Retirar mais do que há na gaveta é fisicamente impossível — se o sistema
    // aceitasse, o fechamento acusaria falta inventada pelo próprio registro.
    if (valor.maiorQue(this.esperadoEmDinheiro)) {
      return err(
        new ErroRegraNegocio(
          "CAIXA_SANGRIA_MAIOR_QUE_SALDO",
          `Não há esse valor na gaveta. Disponível: ${this.esperadoEmDinheiro.formatar()}.`,
          {
            disponivel: this.esperadoEmDinheiro.centavos.toString(),
            solicitado: valor.centavos.toString(),
          },
        ),
      );
    }

    return this.#registrarMovimento({
      id,
      tipo: "SANGRIA",
      valor,
      motivo,
      usuarioId,
      autorizadoPorId,
      ocorridoEm: agora,
    });
  }

  registrarSuprimento(
    id: Identificador,
    valor: Dinheiro,
    motivo: string,
    usuarioId: Identificador,
    agora: Date,
  ): Result<MovimentoCaixa, ErroCaixa> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    return this.#registrarMovimento({
      id,
      tipo: "SUPRIMENTO",
      valor,
      motivo,
      usuarioId,
      ocorridoEm: agora,
    });
  }

  // ── Fechamento ─────────────────────────────────────────────────────────

  /**
   * Fecha o caixa e produz a conferência.
   *
   * A divergência é **calculada e registrada, nunca bloqueia**. Impedir o
   * fechamento por diferença de caixa deixaria a loja com o caixa aberto e o
   * operador sem saída — e a diferença continuaria existindo de qualquer forma.
   */
  fechar(
    contadoEmDinheiro: Dinheiro,
    agora: Date,
    contagemPorForma?: Partial<Record<CodigoFormaPagamento, Dinheiro>>,
  ): Result<ConferenciaCaixa, ErroCaixa> {
    const bloqueio = this.#exigirAberta();
    if (bloqueio !== undefined) return err(bloqueio);

    if (contadoEmDinheiro.ehNegativo()) {
      return err(
        new ErroValidacao(
          "CAIXA_CONTAGEM_NEGATIVA",
          "O valor contado não pode ser negativo.",
        ),
      );
    }

    const esperado = this.esperadoEmDinheiro;

    const conferencia: ConferenciaCaixa = {
      fundoTroco: this.#fundoTroco,
      recebidoEmDinheiro: this.recebidoEm("DINHEIRO"),
      trocoDevolvido: this.#trocoDevolvido,
      suprimentos: this.suprimentos,
      sangrias: this.sangrias,
      esperadoEmDinheiro: esperado,
      contadoEmDinheiro,
      divergenciaEmDinheiro: contadoEmDinheiro.subtrair(esperado),
      porForma: this.#conferirFormas(contagemPorForma),
      totalAReceber: this.totalAReceber,
      totalVendido: this.#totalVendido,
      quantidadeVendas: this.#quantidadeVendas,
    };

    this.#status = "FECHADA";
    this.#fechadaEm = agora;
    this.#conferencia = conferencia;

    this.registrarEvento({
      tipo: "CaixaFechado",
      agregadoId: this.id,
      ocorridoEm: agora,
    });

    return ok(conferencia);
  }

  // ── Interno ────────────────────────────────────────────────────────────

  #exigirAberta(): ErroRegraNegocio | undefined {
    if (this.#status === "ABERTA") return undefined;

    return new ErroRegraNegocio("CAIXA_NAO_ESTA_ABERTO", "Este caixa já foi fechado.", {
      status: this.#status,
    });
  }

  #acumular(forma: CodigoFormaPagamento, valor: Dinheiro): void {
    this.#recebidoPorForma.set(forma, this.recebidoEm(forma).somar(valor));
  }

  #somarMovimentos(tipo: "SANGRIA" | "SUPRIMENTO"): Dinheiro {
    return this.#movimentos
      .filter((movimento) => movimento.tipo === tipo)
      .reduce((soma, movimento) => soma.somar(movimento.valor), Dinheiro.zero());
  }

  #registrarMovimento(
    dados: Parameters<typeof MovimentoCaixa.criar>[0],
  ): Result<MovimentoCaixa, ErroCaixa> {
    const movimento = MovimentoCaixa.criar(dados);
    if (movimento.isErr()) return err(movimento.error);

    this.#movimentos.push(movimento.unwrap());
    return movimento;
  }

  /**
   * Confere cada forma recebida contra o que foi informado.
   *
   * Crediário fica de fora: não é dinheiro recebido, é valor a receber, e
   * confrontá-lo com contagem acusaria falta todos os dias.
   */
  #conferirFormas(
    contagem?: Partial<Record<CodigoFormaPagamento, Dinheiro>>,
  ): readonly ConferenciaForma[] {
    const resultado: ConferenciaForma[] = [];

    for (const [codigo, esperado] of this.#recebidoPorForma) {
      const forma = obterFormaPagamento(codigo);
      if (forma.geraContaReceber) continue;

      const contado = contagem?.[codigo];

      resultado.push({
        forma,
        esperado,
        contado,
        divergencia: contado === undefined ? undefined : contado.subtrair(esperado),
      });
    }

    return resultado;
  }
}
