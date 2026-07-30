/**
 * `Result<T, E>` — erros de negócio como valores, não como exceções.
 *
 * Princípio 7 do CLAUDE.md: falha previsível de negócio ("estoque insuficiente",
 * "CPF inválido", "desconto acima do limite") é um resultado esperado do fluxo,
 * não um evento excepcional. Representá-la como `throw` tem três problemas
 * concretos neste sistema:
 *
 * 1. **O compilador não ajuda.** A assinatura de uma função que lança não diz o
 *    que ela lança. Um caso de uso novo esquece de tratar "estoque insuficiente"
 *    e o operador vê uma tela de erro em vez de uma mensagem clara.
 * 2. **`try/catch` mistura categorias.** O mesmo bloco captura tanto a regra de
 *    negócio quanto o bug de programação, e ambos acabam tratados igual.
 * 3. **Custa caro no caminho quente.** Montar stack trace a cada item de carrinho
 *    rejeitado é desperdício onde a meta é responder em menos de 50 ms (RNF-03).
 *
 * `throw` permanece reservado para o que realmente é bug: invariante violada,
 * estado impossível, falha de programação.
 *
 * A API é nomeada em inglês por ser jargão de programação funcional, seguindo a
 * regra do CLAUDE.md §6 — o domínio é português, o jargão técnico não é traduzido.
 */

/** Resultado de uma operação que pode falhar de forma prevista. */
export type Result<T, E> = Ok<T, E> | Err<T, E>;

/** Resultado bem-sucedido, portando o valor produzido. */
export class Ok<T, E> {
  readonly #valor: T;

  constructor(valor: T) {
    this.#valor = valor;
  }

  isOk(): this is Ok<T, E> {
    return true;
  }

  isErr(): this is Err<T, E> {
    return false;
  }

  /** O valor. Só acessível após estreitar o tipo com `isOk()`. */
  get value(): T {
    return this.#valor;
  }

  /** Transforma o valor, preservando o sucesso. */
  map<U>(fn: (valor: T) => U): Result<U, E> {
    return new Ok<U, E>(fn(this.#valor));
  }

  /** Sem efeito num `Ok` — existe para simetria com `Err`. */
  mapErr<F>(_fn: (erro: E) => F): Result<T, F> {
    return new Ok<T, F>(this.#valor);
  }

  /** Encadeia outra operação que também pode falhar. */
  andThen<U>(fn: (valor: T) => Result<U, E>): Result<U, E> {
    return fn(this.#valor);
  }

  /**
   * Extrai o valor.
   *
   * @throws {Error} nunca, num `Ok`. Chamar `unwrap()` sem verificar `isOk()`
   * é bug de programação — daí ser a única operação que lança.
   */
  unwrap(): T {
    return this.#valor;
  }

  unwrapOr(_padrao: T): T {
    return this.#valor;
  }

  /** Trata os dois caminhos de forma exaustiva, garantida pelo compilador. */
  match<U>(manipuladores: { ok: (valor: T) => U; err: (erro: E) => U }): U {
    return manipuladores.ok(this.#valor);
  }
}

/** Resultado com falha, portando o erro de negócio. */
export class Err<T, E> {
  readonly #erro: E;

  constructor(erro: E) {
    this.#erro = erro;
  }

  isOk(): this is Ok<T, E> {
    return false;
  }

  isErr(): this is Err<T, E> {
    return true;
  }

  /** O erro. Só acessível após estreitar o tipo com `isErr()`. */
  get error(): E {
    return this.#erro;
  }

  map<U>(_fn: (valor: T) => U): Result<U, E> {
    return new Err<U, E>(this.#erro);
  }

  mapErr<F>(fn: (erro: E) => F): Result<T, F> {
    return new Err<T, F>(fn(this.#erro));
  }

  andThen<U>(_fn: (valor: T) => Result<U, E>): Result<U, E> {
    return new Err<U, E>(this.#erro);
  }

  /**
   * @throws {Error} sempre. Indica que o código não verificou `isOk()` antes —
   * ou seja, um bug, que é exatamente quando `throw` é apropriado.
   */
  unwrap(): T {
    throw new Error(
      `Tentativa de extrair valor de um Result com erro: ${descrever(this.#erro)}`,
    );
  }

  unwrapOr(padrao: T): T {
    return padrao;
  }

  match<U>(manipuladores: { ok: (valor: T) => U; err: (erro: E) => U }): U {
    return manipuladores.err(this.#erro);
  }
}

/** Constrói um resultado de sucesso. */
export function ok<T, E = never>(valor: T): Result<T, E> {
  return new Ok<T, E>(valor);
}

/** Constrói um resultado de falha. */
export function err<E, T = never>(erro: E): Result<T, E> {
  return new Err<T, E>(erro);
}

/**
 * Combina vários resultados, parando no primeiro erro.
 *
 * Use quando um erro torna os demais irrelevantes — por exemplo, se o produto
 * não existe, não faz sentido validar a quantidade.
 */
export function combine<T, E>(resultados: readonly Result<T, E>[]): Result<T[], E> {
  const valores: T[] = [];
  for (const resultado of resultados) {
    if (resultado.isErr()) {
      return err(resultado.error);
    }
    valores.push(resultado.unwrap());
  }
  return ok(valores);
}

/**
 * Combina vários resultados acumulando **todos** os erros.
 *
 * Use em validação de formulário: o usuário precisa ver os cinco campos
 * errados de uma vez, não corrigir um, salvar, e descobrir o próximo. Essa
 * diferença é experiência do operador, não detalhe técnico.
 */
export function combineAll<T, E>(resultados: readonly Result<T, E>[]): Result<T[], E[]> {
  const valores: T[] = [];
  const erros: E[] = [];

  for (const resultado of resultados) {
    if (resultado.isErr()) {
      erros.push(resultado.error);
    } else {
      valores.push(resultado.unwrap());
    }
  }

  return erros.length > 0 ? err(erros) : ok(valores);
}

/** Descreve um erro de forma legível, sem depender do seu formato. */
function descrever(erro: unknown): string {
  if (erro instanceof Error) {
    return erro.message;
  }
  if (typeof erro === "string") {
    return erro;
  }
  try {
    return JSON.stringify(erro);
  } catch {
    return String(erro);
  }
}
