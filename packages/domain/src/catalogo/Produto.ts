import { normalizarParaBusca } from "@erp/utils";

import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import type { Quantidade } from "../valores/Quantidade.js";
import {
  type CodigoUnidade,
  obterUnidade,
  type UnidadeMedida,
} from "../valores/UnidadeMedida.js";

import type { CodigoBarras } from "./CodigoBarras.js";
import type { Embalagem } from "./Embalagem.js";
import { custoAlterado, precoAlterado } from "./eventos.js";
import type { ReferenciaProduto } from "./ReferenciaProduto.js";

/**
 * Como o produto é vendido.
 *
 * `PESAVEL` é o produto que passa pela balança — carne, frios, hortifruti, pão.
 * A distinção não é cosmética: muda o fluxo de leitura no PDV, porque a etiqueta
 * traz o peso embutido no código de barras (`CodigoBalanca`).
 */
export type TipoProduto = "UNITARIO" | "PESAVEL";

/** Limite do campo `xProd` no layout da NF-e. */
const TAMANHO_MAXIMO_DESCRICAO = 120;
/** Cabe numa linha de impressora térmica de 80 mm (48 colunas). */
const TAMANHO_MAXIMO_DESCRICAO_PDV = 40;
const TAMANHO_MAXIMO_SKU = 30;

/**
 * Dados de entrada para criar um produto.
 *
 * Os campos opcionais são declarados `?: T | undefined` de propósito. Sob
 * `exactOptionalPropertyTypes`, `?: T` significa "a chave pode não existir",
 * e não "pode valer undefined" — o que quebraria quem monta este objeto a
 * partir de um formulário ou de uma linha do banco, onde campo ausente chega
 * como `undefined` explícito.
 */
export interface DadosProduto {
  readonly id: Identificador;
  readonly sku: string;
  readonly descricao: string;
  /** Descrição curta para a tela do PDV e o cupom. Padrão: a descrição truncada. */
  readonly descricaoPdv?: string | undefined;
  readonly tipo: TipoProduto;
  readonly unidadeBase: CodigoUnidade;
  readonly precoVenda: Dinheiro;
  readonly custo?: Dinheiro | undefined;
  readonly codigoBarras?: CodigoBarras | undefined;
  /**
   * Código que identifica o produto **dentro da etiqueta da balança**.
   *
   * É o miolo do EAN-13 impresso no açougue e no hortifruti (`2` + código +
   * peso). Fica separado do código de barras porque não é um: a etiqueta muda a
   * cada pesagem, e só este pedaço identifica o produto.
   */
  readonly codigoBalanca?: string | undefined;
  readonly categoriaId?: Identificador | undefined;
  readonly referencias?: readonly ReferenciaProduto[] | undefined;
  readonly embalagens?: readonly Embalagem[] | undefined;
  /**
   * Perfil tributário. **Opcional por decisão de arquitetura (ADR-0016):** com o
   * módulo fiscal desligado o produto não tem tributação, e nada fora do módulo
   * fiscal pode depender disso.
   */
  readonly perfilTributarioId?: Identificador | undefined;
  readonly ativo?: boolean | undefined;
}

/**
 * Produto do catálogo.
 *
 * Agregado que protege três invariantes que, se violadas, aparecem como
 * prejuízo e não como erro de sistema:
 *
 * 1. **Produto pesável usa unidade fracionável.** Vender 0,5 kg é normal;
 *    "0,5 unidade" não existe e travaria o cálculo do item.
 * 2. **Referências não se duplicam.** Dois produtos com o mesmo código de
 *    fabricante fazem o balconista vender a peça errada.
 * 3. **Embalagem tem fator coerente.** Fator errado lança quantidade errada no
 *    estoque na entrada da mercadoria, e a divergência só aparece no inventário.
 */
export class Produto extends AggregateRoot {
  #sku: string;
  #descricao: string;
  #descricaoPdv: string;
  #descricaoBusca: string;
  readonly #tipo: TipoProduto;
  readonly #unidadeBase: UnidadeMedida;
  #precoVenda: Dinheiro;
  #custo: Dinheiro;
  #codigoBarras: CodigoBarras | undefined;
  #codigoBalanca: string | undefined;
  #categoriaId: Identificador | undefined;
  #perfilTributarioId: Identificador | undefined;
  readonly #referencias: ReferenciaProduto[];
  readonly #embalagens: Embalagem[];
  #ativo: boolean;

  private constructor(dados: DadosProduto, descricaoPdv: string, custo: Dinheiro) {
    super(dados.id);
    this.#sku = dados.sku.trim();
    this.#descricao = dados.descricao.trim();
    this.#descricaoPdv = descricaoPdv;
    this.#descricaoBusca = normalizarParaBusca(dados.descricao);
    this.#tipo = dados.tipo;
    this.#unidadeBase = obterUnidade(dados.unidadeBase);
    this.#precoVenda = dados.precoVenda;
    this.#custo = custo;
    this.#codigoBarras = dados.codigoBarras;
    this.#codigoBalanca =
      dados.codigoBalanca?.trim() === "" ? undefined : dados.codigoBalanca?.trim();
    this.#categoriaId = dados.categoriaId;
    this.#perfilTributarioId = dados.perfilTributarioId;
    this.#referencias = [...(dados.referencias ?? [])];
    this.#embalagens = [...(dados.embalagens ?? [])];
    this.#ativo = dados.ativo ?? true;
  }

  // ── Construção ─────────────────────────────────────────────────────────

  /**
   * Cria um produto validado.
   *
   * Devolve **todos** os erros encontrados, não apenas o primeiro: o cadastro
   * de produto é um formulário longo, e obrigar o usuário a descobrir um erro
   * por vez é desperdício de tempo dele (CLAUDE.md §8, papel UX).
   */
  static criar(dados: DadosProduto): Result<Produto, ErroValidacao[]> {
    const erros: ErroValidacao[] = [];

    const sku = dados.sku.trim();
    if (sku === "") {
      erros.push(new ErroValidacao("PRODUTO_SKU_VAZIO", "Informe o código do produto."));
    } else if (sku.length > TAMANHO_MAXIMO_SKU) {
      erros.push(
        new ErroValidacao(
          "PRODUTO_SKU_LONGO",
          `O código deve ter no máximo ${String(TAMANHO_MAXIMO_SKU)} caracteres.`,
          { tamanho: sku.length },
        ),
      );
    }

    const descricao = dados.descricao.trim();
    if (descricao === "") {
      erros.push(
        new ErroValidacao("PRODUTO_DESCRICAO_VAZIA", "Informe a descrição do produto."),
      );
    } else if (descricao.length > TAMANHO_MAXIMO_DESCRICAO) {
      erros.push(
        new ErroValidacao(
          "PRODUTO_DESCRICAO_LONGA",
          `A descrição deve ter no máximo ${String(TAMANHO_MAXIMO_DESCRICAO)} caracteres.`,
          { tamanho: descricao.length },
        ),
      );
    }

    const descricaoPdv = (dados.descricaoPdv ?? descricao)
      .trim()
      .slice(0, TAMANHO_MAXIMO_DESCRICAO_PDV);

    const unidade = obterUnidade(dados.unidadeBase);

    // Invariante 1: pesável exige unidade fracionável.
    if (dados.tipo === "PESAVEL" && !unidade.fracionavel) {
      erros.push(
        new ErroValidacao(
          "PRODUTO_PESAVEL_UNIDADE_INVALIDA",
          `Produto pesável não pode usar ${unidade.descricao.toLowerCase()}. Escolha uma unidade que aceite fração, como quilo ou litro.`,
          { unidade: unidade.codigo },
        ),
      );
    }

    if (dados.precoVenda.ehNegativo()) {
      erros.push(
        new ErroValidacao(
          "PRODUTO_PRECO_NEGATIVO",
          "O preço de venda não pode ser negativo.",
        ),
      );
    }

    // O código da balança é o miolo da etiqueta, e a balança só imprime dígitos.
    // Letra ou separador aqui produz uma etiqueta que nenhum leitor encontra —
    // e o operador descobre no balcão, com fila.
    const codigoBalanca = dados.codigoBalanca?.trim();
    if (codigoBalanca !== undefined && codigoBalanca !== "") {
      if (!/^\d+$/.test(codigoBalanca)) {
        erros.push(
          new ErroValidacao(
            "PRODUTO_CODIGO_BALANCA_INVALIDO",
            "O código da balança deve conter apenas números.",
            { codigoBalanca },
          ),
        );
      }

      if (dados.tipo !== "PESAVEL") {
        erros.push(
          new ErroValidacao(
            "PRODUTO_CODIGO_BALANCA_SEM_PESAGEM",
            "Só produto pesável tem código de balança.",
            { tipo: dados.tipo },
          ),
        );
      }
    }

    const custo = dados.custo ?? Dinheiro.zero();
    if (custo.ehNegativo()) {
      erros.push(
        new ErroValidacao("PRODUTO_CUSTO_NEGATIVO", "O custo não pode ser negativo."),
      );
    }

    // Invariante 2: referências não se duplicam.
    const referencias = dados.referencias ?? [];
    // `entries()` em vez de índice: a leitura por índice viria tipada como
    // possivelmente ausente e exigiria um `continue` que jamais executa.
    for (const [i, atual] of referencias.entries()) {
      const duplicada = referencias
        .slice(0, i)
        .some((anterior) => anterior.equals(atual));
      if (duplicada) {
        erros.push(
          new ErroValidacao(
            "PRODUTO_REFERENCIA_DUPLICADA",
            `A referência ${atual.valor} está repetida.`,
            { referencia: atual.valor, tipo: atual.tipo },
          ),
        );
      }
    }

    // Invariante 3: embalagens coerentes e sem repetição de unidade.
    const embalagens = dados.embalagens ?? [];
    for (const [i, atual] of embalagens.entries()) {
      if (atual.unidade.codigo === unidade.codigo) {
        erros.push(
          new ErroValidacao(
            "PRODUTO_EMBALAGEM_IGUAL_A_BASE",
            `A embalagem não pode usar a mesma unidade do produto (${unidade.descricao.toLowerCase()}).`,
            { unidade: unidade.codigo },
          ),
        );
      }

      const duplicada = embalagens.slice(0, i).some((anterior) => anterior.equals(atual));
      if (duplicada) {
        erros.push(
          new ErroValidacao(
            "PRODUTO_EMBALAGEM_DUPLICADA",
            `Já existe uma embalagem em ${atual.unidade.descricao.toLowerCase()}.`,
            { unidade: atual.unidade.codigo },
          ),
        );
      }
    }

    if (erros.length > 0) {
      return err(erros);
    }

    return ok(new Produto(dados, descricaoPdv, custo));
  }

  /**
   * Reconstrói um produto já persistido.
   *
   * **Não revalida.** O dado foi validado quando foi gravado, e revalidar na
   * leitura tem dois problemas concretos: gasta trabalho no caminho quente do
   * PDV, e — pior — tornaria ilegível um cadastro antigo se uma regra mudasse
   * depois. Regra nova vale para dado novo; dado velho continua carregando.
   *
   * Uso exclusivo do repositório.
   */
  static reconstituir(dados: DadosProduto & { readonly descricaoPdv: string }): Produto {
    return new Produto(dados, dados.descricaoPdv, dados.custo ?? Dinheiro.zero());
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get sku(): string {
    return this.#sku;
  }

  get descricao(): string {
    return this.#descricao;
  }

  /** Descrição curta, para a tela do PDV e para o cupom. */
  get descricaoPdv(): string {
    return this.#descricaoPdv;
  }

  /** Descrição normalizada — é por ela que a busca do balcão compara. */
  get descricaoBusca(): string {
    return this.#descricaoBusca;
  }

  get tipo(): TipoProduto {
    return this.#tipo;
  }

  get ehPesavel(): boolean {
    return this.#tipo === "PESAVEL";
  }

  get unidadeBase(): UnidadeMedida {
    return this.#unidadeBase;
  }

  get precoVenda(): Dinheiro {
    return this.#precoVenda;
  }

  get custo(): Dinheiro {
    return this.#custo;
  }

  get codigoBarras(): CodigoBarras | undefined {
    return this.#codigoBarras;
  }

  /** Código do produto na etiqueta da balança, quando pesável. */
  get codigoBalanca(): string | undefined {
    return this.#codigoBalanca;
  }

  get categoriaId(): Identificador | undefined {
    return this.#categoriaId;
  }

  get perfilTributarioId(): Identificador | undefined {
    return this.#perfilTributarioId;
  }

  get referencias(): readonly ReferenciaProduto[] {
    return this.#referencias;
  }

  get embalagens(): readonly Embalagem[] {
    return this.#embalagens;
  }

  get ativo(): boolean {
    return this.#ativo;
  }

  // ── Regras de negócio ──────────────────────────────────────────────────

  /** Lucro bruto por unidade: preço menos custo. */
  lucroBruto(): Dinheiro {
    return this.#precoVenda.subtrair(this.#custo);
  }

  /**
   * Indica venda abaixo do custo.
   *
   * Vale um alerta na retaguarda: quase sempre é erro de digitação no preço ou
   * custo desatualizado depois de uma compra, e o dono só descobre no fim do mês.
   */
  vendeAbaixoDoCusto(): boolean {
    return !this.#custo.ehZero() && this.#precoVenda.menorQue(this.#custo);
  }

  /** Calcula o total de uma venda deste produto. */
  calcularTotal(quantidade: Quantidade): Result<Dinheiro, ErroValidacao> {
    if (quantidade.unidade.codigo !== this.#unidadeBase.codigo) {
      return err(
        new ErroValidacao(
          "PRODUTO_UNIDADE_INCOMPATIVEL",
          `Este produto é vendido em ${this.#unidadeBase.descricao.toLowerCase()}.`,
          {
            esperada: this.#unidadeBase.codigo,
            recebida: quantidade.unidade.codigo,
          },
        ),
      );
    }

    if (quantidade.ehNegativa()) {
      return err(
        new ErroValidacao(
          "PRODUTO_QUANTIDADE_NEGATIVA",
          "A quantidade deve ser maior que zero.",
        ),
      );
    }

    // Milésimos como fator, com escala 1000: preço × peso sem ponto flutuante.
    return ok(this.#precoVenda.escalar(quantidade.milesimos, 1000n));
  }

  /** Localiza a embalagem cadastrada para uma unidade. */
  encontrarEmbalagem(codigoUnidade: CodigoUnidade): Embalagem | undefined {
    return this.#embalagens.find((atual) => atual.unidade.codigo === codigoUnidade);
  }

  /**
   * Converte uma quantidade em embalagem para a unidade base do estoque.
   *
   * É o que a entrada de mercadoria usa: recebeu 3 fardos, lança 36 unidades.
   */
  converterParaUnidadeBase(quantidade: Quantidade): Result<Quantidade, ErroValidacao> {
    if (quantidade.unidade.codigo === this.#unidadeBase.codigo) {
      return ok(quantidade);
    }

    const embalagem = this.encontrarEmbalagem(quantidade.unidade.codigo);

    if (embalagem === undefined) {
      return err(
        new ErroValidacao(
          "PRODUTO_EMBALAGEM_NAO_CADASTRADA",
          `Não há embalagem em ${quantidade.unidade.descricao.toLowerCase()} cadastrada para este produto.`,
          { unidade: quantidade.unidade.codigo },
        ),
      );
    }

    return embalagem.converterParaBase(quantidade, this.#unidadeBase.codigo);
  }

  /** Verifica se algum código do produto corresponde ao informado. */
  correspondeAoCodigo(codigo: string): boolean {
    const normalizado = normalizarParaBusca(codigo).replace(/[\s\-./]/g, "");
    if (normalizado === "") return false;

    if (this.#codigoBarras?.valor === codigo.trim()) return true;
    if (normalizarParaBusca(this.#sku).replace(/[\s\-./]/g, "") === normalizado) {
      return true;
    }

    return this.#referencias.some((ref) => ref.normalizado === normalizado);
  }

  // ── Alterações ─────────────────────────────────────────────────────────

  alterarPreco(novo: Dinheiro, agora: Date): Result<void, ErroValidacao> {
    if (novo.ehNegativo()) {
      return err(
        new ErroValidacao(
          "PRODUTO_PRECO_NEGATIVO",
          "O preço de venda não pode ser negativo.",
        ),
      );
    }

    if (novo.equals(this.#precoVenda)) {
      // Sem mudança real: não gera evento, para não poluir a replicação do
      // catálogo nos PDVs com atualização que não altera nada.
      return ok(undefined);
    }

    const anterior = this.#precoVenda;
    this.#precoVenda = novo;
    this.registrarEvento(precoAlterado(this.id, anterior, novo, agora));

    return ok(undefined);
  }

  alterarCusto(novo: Dinheiro, agora: Date): Result<void, ErroValidacao> {
    if (novo.ehNegativo()) {
      return err(
        new ErroValidacao("PRODUTO_CUSTO_NEGATIVO", "O custo não pode ser negativo."),
      );
    }

    if (novo.equals(this.#custo)) {
      return ok(undefined);
    }

    const anterior = this.#custo;
    this.#custo = novo;
    this.registrarEvento(custoAlterado(this.id, anterior, novo, agora));

    return ok(undefined);
  }

  adicionarReferencia(referencia: ReferenciaProduto): Result<void, ErroValidacao> {
    if (this.#referencias.some((atual) => atual.equals(referencia))) {
      return err(
        new ErroValidacao(
          "PRODUTO_REFERENCIA_DUPLICADA",
          `A referência ${referencia.valor} já está cadastrada.`,
          { referencia: referencia.valor },
        ),
      );
    }

    this.#referencias.push(referencia);
    return ok(undefined);
  }

  removerReferencia(referencia: ReferenciaProduto): boolean {
    const posicao = this.#referencias.findIndex((atual) => atual.equals(referencia));
    if (posicao === -1) return false;

    this.#referencias.splice(posicao, 1);
    return true;
  }

  adicionarEmbalagem(embalagem: Embalagem): Result<void, ErroValidacao> {
    if (embalagem.unidade.codigo === this.#unidadeBase.codigo) {
      return err(
        new ErroValidacao(
          "PRODUTO_EMBALAGEM_IGUAL_A_BASE",
          `A embalagem não pode usar a mesma unidade do produto (${this.#unidadeBase.descricao.toLowerCase()}).`,
          { unidade: embalagem.unidade.codigo },
        ),
      );
    }

    if (this.#embalagens.some((atual) => atual.equals(embalagem))) {
      return err(
        new ErroValidacao(
          "PRODUTO_EMBALAGEM_DUPLICADA",
          `Já existe uma embalagem em ${embalagem.unidade.descricao.toLowerCase()}.`,
          { unidade: embalagem.unidade.codigo },
        ),
      );
    }

    this.#embalagens.push(embalagem);
    return ok(undefined);
  }

  /**
   * Desativa o produto.
   *
   * Nunca apaga: venda antiga e documento fiscal continuam apontando para ele.
   * O que muda é que o PDV deixa de oferecê-lo.
   */
  desativar(agora: Date): void {
    if (!this.#ativo) return;

    this.#ativo = false;
    this.registrarEvento({
      tipo: "ProdutoDesativado",
      agregadoId: this.id,
      ocorridoEm: agora,
    });
  }

  ativar(agora: Date): void {
    if (this.#ativo) return;

    this.#ativo = true;
    this.registrarEvento({
      tipo: "ProdutoAtivado",
      agregadoId: this.id,
      ocorridoEm: agora,
    });
  }

  alterarDescricao(
    descricao: string,
    descricaoPdv?: string,
  ): Result<void, ErroValidacao> {
    const limpa = descricao.trim();

    if (limpa === "") {
      return err(
        new ErroValidacao("PRODUTO_DESCRICAO_VAZIA", "Informe a descrição do produto."),
      );
    }

    if (limpa.length > TAMANHO_MAXIMO_DESCRICAO) {
      return err(
        new ErroValidacao(
          "PRODUTO_DESCRICAO_LONGA",
          `A descrição deve ter no máximo ${String(TAMANHO_MAXIMO_DESCRICAO)} caracteres.`,
          { tamanho: limpa.length },
        ),
      );
    }

    this.#descricao = limpa;
    this.#descricaoBusca = normalizarParaBusca(limpa);
    this.#descricaoPdv = (descricaoPdv ?? limpa)
      .trim()
      .slice(0, TAMANHO_MAXIMO_DESCRICAO_PDV);

    return ok(undefined);
  }

  definirCategoria(categoriaId: Identificador | undefined): void {
    this.#categoriaId = categoriaId;
  }

  definirPerfilTributario(perfilTributarioId: Identificador | undefined): void {
    this.#perfilTributarioId = perfilTributarioId;
  }

  definirCodigoBarras(codigoBarras: CodigoBarras | undefined): void {
    this.#codigoBarras = codigoBarras;
  }
}
