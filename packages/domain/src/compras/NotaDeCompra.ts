import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";

import { type ItemDaNota } from "./ItemDaNota.js";

export type StatusNota = "LANCADA" | "CANCELADA";

const TAMANHO_MAXIMO_NUMERO = 20;
const TAMANHO_MAXIMO_SERIE = 5;
const TAMANHO_MAXIMO_OBSERVACAO = 500;

export interface DadosNotaDeCompra {
  readonly id: Identificador;
  readonly fornecedorId: Identificador;
  /** Número impresso na nota do fornecedor. */
  readonly numero: string;
  readonly serie?: string | undefined;
  readonly emitidaEm: Date;
  readonly recebidaEm: Date;
  readonly itens: readonly ItemDaNota[];
  /**
   * Total impresso na nota, digitado por quem a lançou.
   *
   * Existe para ser **conferido** contra a soma dos itens, não para ser usado
   * no lugar dela. Ver a nota sobre conferência de digitação abaixo.
   */
  readonly totalDeclarado: Dinheiro;
  /** Quem lançou. Nota de entrada é ato de pessoa, e a auditoria precisa dela. */
  readonly usuarioId: Identificador;
  readonly observacao?: string | undefined;
  readonly status?: StatusNota | undefined;
  readonly canceladaEm?: Date | undefined;
  readonly motivoCancelamento?: string | undefined;
}

/**
 * Nota de entrada de mercadoria.
 *
 * É o documento que responde de onde veio o estoque — e, quando o fiscal
 * entrar, de onde veio o crédito de imposto. O movimento de estoque é o
 * **efeito** dela, não o contrário: quem confere uma divergência no inventário
 * precisa chegar do saldo ao movimento, do movimento à nota e da nota ao
 * fornecedor, sem passo faltando.
 *
 * ### Lançamento em um passo, sem rascunho
 *
 * A nota chega em papel e é digitada de uma vez. Separar "rascunho" de
 * "confirmada" dobraria estados, telas e testes para um ganho que só existe
 * quando a nota chega pela metade — o caso da importação de XML, que não está
 * neste corte e é quando o rascunho passa a valer a pena.
 *
 * ### O total declarado é conferência de digitação, não dado
 *
 * A soma dos itens é a verdade; o total impresso na nota é o que quem digitou
 * leu do papel. Quando os dois divergem, alguém errou uma linha — e o lugar de
 * descobrir isso é agora, com a nota na mão, não três meses depois quando o
 * estoque não fecha e ninguém lembra de qual nota veio.
 *
 * ### Correção não apaga: cancela e estorna
 *
 * A nota lançada duas vezes dobra o estoque, e é o defeito mais comum deste
 * módulo. O caminho de volta é o cancelamento, que **preserva** a nota e gera
 * movimentos de estorno — fato imutável, como manda o princípio 5. Apagar a
 * linha deixaria o saldo certo e o histórico mentindo.
 */
export class NotaDeCompra extends AggregateRoot {
  readonly #fornecedorId: Identificador;
  readonly #numero: string;
  readonly #serie: string | undefined;
  readonly #emitidaEm: Date;
  readonly #recebidaEm: Date;
  readonly #itens: readonly ItemDaNota[];
  readonly #totalDeclarado: Dinheiro;
  readonly #usuarioId: Identificador;
  readonly #observacao: string | undefined;
  #status: StatusNota;
  #canceladaEm: Date | undefined;
  #motivoCancelamento: string | undefined;

  private constructor(dados: DadosNotaDeCompra) {
    super(dados.id);
    this.#fornecedorId = dados.fornecedorId;
    this.#numero = dados.numero.trim();
    this.#serie = textoOuIndefinido(dados.serie);
    this.#emitidaEm = dados.emitidaEm;
    this.#recebidaEm = dados.recebidaEm;
    this.#itens = [...dados.itens];
    this.#totalDeclarado = dados.totalDeclarado;
    this.#usuarioId = dados.usuarioId;
    this.#observacao = textoOuIndefinido(dados.observacao);
    this.#status = dados.status ?? "LANCADA";
    this.#canceladaEm = dados.canceladaEm;
    this.#motivoCancelamento = textoOuIndefinido(dados.motivoCancelamento);
  }

  /**
   * Cria a nota validada.
   *
   * Devolve **todos** os erros de uma vez: quem digita uma nota de quarenta
   * linhas não pode descobrir um problema por gravação.
   */
  static criar(dados: DadosNotaDeCompra): Result<NotaDeCompra, ErroValidacao[]> {
    const erros: ErroValidacao[] = [];

    const numero = dados.numero.trim();
    if (numero === "") {
      erros.push(
        new ErroValidacao("NOTA_NUMERO_VAZIO", "Informe o número da nota do fornecedor."),
      );
    } else if (numero.length > TAMANHO_MAXIMO_NUMERO) {
      erros.push(
        new ErroValidacao(
          "NOTA_NUMERO_LONGO",
          `O número deve ter no máximo ${String(TAMANHO_MAXIMO_NUMERO)} caracteres.`,
        ),
      );
    }

    if ((dados.serie ?? "").trim().length > TAMANHO_MAXIMO_SERIE) {
      erros.push(
        new ErroValidacao(
          "NOTA_SERIE_LONGA",
          `A série deve ter no máximo ${String(TAMANHO_MAXIMO_SERIE)} caracteres.`,
        ),
      );
    }

    if ((dados.observacao ?? "").trim().length > TAMANHO_MAXIMO_OBSERVACAO) {
      erros.push(
        new ErroValidacao(
          "NOTA_OBSERVACAO_LONGA",
          `A observação deve ter no máximo ${String(TAMANHO_MAXIMO_OBSERVACAO)} caracteres.`,
        ),
      );
    }

    if (dados.itens.length === 0) {
      erros.push(
        new ErroValidacao(
          "NOTA_SEM_ITENS",
          "A nota precisa de ao menos um item. Sem item, nada entra no estoque.",
        ),
      );
    }

    // Mercadoria recebida antes de a nota ser emitida é data trocada na
    // digitação, e a data errada desalinha o custo médio da ordem em que as
    // compras realmente aconteceram.
    if (dados.recebidaEm.getTime() < dados.emitidaEm.getTime()) {
      erros.push(
        new ErroValidacao(
          "NOTA_RECEBIDA_ANTES_DA_EMISSAO",
          "A data de entrada não pode ser anterior à emissão da nota.",
        ),
      );
    }

    const somaDosItens = somar(dados.itens);

    if (!dados.totalDeclarado.equals(somaDosItens)) {
      erros.push(
        new ErroValidacao(
          "NOTA_TOTAL_NAO_CONFERE",
          `O total da nota (${dados.totalDeclarado.formatar()}) não bate com a soma dos itens (${somaDosItens.formatar()}). Confira as linhas.`,
          {
            declarado: dados.totalDeclarado.centavos.toString(),
            somado: somaDosItens.centavos.toString(),
          },
        ),
      );
    }

    if (erros.length > 0) return err(erros);

    return ok(new NotaDeCompra(dados));
  }

  /** Reconstrói uma nota já persistida. Não revalida — ver `Produto.reconstituir`. */
  static reconstituir(dados: DadosNotaDeCompra): NotaDeCompra {
    return new NotaDeCompra(dados);
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get fornecedorId(): Identificador {
    return this.#fornecedorId;
  }

  get numero(): string {
    return this.#numero;
  }

  get serie(): string | undefined {
    return this.#serie;
  }

  get emitidaEm(): Date {
    return this.#emitidaEm;
  }

  get recebidaEm(): Date {
    return this.#recebidaEm;
  }

  get itens(): readonly ItemDaNota[] {
    return this.#itens;
  }

  get totalDeclarado(): Dinheiro {
    return this.#totalDeclarado;
  }

  /** A verdade: a soma das linhas. */
  get total(): Dinheiro {
    return somar(this.#itens);
  }

  get usuarioId(): Identificador {
    return this.#usuarioId;
  }

  get observacao(): string | undefined {
    return this.#observacao;
  }

  get status(): StatusNota {
    return this.#status;
  }

  get estaCancelada(): boolean {
    return this.#status === "CANCELADA";
  }

  get canceladaEm(): Date | undefined {
    return this.#canceladaEm;
  }

  get motivoCancelamento(): string | undefined {
    return this.#motivoCancelamento;
  }

  /**
   * Identificação da nota como o fornecedor a emitiu.
   *
   * É por ela que a duplicidade é detectada: a mesma nota lançada duas vezes
   * dobra o estoque, e é o defeito mais comum da entrada de mercadoria.
   */
  get chave(): string {
    return `${this.#numero}/${this.#serie ?? ""}`;
  }

  // ── Regras de negócio ──────────────────────────────────────────────────

  /**
   * Cancela a nota.
   *
   * Não apaga nada: a nota continua existindo, marcada, e quem cancelou fica
   * registrado. O estorno do estoque é responsabilidade de quem chama — o
   * agregado não conhece movimento de estoque, e não deve conhecer.
   *
   * O motivo é **obrigatório** pelo mesmo raciocínio do ajuste de estoque:
   * cancelamento sem justificativa é a forma silenciosa de fazer mercadoria
   * desaparecer do histórico.
   */
  cancelar(agora: Date, motivo: string): Result<void, ErroRegraNegocio> {
    if (this.#status === "CANCELADA") {
      return err(
        new ErroRegraNegocio("NOTA_JA_CANCELADA", "Esta nota já foi cancelada."),
      );
    }

    const limpo = motivo.trim();

    if (limpo === "") {
      return err(
        new ErroRegraNegocio(
          "NOTA_CANCELAMENTO_SEM_MOTIVO",
          "Informe o motivo do cancelamento.",
        ),
      );
    }

    this.#status = "CANCELADA";
    this.#canceladaEm = agora;
    this.#motivoCancelamento = limpo.slice(0, TAMANHO_MAXIMO_OBSERVACAO);

    this.registrarEvento({
      tipo: "NotaDeCompraCancelada",
      agregadoId: this.id,
      ocorridoEm: agora,
    });

    return ok(undefined);
  }
}

function somar(itens: readonly ItemDaNota[]): Dinheiro {
  return itens.reduce((acumulado, item) => acumulado.somar(item.total), Dinheiro.zero());
}

function textoOuIndefinido(bruto: string | undefined): string | undefined {
  const limpo = bruto?.trim();
  return limpo === undefined || limpo === "" ? undefined : limpo;
}
