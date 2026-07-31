import { normalizarParaBusca } from "@erp/utils";

import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";

const TAMANHO_MAXIMO_NOME = 40;

export interface DadosCategoria {
  readonly id: Identificador;
  readonly nome: string;
  readonly ativa?: boolean | undefined;
}

/**
 * Categoria de produto — "Bebidas", "Hortifruti", "Elétrica".
 *
 * É **plana, de propósito**. Grupo e subgrupo aparecem em sistemas de
 * construção e autopeças, mas custam duas telas, uma validação de ciclo e um
 * relatório que precisa decidir se soma o pai ou a folha. O dono da padaria não
 * usa, e o de autopeças resolve com nomes ("Elétrica — Faróis").
 *
 * A decisão é reversível pelo lado barato: acrescentar um pai anulável depois é
 * migração aditiva. Tirar a hierarquia de uma base que já a usa, não.
 *
 * O que a categoria serve, hoje, é o que o dono pede: filtrar o relatório de
 * vendas e achar o produto na retaguarda sem lembrar o código.
 */
export class Categoria extends AggregateRoot {
  #nome: string;
  #nomeBusca: string;
  #ativa: boolean;

  private constructor(id: Identificador, nome: string, ativa: boolean) {
    super(id);
    this.#nome = nome;
    this.#nomeBusca = normalizarParaBusca(nome);
    this.#ativa = ativa;
  }

  static criar(dados: DadosCategoria): Result<Categoria, ErroValidacao> {
    const nome = dados.nome.trim();

    const problema = validarNome(nome);
    if (problema !== undefined) return err(problema);

    return ok(new Categoria(dados.id, nome, dados.ativa ?? true));
  }

  /** Reconstrói uma categoria já persistida. Não revalida — ver `Produto`. */
  static reconstituir(dados: DadosCategoria & { readonly ativa: boolean }): Categoria {
    return new Categoria(dados.id, dados.nome, dados.ativa);
  }

  get nome(): string {
    return this.#nome;
  }

  /** Nome normalizado — é por ele que a busca compara. */
  get nomeBusca(): string {
    return this.#nomeBusca;
  }

  get ativa(): boolean {
    return this.#ativa;
  }

  renomear(nome: string): Result<void, ErroValidacao> {
    const limpo = nome.trim();

    const problema = validarNome(limpo);
    if (problema !== undefined) return err(problema);

    this.#nome = limpo;
    this.#nomeBusca = normalizarParaBusca(limpo);

    return ok(undefined);
  }

  /**
   * Desativa a categoria.
   *
   * Nunca apaga: produto antigo continua apontando para ela, e um relatório de
   * três meses atrás deixaria de fechar. O que muda é que ela some das listas
   * de escolha.
   */
  desativar(): void {
    this.#ativa = false;
  }

  ativar(): void {
    this.#ativa = true;
  }
}

function validarNome(nome: string): ErroValidacao | undefined {
  if (nome === "") {
    return new ErroValidacao("CATEGORIA_NOME_VAZIO", "Informe o nome da categoria.");
  }

  if (nome.length > TAMANHO_MAXIMO_NOME) {
    return new ErroValidacao(
      "CATEGORIA_NOME_LONGO",
      `O nome deve ter no máximo ${String(TAMANHO_MAXIMO_NOME)} caracteres.`,
      { tamanho: nome.length },
    );
  }

  return undefined;
}
