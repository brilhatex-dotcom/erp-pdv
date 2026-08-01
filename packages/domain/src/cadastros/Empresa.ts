import { normalizarParaBusca, textoOpcional } from "@erp/utils";

import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { CNPJ } from "../valores/CNPJ.js";
import type { Email } from "../valores/Email.js";
import type { Endereco } from "../valores/Endereco.js";
import type { InscricaoEstadual } from "../valores/InscricaoEstadual.js";
import type { Telefone } from "../valores/Telefone.js";

/**
 * A empresa que opera esta instalação.
 *
 * ### Uma por instalação, e isso é decisão registrada
 *
 * Cliente com duas lojas recebe duas instalações (ADR-0024). Não existe
 * `empresa_id` em tabela nenhuma, e não deve passar a existir sem novo ADR: o
 * filtro esquecido numa consulta não daria erro — daria dado de um cliente
 * aparecendo para outro.
 *
 * ### É CNPJ, não `Documento`
 *
 * Fornecedor aceita CPF porque o hortifruti compra do sitiante. A empresa que
 * **emite** documento fiscal, não. Aceitar CPF aqui produziria um cadastro que
 * nunca consegue emitir, e o lojista só descobriria no dia da primeira nota.
 *
 * ### Os limites vêm do layout fiscal, não de gosto
 *
 * Razão social em 60 caracteres é o `xNome` do emitente na NF-e. Cortar depois,
 * na hora de emitir, produziria nota com o nome truncado sem ninguém ter sido
 * avisado — melhor recusar no cadastro, quando há quem corrija.
 */

const TAMANHO_MAXIMO_RAZAO_SOCIAL = 60;
const TAMANHO_MAXIMO_FANTASIA = 60;

/**
 * Regime tributário.
 *
 * Mora aqui porque decide o cálculo de imposto quando o módulo fiscal for
 * habilitado — e porque o Simples Nacional muda o que sai no cupom. Guardá-lo
 * desde já custa uma coluna e evita uma migração no dia da emissão.
 */
export const REGIMES_TRIBUTARIOS = [
  "SIMPLES_NACIONAL",
  "SIMPLES_EXCESSO_SUBLIMITE",
  "REGIME_NORMAL",
  "MEI",
] as const;

export type RegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];

export function ehRegimeTributario(valor: string): valor is RegimeTributario {
  return (REGIMES_TRIBUTARIOS as readonly string[]).includes(valor);
}

export interface DadosEmpresa {
  readonly id: Identificador;
  readonly razaoSocial: string;
  readonly nomeFantasia?: string | undefined;
  readonly cnpj: CNPJ;
  readonly inscricaoEstadual?: InscricaoEstadual | undefined;
  /** Inscrição municipal — exigida por alguns municípios no cadastro do emitente. */
  readonly inscricaoMunicipal?: string | undefined;
  readonly regimeTributario: RegimeTributario;
  /**
   * **Obrigatório**, ao contrário dos demais cadastros.
   *
   * O endereço do emitente vai no cupom e na nota. Empresa sem endereço é
   * cadastro que não emite — e, mesmo sem o módulo fiscal, é o cabeçalho que
   * falta em todo relatório impresso.
   */
  readonly endereco: Endereco;
  readonly telefone?: Telefone | undefined;
  readonly email?: Email | undefined;
}

export class Empresa extends AggregateRoot {
  #razaoSocial: string;
  #razaoSocialBusca: string;
  #nomeFantasia: string | undefined;
  #cnpj: CNPJ;
  #inscricaoEstadual: InscricaoEstadual | undefined;
  #inscricaoMunicipal: string | undefined;
  #regimeTributario: RegimeTributario;
  #endereco: Endereco;
  #telefone: Telefone | undefined;
  #email: Email | undefined;

  private constructor(dados: DadosEmpresa) {
    super(dados.id);
    this.#razaoSocial = dados.razaoSocial.trim();
    this.#razaoSocialBusca = normalizarParaBusca(dados.razaoSocial);
    this.#nomeFantasia = textoOpcional(dados.nomeFantasia);
    this.#cnpj = dados.cnpj;
    this.#inscricaoEstadual = dados.inscricaoEstadual;
    this.#inscricaoMunicipal = textoOpcional(dados.inscricaoMunicipal);
    this.#regimeTributario = dados.regimeTributario;
    this.#endereco = dados.endereco;
    this.#telefone = dados.telefone;
    this.#email = dados.email;
  }

  // ── Construção ─────────────────────────────────────────────────────────

  /** Cria a empresa validada, devolvendo **todos** os erros de uma vez. */
  static criar(dados: DadosEmpresa): Result<Empresa, ErroValidacao[]> {
    const erros = validar(dados);

    return erros.length > 0 ? err(erros) : ok(new Empresa(dados));
  }

  /** Reconstrói a empresa já persistida. Não revalida — ver `Produto`. */
  static reconstituir(dados: DadosEmpresa): Empresa {
    return new Empresa(dados);
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get razaoSocial(): string {
    return this.#razaoSocial;
  }

  get razaoSocialBusca(): string {
    return this.#razaoSocialBusca;
  }

  get nomeFantasia(): string | undefined {
    return this.#nomeFantasia;
  }

  /** Como a loja aparece no cupom e no cabeçalho: o fantasia, se houver. */
  get exibicao(): string {
    return this.#nomeFantasia ?? this.#razaoSocial;
  }

  get cnpj(): CNPJ {
    return this.#cnpj;
  }

  get inscricaoEstadual(): InscricaoEstadual | undefined {
    return this.#inscricaoEstadual;
  }

  get inscricaoMunicipal(): string | undefined {
    return this.#inscricaoMunicipal;
  }

  get regimeTributario(): RegimeTributario {
    return this.#regimeTributario;
  }

  get endereco(): Endereco {
    return this.#endereco;
  }

  get telefone(): Telefone | undefined {
    return this.#telefone;
  }

  get email(): Email | undefined {
    return this.#email;
  }

  /**
   * Verdadeiro quando a empresa pode ser emitente de documento fiscal.
   *
   * Não bloqueia nada hoje — o módulo fiscal é opcional (ADR-0016) e a loja
   * vende sem ele. Existe para a retaguarda avisar **antes** da habilitação
   * que falta inscrição estadual, em vez de o lojista descobrir na primeira
   * tentativa de emissão.
   */
  get aptaAEmitir(): boolean {
    return this.#regimeTributario === "MEI" || this.#inscricaoEstadual !== undefined;
  }

  // ── Alteração ──────────────────────────────────────────────────────────

  /**
   * Substitui os dados cadastrais.
   *
   * Recebe o estado completo, e não campos soltos: caso de uso que trata
   * ausente como "não mexer" torna impossível limpar um campo — e o lojista
   * que corrigiu o telefone errado para vazio continuaria com o errado.
   *
   * **O CNPJ não muda.** Trocá-lo não é corrigir cadastro: é outra empresa, e
   * as notas já emitidas passariam a apontar para um emitente que nunca as
   * emitiu. O caminho é nova instalação.
   */
  alterar(dados: Omit<DadosEmpresa, "id" | "cnpj">): Result<void, ErroValidacao[]> {
    const erros = validar({ ...dados, id: this.id, cnpj: this.#cnpj });

    if (erros.length > 0) return err(erros);

    this.#razaoSocial = dados.razaoSocial.trim();
    this.#razaoSocialBusca = normalizarParaBusca(dados.razaoSocial);
    this.#nomeFantasia = textoOpcional(dados.nomeFantasia);
    this.#inscricaoEstadual = dados.inscricaoEstadual;
    this.#inscricaoMunicipal = textoOpcional(dados.inscricaoMunicipal);
    this.#regimeTributario = dados.regimeTributario;
    this.#endereco = dados.endereco;
    this.#telefone = dados.telefone;
    this.#email = dados.email;

    return ok(undefined);
  }
}

function validar(dados: DadosEmpresa): ErroValidacao[] {
  const erros: ErroValidacao[] = [];

  const razaoSocial = dados.razaoSocial.trim();

  if (razaoSocial === "") {
    erros.push(
      new ErroValidacao("EMPRESA_RAZAO_SOCIAL_VAZIA", "Informe a razão social."),
    );
  } else if (razaoSocial.length > TAMANHO_MAXIMO_RAZAO_SOCIAL) {
    erros.push(
      new ErroValidacao(
        "EMPRESA_RAZAO_SOCIAL_LONGA",
        `A razão social deve ter no máximo ${String(TAMANHO_MAXIMO_RAZAO_SOCIAL)} caracteres.`,
        { tamanho: razaoSocial.length },
      ),
    );
  }

  const fantasia = textoOpcional(dados.nomeFantasia);

  if (fantasia !== undefined && fantasia.length > TAMANHO_MAXIMO_FANTASIA) {
    erros.push(
      new ErroValidacao(
        "EMPRESA_FANTASIA_LONGA",
        `O nome fantasia deve ter no máximo ${String(TAMANHO_MAXIMO_FANTASIA)} caracteres.`,
        { tamanho: fantasia.length },
      ),
    );
  }

  return erros;
}
