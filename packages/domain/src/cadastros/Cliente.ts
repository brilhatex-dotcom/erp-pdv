import { apenasDigitos, normalizarParaBusca, textoOpcional } from "@erp/utils";

import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import type { Documento } from "../valores/Documento.js";
import type { Email } from "../valores/Email.js";
import type { Endereco } from "../valores/Endereco.js";
import type { InscricaoEstadual } from "../valores/InscricaoEstadual.js";
import type { Telefone } from "../valores/Telefone.js";

/**
 * Pessoa física ou jurídica.
 *
 * É campo **declarado**, não derivado do documento, por dois motivos práticos:
 * o cadastro costuma começar sem o CNPJ em mãos, e é o tipo que decide o
 * rótulo da tela ("Nome" ou "Razão social"). Quando o documento chega, a
 * coerência entre os dois é verificada — CPF em cadastro de empresa é quase
 * sempre o CPF do sócio digitado no campo errado.
 */
export type TipoPessoa = "FISICA" | "JURIDICA";

/** Limite do campo `xNome` do destinatário no layout da NF-e. */
const TAMANHO_MAXIMO_NOME = 60;
const TAMANHO_MAXIMO_APELIDO = 60;
const TAMANHO_MAXIMO_OBSERVACAO = 500;

export interface DadosCliente {
  readonly id: Identificador;
  readonly nome: string;
  /** Nome fantasia, apelido ou como o balcão chama a pessoa. */
  readonly apelido?: string | undefined;
  readonly tipoPessoa: TipoPessoa;
  /**
   * Opcional por decisão de privacidade, não por descuido.
   *
   * A LGPD pede minimização (ARQUITETURA.md §7.6): a padaria que cadastra o
   * cliente da caderneta não precisa do CPF dele para anotar o fiado. O
   * documento entra quando existe motivo — nota fiscal com destinatário.
   */
  readonly documento?: Documento | undefined;
  readonly inscricaoEstadual?: InscricaoEstadual | undefined;
  readonly telefone?: Telefone | undefined;
  readonly email?: Email | undefined;
  readonly endereco?: Endereco | undefined;
  /** Teto do fiado. Zero significa "não vende a prazo". */
  readonly limiteCredito?: Dinheiro | undefined;
  readonly observacao?: string | undefined;
  readonly ativo?: boolean | undefined;
}

/**
 * Cliente da loja.
 *
 * Existe para três coisas concretas, e nenhuma delas é "ter um cadastro":
 * identificar o destinatário da nota, sustentar a venda a prazo (a caderneta,
 * que continua sendo como metade dos mercadinhos vende) e permitir chamar a
 * pessoa quando a encomenda chega.
 *
 * **Não é um `Fornecedor` com outro nome.** Compartilham objetos de valor —
 * documento, endereço, telefone —, mas divergem no que importa: cliente tem
 * limite de crédito, fornecedor tem obrigação de documento. Unificá-los numa
 * "Pessoa" com dois papéis criaria um agregado onde metade dos campos não se
 * aplica à instância que está na tela.
 */
export class Cliente extends AggregateRoot {
  #nome: string;
  #nomeBusca: string;
  #apelido: string | undefined;
  readonly #tipoPessoa: TipoPessoa;
  #documento: Documento | undefined;
  #inscricaoEstadual: InscricaoEstadual | undefined;
  #telefone: Telefone | undefined;
  #email: Email | undefined;
  #endereco: Endereco | undefined;
  #limiteCredito: Dinheiro;
  #observacao: string | undefined;
  #ativo: boolean;

  private constructor(dados: DadosCliente, limiteCredito: Dinheiro) {
    super(dados.id);
    this.#nome = dados.nome.trim();
    this.#nomeBusca = normalizarParaBusca(dados.nome);
    this.#apelido = textoOpcional(dados.apelido);
    this.#tipoPessoa = dados.tipoPessoa;
    this.#documento = dados.documento;
    this.#inscricaoEstadual = dados.inscricaoEstadual;
    this.#telefone = dados.telefone;
    this.#email = dados.email;
    this.#endereco = dados.endereco;
    this.#limiteCredito = limiteCredito;
    this.#observacao = textoOpcional(dados.observacao);
    this.#ativo = dados.ativo ?? true;
  }

  // ── Construção ─────────────────────────────────────────────────────────

  /** Cria um cliente validado, devolvendo **todos** os erros de uma vez. */
  static criar(dados: DadosCliente): Result<Cliente, ErroValidacao[]> {
    const erros: ErroValidacao[] = [];

    const nome = dados.nome.trim();
    if (nome === "") {
      erros.push(new ErroValidacao("CLIENTE_NOME_VAZIO", "Informe o nome do cliente."));
    } else if (nome.length > TAMANHO_MAXIMO_NOME) {
      erros.push(
        new ErroValidacao(
          "CLIENTE_NOME_LONGO",
          `O nome deve ter no máximo ${String(TAMANHO_MAXIMO_NOME)} caracteres.`,
          { tamanho: nome.length },
        ),
      );
    }

    const apelido = textoOpcional(dados.apelido);
    if (apelido !== undefined && apelido.length > TAMANHO_MAXIMO_APELIDO) {
      erros.push(
        new ErroValidacao(
          "CLIENTE_APELIDO_LONGO",
          `O apelido deve ter no máximo ${String(TAMANHO_MAXIMO_APELIDO)} caracteres.`,
          { tamanho: apelido.length },
        ),
      );
    }

    erros.push(...verificarDocumento(dados.tipoPessoa, dados.documento));

    // Inscrição estadual em pessoa física é o erro que a SEFAZ devolve como
    // "IE não permitida para o destinatário" — depois da venda, com o cliente
    // já fora da loja.
    if (dados.inscricaoEstadual !== undefined && dados.tipoPessoa === "FISICA") {
      erros.push(
        new ErroValidacao(
          "CLIENTE_IE_EM_PESSOA_FISICA",
          "Inscrição estadual só existe em cadastro de empresa.",
        ),
      );
    }

    const limiteCredito = dados.limiteCredito ?? Dinheiro.zero();
    if (limiteCredito.ehNegativo()) {
      erros.push(
        new ErroValidacao(
          "CLIENTE_LIMITE_NEGATIVO",
          "O limite de crédito não pode ser negativo.",
        ),
      );
    }

    const observacao = textoOpcional(dados.observacao);
    if (observacao !== undefined && observacao.length > TAMANHO_MAXIMO_OBSERVACAO) {
      erros.push(
        new ErroValidacao(
          "CLIENTE_OBSERVACAO_LONGA",
          `A observação deve ter no máximo ${String(TAMANHO_MAXIMO_OBSERVACAO)} caracteres.`,
          { tamanho: observacao.length },
        ),
      );
    }

    if (erros.length > 0) return err(erros);

    return ok(new Cliente(dados, limiteCredito));
  }

  /** Reconstrói um cliente já persistido. Não revalida — ver `Produto`. */
  static reconstituir(dados: DadosCliente & { readonly ativo: boolean }): Cliente {
    return new Cliente(dados, dados.limiteCredito ?? Dinheiro.zero());
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get nome(): string {
    return this.#nome;
  }

  /** Nome normalizado — é por ele que a busca do balcão compara. */
  get nomeBusca(): string {
    return this.#nomeBusca;
  }

  get apelido(): string | undefined {
    return this.#apelido;
  }

  /** Como o cliente aparece numa lista: o apelido, se houver; senão o nome. */
  get exibicao(): string {
    return this.#apelido ?? this.#nome;
  }

  get tipoPessoa(): TipoPessoa {
    return this.#tipoPessoa;
  }

  get documento(): Documento | undefined {
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

  get limiteCredito(): Dinheiro {
    return this.#limiteCredito;
  }

  get observacao(): string | undefined {
    return this.#observacao;
  }

  get ativo(): boolean {
    return this.#ativo;
  }

  /** Indica se a loja aceita vender fiado para este cliente. */
  get vendeAPrazo(): boolean {
    return !this.#limiteCredito.ehZero();
  }

  // ── Regras de negócio ──────────────────────────────────────────────────

  /**
   * Quanto ainda cabe no fiado, descontado o que a pessoa já deve.
   *
   * Nunca devolve valor negativo: quem já estourou o limite tem zero
   * disponível, e não "menos R$ 40,00" — que a tela mostraria como se fosse
   * crédito.
   */
  creditoDisponivel(jaDevido: Dinheiro): Dinheiro {
    const sobra = this.#limiteCredito.subtrair(jaDevido);

    return sobra.ehNegativo() ? Dinheiro.zero() : sobra;
  }

  /**
   * Verifica se o cliente corresponde ao que foi digitado na busca.
   *
   * Compara nome, apelido, documento e telefone porque é assim que o balcão
   * procura: pelo primeiro nome, pelo apelido que só a loja usa, ou pelo
   * telefone quando o nome está escrito de um jeito que ninguém adivinha.
   */
  correspondeAoTermo(termo: string): boolean {
    const normalizado = normalizarParaBusca(termo);
    if (normalizado === "") return false;

    if (this.#nomeBusca.includes(normalizado)) return true;

    const apelido = this.#apelido;
    if (apelido !== undefined && normalizarParaBusca(apelido).includes(normalizado)) {
      return true;
    }

    const digitos = apenasDigitos(termo);
    if (digitos === "") return false;

    if (this.#documento?.valor.includes(digitos) === true) return true;

    return this.#telefone?.digitos.includes(digitos) === true;
  }

  // ── Alterações ─────────────────────────────────────────────────────────

  renomear(nome: string, apelido?: string): Result<void, ErroValidacao> {
    const limpo = nome.trim();

    if (limpo === "") {
      return err(new ErroValidacao("CLIENTE_NOME_VAZIO", "Informe o nome do cliente."));
    }

    if (limpo.length > TAMANHO_MAXIMO_NOME) {
      return err(
        new ErroValidacao(
          "CLIENTE_NOME_LONGO",
          `O nome deve ter no máximo ${String(TAMANHO_MAXIMO_NOME)} caracteres.`,
          { tamanho: limpo.length },
        ),
      );
    }

    this.#nome = limpo;
    this.#nomeBusca = normalizarParaBusca(limpo);
    this.#apelido = textoOpcional(apelido);

    return ok(undefined);
  }

  definirDocumento(documento: Documento | undefined): Result<void, ErroValidacao[]> {
    const problemas = verificarDocumento(this.#tipoPessoa, documento);
    if (problemas.length > 0) return err(problemas);

    this.#documento = documento;

    return ok(undefined);
  }

  definirInscricaoEstadual(
    inscricao: InscricaoEstadual | undefined,
  ): Result<void, ErroValidacao> {
    if (inscricao !== undefined && this.#tipoPessoa === "FISICA") {
      return err(
        new ErroValidacao(
          "CLIENTE_IE_EM_PESSOA_FISICA",
          "Inscrição estadual só existe em cadastro de empresa.",
        ),
      );
    }

    this.#inscricaoEstadual = inscricao;

    return ok(undefined);
  }

  definirContato(telefone: Telefone | undefined, email: Email | undefined): void {
    this.#telefone = telefone;
    this.#email = email;
  }

  definirEndereco(endereco: Endereco | undefined): void {
    this.#endereco = endereco;
  }

  definirLimiteCredito(limite: Dinheiro): Result<void, ErroValidacao> {
    if (limite.ehNegativo()) {
      return err(
        new ErroValidacao(
          "CLIENTE_LIMITE_NEGATIVO",
          "O limite de crédito não pode ser negativo.",
        ),
      );
    }

    this.#limiteCredito = limite;

    return ok(undefined);
  }

  definirObservacao(observacao: string | undefined): Result<void, ErroValidacao> {
    const limpa = textoOpcional(observacao);

    if (limpa !== undefined && limpa.length > TAMANHO_MAXIMO_OBSERVACAO) {
      return err(
        new ErroValidacao(
          "CLIENTE_OBSERVACAO_LONGA",
          `A observação deve ter no máximo ${String(TAMANHO_MAXIMO_OBSERVACAO)} caracteres.`,
          { tamanho: limpa.length },
        ),
      );
    }

    this.#observacao = limpa;

    return ok(undefined);
  }

  /**
   * Desativa o cliente.
   *
   * Nunca apaga: venda antiga e nota fiscal emitida continuam apontando para
   * ele, e a LGPD exige guarda dos documentos fiscais pelo prazo legal. O que
   * o desativado perde é a presença nas listas e a venda a prazo nova.
   */
  desativar(): void {
    this.#ativo = false;
  }

  ativar(): void {
    this.#ativo = true;
  }
}

/** Coerência entre o tipo declarado e o documento informado. */
function verificarDocumento(
  tipoPessoa: TipoPessoa,
  documento: Documento | undefined,
): ErroValidacao[] {
  if (documento === undefined) return [];

  if (tipoPessoa === "FISICA" && documento.ehPessoaJuridica) {
    return [
      new ErroValidacao(
        "CLIENTE_DOCUMENTO_INCOMPATIVEL",
        "Cadastro de pessoa física usa CPF. Para CNPJ, mude o tipo para empresa.",
        { tipoPessoa, tipoDocumento: documento.tipo },
      ),
    ];
  }

  if (tipoPessoa === "JURIDICA" && documento.ehPessoaFisica) {
    return [
      new ErroValidacao(
        "CLIENTE_DOCUMENTO_INCOMPATIVEL",
        "Cadastro de empresa usa CNPJ. Para CPF, mude o tipo para pessoa física.",
        { tipoPessoa, tipoDocumento: documento.tipo },
      ),
    ];
  }

  return [];
}
