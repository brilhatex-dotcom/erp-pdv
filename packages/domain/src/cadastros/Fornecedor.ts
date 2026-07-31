import { apenasDigitos, normalizarParaBusca, textoOpcional } from "@erp/utils";

import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { Documento } from "../valores/Documento.js";
import type { Email } from "../valores/Email.js";
import type { Endereco } from "../valores/Endereco.js";
import type { InscricaoEstadual } from "../valores/InscricaoEstadual.js";
import type { Telefone } from "../valores/Telefone.js";

/** Limite do campo `xNome` do emitente no layout da NF-e. */
const TAMANHO_MAXIMO_RAZAO_SOCIAL = 60;
const TAMANHO_MAXIMO_FANTASIA = 60;
const TAMANHO_MAXIMO_OBSERVACAO = 500;
/**
 * Teto do prazo de entrega. Meio ano cobre até importação com encomenda; acima
 * disso é digitação errada — tipicamente uma data no lugar do número de dias.
 */
const MAXIMO_DIAS_ENTREGA = 180;

export interface DadosFornecedor {
  readonly id: Identificador;
  readonly razaoSocial: string;
  readonly nomeFantasia?: string | undefined;
  /**
   * **Obrigatório**, ao contrário do cliente.
   *
   * Fornecedor existe para sustentar entrada de mercadoria, e toda entrada
   * chega com uma nota que traz o CNPJ do emitente. Um fornecedor sem
   * documento é um cadastro que não fecha com nota nenhuma — e a divergência
   * só aparece no inventário, quando ninguém lembra de onde veio a mercadoria.
   *
   * É `Documento`, e não `CNPJ`, porque produtor rural e MEI de bairro
   * fornecem com CPF: o hortifruti compra do sitiante da região.
   */
  readonly documento: Documento;
  readonly inscricaoEstadual?: InscricaoEstadual | undefined;
  readonly telefone?: Telefone | undefined;
  readonly email?: Email | undefined;
  readonly endereco?: Endereco | undefined;
  /** Prazo médio de entrega, para o comprador saber quando pedir. */
  readonly prazoEntregaDias?: number | undefined;
  readonly observacao?: string | undefined;
  readonly ativo?: boolean | undefined;
}

/**
 * Fornecedor da loja.
 *
 * O cadastro serve à entrada de mercadoria: é ele que responde "de quem veio
 * esta caixa" quando o inventário não bate, e "quem procurar" quando o produto
 * acabou. O prazo de entrega mora aqui pelo mesmo motivo — é a informação que
 * decide se o pedido sai hoje ou na quinta.
 */
export class Fornecedor extends AggregateRoot {
  #razaoSocial: string;
  #razaoSocialBusca: string;
  #nomeFantasia: string | undefined;
  #documento: Documento;
  #inscricaoEstadual: InscricaoEstadual | undefined;
  #telefone: Telefone | undefined;
  #email: Email | undefined;
  #endereco: Endereco | undefined;
  #prazoEntregaDias: number | undefined;
  #observacao: string | undefined;
  #ativo: boolean;

  private constructor(dados: DadosFornecedor) {
    super(dados.id);
    this.#razaoSocial = dados.razaoSocial.trim();
    this.#razaoSocialBusca = normalizarParaBusca(dados.razaoSocial);
    this.#nomeFantasia = textoOpcional(dados.nomeFantasia);
    this.#documento = dados.documento;
    this.#inscricaoEstadual = dados.inscricaoEstadual;
    this.#telefone = dados.telefone;
    this.#email = dados.email;
    this.#endereco = dados.endereco;
    this.#prazoEntregaDias = dados.prazoEntregaDias;
    this.#observacao = textoOpcional(dados.observacao);
    this.#ativo = dados.ativo ?? true;
  }

  // ── Construção ─────────────────────────────────────────────────────────

  /** Cria um fornecedor validado, devolvendo **todos** os erros de uma vez. */
  static criar(dados: DadosFornecedor): Result<Fornecedor, ErroValidacao[]> {
    const erros: ErroValidacao[] = [];

    const razaoSocial = dados.razaoSocial.trim();
    if (razaoSocial === "") {
      erros.push(
        new ErroValidacao(
          "FORNECEDOR_RAZAO_SOCIAL_VAZIA",
          "Informe a razão social do fornecedor.",
        ),
      );
    } else if (razaoSocial.length > TAMANHO_MAXIMO_RAZAO_SOCIAL) {
      erros.push(
        new ErroValidacao(
          "FORNECEDOR_RAZAO_SOCIAL_LONGA",
          `A razão social deve ter no máximo ${String(TAMANHO_MAXIMO_RAZAO_SOCIAL)} caracteres.`,
          { tamanho: razaoSocial.length },
        ),
      );
    }

    const fantasia = textoOpcional(dados.nomeFantasia);
    if (fantasia !== undefined && fantasia.length > TAMANHO_MAXIMO_FANTASIA) {
      erros.push(
        new ErroValidacao(
          "FORNECEDOR_FANTASIA_LONGA",
          `O nome fantasia deve ter no máximo ${String(TAMANHO_MAXIMO_FANTASIA)} caracteres.`,
          { tamanho: fantasia.length },
        ),
      );
    }

    const problemaPrazo = validarPrazo(dados.prazoEntregaDias);
    if (problemaPrazo !== undefined) erros.push(problemaPrazo);

    const observacao = textoOpcional(dados.observacao);
    if (observacao !== undefined && observacao.length > TAMANHO_MAXIMO_OBSERVACAO) {
      erros.push(
        new ErroValidacao(
          "FORNECEDOR_OBSERVACAO_LONGA",
          `A observação deve ter no máximo ${String(TAMANHO_MAXIMO_OBSERVACAO)} caracteres.`,
          { tamanho: observacao.length },
        ),
      );
    }

    if (erros.length > 0) return err(erros);

    return ok(new Fornecedor(dados));
  }

  /** Reconstrói um fornecedor já persistido. Não revalida — ver `Produto`. */
  static reconstituir(dados: DadosFornecedor & { readonly ativo: boolean }): Fornecedor {
    return new Fornecedor(dados);
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get razaoSocial(): string {
    return this.#razaoSocial;
  }

  /** Razão social normalizada — é por ela que a busca compara. */
  get razaoSocialBusca(): string {
    return this.#razaoSocialBusca;
  }

  get nomeFantasia(): string | undefined {
    return this.#nomeFantasia;
  }

  /** Como o fornecedor aparece numa lista: o fantasia, se houver. */
  get exibicao(): string {
    return this.#nomeFantasia ?? this.#razaoSocial;
  }

  get documento(): Documento {
    return this.#documento;
  }

  get inscricaoEstadual(): InscricaoEstadual | undefined {
    return this.#inscricaoEstadual;
  }

  get telefone(): Telefone | undefined {
    return this.#telefone;
  }

  get email(): Email | undefined {
    return this.#email;
  }

  get endereco(): Endereco | undefined {
    return this.#endereco;
  }

  get prazoEntregaDias(): number | undefined {
    return this.#prazoEntregaDias;
  }

  get observacao(): string | undefined {
    return this.#observacao;
  }

  get ativo(): boolean {
    return this.#ativo;
  }

  // ── Regras de negócio ──────────────────────────────────────────────────

  /**
   * Verifica se o fornecedor corresponde ao que foi digitado.
   *
   * Inclui o documento porque o comprador costuma ter a nota na mão e o CNPJ é
   * o único dado dela que não vem abreviado.
   */
  correspondeAoTermo(termo: string): boolean {
    const normalizado = normalizarParaBusca(termo);
    if (normalizado === "") return false;

    if (this.#razaoSocialBusca.includes(normalizado)) return true;

    const fantasia = this.#nomeFantasia;
    if (fantasia !== undefined && normalizarParaBusca(fantasia).includes(normalizado)) {
      return true;
    }

    const digitos = apenasDigitos(termo);
    if (digitos === "") return false;

    if (this.#documento.valor.includes(digitos)) return true;

    return this.#telefone?.digitos.includes(digitos) === true;
  }

  // ── Alterações ─────────────────────────────────────────────────────────

  renomear(razaoSocial: string, nomeFantasia?: string): Result<void, ErroValidacao> {
    const limpa = razaoSocial.trim();

    if (limpa === "") {
      return err(
        new ErroValidacao(
          "FORNECEDOR_RAZAO_SOCIAL_VAZIA",
          "Informe a razão social do fornecedor.",
        ),
      );
    }

    if (limpa.length > TAMANHO_MAXIMO_RAZAO_SOCIAL) {
      return err(
        new ErroValidacao(
          "FORNECEDOR_RAZAO_SOCIAL_LONGA",
          `A razão social deve ter no máximo ${String(TAMANHO_MAXIMO_RAZAO_SOCIAL)} caracteres.`,
          { tamanho: limpa.length },
        ),
      );
    }

    this.#razaoSocial = limpa;
    this.#razaoSocialBusca = normalizarParaBusca(limpa);
    this.#nomeFantasia = textoOpcional(nomeFantasia);

    return ok(undefined);
  }

  definirDocumento(documento: Documento): void {
    this.#documento = documento;
  }

  definirInscricaoEstadual(inscricao: InscricaoEstadual | undefined): void {
    this.#inscricaoEstadual = inscricao;
  }

  definirContato(telefone: Telefone | undefined, email: Email | undefined): void {
    this.#telefone = telefone;
    this.#email = email;
  }

  definirEndereco(endereco: Endereco | undefined): void {
    this.#endereco = endereco;
  }

  definirPrazoEntrega(dias: number | undefined): Result<void, ErroValidacao> {
    const problema = validarPrazo(dias);
    if (problema !== undefined) return err(problema);

    this.#prazoEntregaDias = dias;

    return ok(undefined);
  }

  definirObservacao(observacao: string | undefined): Result<void, ErroValidacao> {
    const limpa = textoOpcional(observacao);

    if (limpa !== undefined && limpa.length > TAMANHO_MAXIMO_OBSERVACAO) {
      return err(
        new ErroValidacao(
          "FORNECEDOR_OBSERVACAO_LONGA",
          `A observação deve ter no máximo ${String(TAMANHO_MAXIMO_OBSERVACAO)} caracteres.`,
          { tamanho: limpa.length },
        ),
      );
    }

    this.#observacao = limpa;

    return ok(undefined);
  }

  /**
   * Desativa o fornecedor.
   *
   * Nunca apaga: movimento de estoque antigo aponta para ele, e o histórico de
   * compra é o que responde "por quanto eu comprava isso".
   */
  desativar(): void {
    this.#ativo = false;
  }

  ativar(): void {
    this.#ativo = true;
  }
}

function validarPrazo(dias: number | undefined): ErroValidacao | undefined {
  if (dias === undefined) return undefined;

  if (!Number.isInteger(dias) || dias < 0) {
    return new ErroValidacao(
      "FORNECEDOR_PRAZO_INVALIDO",
      "O prazo de entrega deve ser um número inteiro de dias.",
      { prazoEntregaDias: dias },
    );
  }

  if (dias > MAXIMO_DIAS_ENTREGA) {
    return new ErroValidacao(
      "FORNECEDOR_PRAZO_LONGO",
      `O prazo de entrega deve ser de no máximo ${String(MAXIMO_DIAS_ENTREGA)} dias.`,
      { prazoEntregaDias: dias },
    );
  }

  return undefined;
}
