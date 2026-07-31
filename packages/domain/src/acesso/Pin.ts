import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";

/**
 * PIN do operador — seis dígitos.
 *
 * A escolha de PIN em vez de senha no PDV está no ADR-0011, e o raciocínio é de
 * modelo de ameaça, não de conveniência: atacar um PIN exige **presença física**
 * na loja, com testemunhas e câmera. O que a senha forte protegeria aqui não é o
 * que está em risco; o que está em risco é a equipe compartilhar um login porque
 * digitar doze caracteres com fila esperando é insuportável — e login
 * compartilhado destrói a auditoria, que é a defesa real contra furto interno
 * (ARQUITETURA.md §7.1).
 *
 * **Este objeto carrega o segredo em claro, em memória, por instantes.** Daí ele
 * recusar-se a aparecer em log, em `JSON.stringify` e em mensagem de erro: o
 * caminho mais comum de vazamento de credencial não é ataque, é um `console.log`
 * de diagnóstico que ninguém removeu.
 */

const TAMANHO = 6;

const SOMENTE_DIGITOS = /^\d+$/;

/** O que o objeto revela quando alguém tenta imprimi-lo. */
const MASCARA = "[PIN oculto]";

export class Pin {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<Pin, ErroValidacao> {
    const limpo = valor.trim();

    if (!SOMENTE_DIGITOS.test(limpo) || limpo.length !== TAMANHO) {
      return err(
        new ErroValidacao(
          "PIN_FORMATO_INVALIDO",
          `O PIN deve ter ${String(TAMANHO)} números.`,
          // Sem `valorRecebido`: seria o segredo indo para o log.
          { tamanhoRecebido: limpo.length },
        ),
      );
    }

    if (ehTrivial(limpo)) {
      return err(
        new ErroValidacao(
          "PIN_PREVISIVEL",
          "Escolha um PIN menos óbvio: evite números repetidos ou em sequência.",
        ),
      );
    }

    return ok(new Pin(limpo));
  }

  /**
   * O segredo em claro.
   *
   * Nomeado assim para que a leitura do código acuse o que está acontecendo. O
   * único chamador legítimo é o adapter que calcula ou verifica o hash.
   */
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

/**
 * Recusa PIN adivinhável por quem convive com o operador.
 *
 * Não é teatro de segurança: a ameaça mapeada como **alta** é o colega que
 * cancela venda no login de outro (§7.1). `111111` e `123456` são as primeiras
 * tentativas de quem está ao lado, e a auditoria passaria a apontar a pessoa
 * errada — pior que não ter auditoria, porque parece prova.
 */
function ehTrivial(digitos: string): boolean {
  const todosIguais = /^(\d)\1+$/.test(digitos);
  if (todosIguais) return true;

  const crescente = digitos
    .split("")
    .every((digito, indice, todos) =>
      indice === 0 ? true : Number(digito) === Number(todos[indice - 1]) + 1,
    );
  if (crescente) return true;

  return digitos
    .split("")
    .every((digito, indice, todos) =>
      indice === 0 ? true : Number(digito) === Number(todos[indice - 1]) - 1,
    );
}
