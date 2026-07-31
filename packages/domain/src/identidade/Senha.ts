import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";

export const TAMANHO_MINIMO_SENHA = 12;

/**
 * Senha da retaguarda — **valor em claro, nunca persistido**.
 *
 * A exigência aqui é oposta à do PIN, e de propósito: a retaguarda expõe dados
 * financeiros e fiscais, e o ataque não precisa de presença física
 * (ARQUITETURA.md §8.1).
 *
 * ### O que esta classe valida, e o que ela não valida
 *
 * Valida **comprimento e variedade** — regras que dependem só do texto.
 *
 * **Não** valida se a senha está em lista de vazamentos. Essa verificação
 * exige consultar uma base de milhões de hashes, que é infraestrutura, e o
 * domínio não a conhece (princípio 2). Ela mora numa porta, aplicada no caso
 * de uso, e é obrigatória antes de aceitar a senha.
 *
 * O comprimento mínimo prevalece sobre exigir símbolo obrigatório: as regras de
 * composição empurram o usuário para `Senha@2026`, que é longa, atende à regra
 * e é péssima. Uma frase de quatro palavras é melhor e mais fácil de lembrar.
 */
export class Senha {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<Senha, ErroValidacao> {
    if (valor.length < TAMANHO_MINIMO_SENHA) {
      return err(
        new ErroValidacao(
          "SENHA_CURTA",
          `A senha deve ter pelo menos ${String(TAMANHO_MINIMO_SENHA)} caracteres. Uma frase de quatro palavras funciona bem.`,
          { tamanho: valor.length },
        ),
      );
    }

    // Um único caractere repetido 12 vezes tem o comprimento exigido e nenhuma
    // resistência. Contar caracteres distintos pega esse caso sem impor as
    // regras de composição que produzem senha ruim.
    if (new Set(valor).size < 5) {
      return err(
        new ErroValidacao(
          "SENHA_POUCO_VARIADA",
          "A senha tem caracteres repetidos demais. Use palavras diferentes.",
        ),
      );
    }

    if (valor.trim() === "") {
      return err(
        new ErroValidacao("SENHA_EM_BRANCO", "A senha não pode ser só espaços."),
      );
    }

    return ok(new Senha(valor));
  }

  /** Valor em claro, para entregar à porta que calcula o hash. */
  get valorEmClaro(): string {
    return this.#valor;
  }
}
