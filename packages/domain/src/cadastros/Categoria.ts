import { normalizarParaBusca } from "@erp/utils";

import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";

const TAMANHO_MAXIMO_NOME = 40;
/**
 * Um emoji pode ocupar vários pontos de código — bandeira, tom de pele,
 * família. Oito unidades cobrem todos os de comida; o limite existe para que o
 * campo não vire texto livre.
 */
const TAMANHO_MAXIMO_ICONE = 8;

export interface DadosCategoria {
  readonly id: Identificador;
  readonly nome: string;
  readonly ativa?: boolean | undefined;
  /**
   * Figura curta (um emoji) que aparece no botão da categoria no caixa.
   *
   * Existe para o caso mais comum: a loja não tem foto nenhuma. "🍞 Pães" se
   * reconhece de longe, e o operador que lê mal encontra a categoria pela
   * figura. A foto, quando há, vence.
   */
  readonly icone?: string | undefined;
  readonly imagemId?: Identificador | undefined;
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
  #icone: string | undefined;
  #imagemId: Identificador | undefined;

  private constructor(
    id: Identificador,
    nome: string,
    ativa: boolean,
    icone: string | undefined,
    imagemId: Identificador | undefined,
  ) {
    super(id);
    this.#nome = nome;
    this.#nomeBusca = normalizarParaBusca(nome);
    this.#ativa = ativa;
    this.#icone = icone;
    this.#imagemId = imagemId;
  }

  static criar(dados: DadosCategoria): Result<Categoria, ErroValidacao> {
    const nome = dados.nome.trim();

    const problema = validarNome(nome);
    if (problema !== undefined) return err(problema);

    const icone = limparIcone(dados.icone);
    if (icone.isErr()) return err(icone.error);

    return ok(
      new Categoria(dados.id, nome, dados.ativa ?? true, icone.unwrap(), dados.imagemId),
    );
  }

  /** Reconstrói uma categoria já persistida. Não revalida — ver `Produto`. */
  static reconstituir(dados: DadosCategoria & { readonly ativa: boolean }): Categoria {
    return new Categoria(dados.id, dados.nome, dados.ativa, dados.icone, dados.imagemId);
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

  get icone(): string | undefined {
    return this.#icone;
  }

  get imagemId(): Identificador | undefined {
    return this.#imagemId;
  }

  definirIcone(icone: string | undefined): Result<void, ErroValidacao> {
    const limpo = limparIcone(icone);
    if (limpo.isErr()) return err(limpo.error);

    this.#icone = limpo.unwrap();

    return ok(undefined);
  }

  definirImagem(imagemId: Identificador | undefined): void {
    this.#imagemId = imagemId;
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

function limparIcone(
  icone: string | undefined,
): Result<string | undefined, ErroValidacao> {
  const limpo = icone?.trim();
  if (limpo === undefined || limpo === "") return ok(undefined);

  if (limpo.length > TAMANHO_MAXIMO_ICONE) {
    return err(
      new ErroValidacao(
        "CATEGORIA_ICONE_LONGO",
        "Use só uma figura (um emoji) como ícone da categoria.",
        { tamanho: limpo.length },
      ),
    );
  }

  return ok(limpo);
}
