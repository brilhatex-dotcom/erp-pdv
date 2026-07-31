import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";

export const TAMANHO_PIN = 6;

/**
 * PIN do operador — **valor em claro, nunca persistido**.
 *
 * Existe só para carregar o que o operador digitou até a porta que calcula o
 * hash. O que fica guardado é `CredencialHash`, e é por isso que esta classe
 * não tem `toJSON` nem `toString`: um PIN que aparece em log ou em resposta de
 * erro deixou de ser secreto.
 *
 * ### Por que seis dígitos bastam aqui
 *
 * Um PIN seria fraco na internet. No balcão, não: o ataque exige **presença
 * física** na loja, e o bloqueio progressivo do `Usuario` limita a poucas
 * tentativas por hora. Exigir senha longa no caixa produziria o defeito real —
 * a equipe compartilhando um login para não perder tempo (ADR-0011).
 */
export class Pin {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<Pin, ErroValidacao> {
    const limpo = valor.trim();

    if (!new RegExp(`^\\d{${String(TAMANHO_PIN)}}$`).test(limpo)) {
      return err(
        new ErroValidacao(
          "PIN_FORMATO_INVALIDO",
          `O PIN deve ter exatamente ${String(TAMANHO_PIN)} números.`,
        ),
      );
    }

    // Recusados porque são os primeiros que qualquer pessoa tenta, e porque
    // são os que o operador escolhe sozinho quando ninguém o impede.
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
   * Valor em claro, para entregar à porta que calcula o hash.
   *
   * Nome deliberadamente incômodo: quem escrever `pin.valorEmClaro` num log
   * vai enxergar o que está fazendo.
   */
  get valorEmClaro(): string {
    return this.#valor;
  }
}

/**
 * Todos os dígitos iguais, ou sequência crescente/decrescente.
 *
 * Trabalha sobre as **diferenças entre dígitos vizinhos**, o que resolve os
 * três casos com a mesma passada: só zeros é repetição, só uns é sequência
 * crescente, só menos-uns é decrescente.
 *
 * Usa `charCodeAt` em vez de espalhar a string — o formato já garantiu seis
 * dígitos ASCII, e a diferença entre códigos é a diferença entre os dígitos.
 */
function ehTrivial(pin: string): boolean {
  const diferencas = Array.from(
    { length: pin.length - 1 },
    (_, indice) => pin.charCodeAt(indice + 1) - pin.charCodeAt(indice),
  );

  return (
    diferencas.every((diferenca) => diferenca === 0) ||
    diferencas.every((diferenca) => diferenca === 1) ||
    diferencas.every((diferenca) => diferenca === -1)
  );
}
