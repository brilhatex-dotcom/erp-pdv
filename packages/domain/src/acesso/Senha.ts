import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";

/**
 * Senha da retaguarda — mínimo doze caracteres.
 *
 * O contexto é o oposto do balcão (ARQUITETURA.md §8.1): aqui não há fila
 * esperando, e o que está atrás da tela é o cadastro fiscal, o custo de compra e
 * o financeiro. O acesso também não exige presença física, então o ataque pode
 * vir da rede — e a defesa que funcionava para o PIN, "só quem está na loja
 * tenta", desaparece.
 *
 * **Comprimento em vez de composição obrigatória.** Não se exige maiúscula,
 * número e símbolo, e isso é deliberado: essas regras produzem `Senha@2026`,
 * que satisfaz o formulário e é trivial de adivinhar, enquanto empurram o
 * usuário para o papel colado no monitor. Doze caracteres livres permitem uma
 * frase memorável, que é mais forte e não vira bilhete.
 *
 * A verificação contra listas de senhas vazadas é exigida pelo §8.1 e **não mora
 * aqui**: consultar uma lista é I/O, e o domínio não faz I/O (CLAUDE.md §4,
 * princípio 2). Ela é aplicada na fronteira, antes de construir este objeto.
 */

const TAMANHO_MINIMO = 12;

/** Teto para não passar entrada gigante ao algoritmo de hash. */
const TAMANHO_MAXIMO = 200;

const MASCARA = "[senha oculta]";

export class Senha {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<Senha, ErroValidacao> {
    // Sem `trim`: espaço no meio de uma frase é parte da senha, e cortar as
    // pontas silenciosamente faria a senha aceita no cadastro ser recusada no
    // login por um espaço que o usuário nem vê.
    if (valor.length < TAMANHO_MINIMO) {
      return err(
        new ErroValidacao(
          "SENHA_MUITO_CURTA",
          `A senha deve ter pelo menos ${String(TAMANHO_MINIMO)} caracteres. Uma frase que você lembre funciona bem.`,
          { tamanhoRecebido: valor.length },
        ),
      );
    }

    if (valor.length > TAMANHO_MAXIMO) {
      return err(
        new ErroValidacao(
          "SENHA_MUITO_LONGA",
          `A senha deve ter no máximo ${String(TAMANHO_MAXIMO)} caracteres.`,
          { tamanhoRecebido: valor.length },
        ),
      );
    }

    return ok(new Senha(valor));
  }

  /** O segredo em claro. Único chamador legítimo é o adapter de hash. */
  revelar(): string {
    return this.#valor;
  }

  toString(): string {
    return MASCARA;
  }

  toJSON(): string {
    return MASCARA;
  }
}
