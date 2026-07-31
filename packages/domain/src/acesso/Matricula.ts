import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

/**
 * Matrícula — como o operador se identifica no balcão.
 *
 * Só dígitos, e curta, porque o requisito real é troca de operador em segundos
 * com fila esperando (ARQUITETURA.md §8.1). Nome de usuário obrigaria a sair do
 * teclado numérico do PDV, e cada segundo ali se multiplica por centenas de
 * trocas por mês. O que impede o compartilhamento de login não é a força da
 * matrícula — é ela ser individual e o PIN ser secreto.
 */

const TAMANHO_MAXIMO = 8;

const SOMENTE_DIGITOS = /^\d+$/;

export class Matricula implements ValueObject<Matricula> {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<Matricula, ErroValidacao> {
    const limpo = valor.trim();

    if (limpo === "") {
      return err(new ErroValidacao("MATRICULA_VAZIA", "Informe a matrícula."));
    }

    if (!SOMENTE_DIGITOS.test(limpo)) {
      return err(
        new ErroValidacao(
          "MATRICULA_FORMATO_INVALIDO",
          "A matrícula deve conter apenas números.",
          { valorRecebido: valor },
        ),
      );
    }

    if (limpo.length > TAMANHO_MAXIMO) {
      return err(
        new ErroValidacao(
          "MATRICULA_MUITO_LONGA",
          `A matrícula deve ter até ${String(TAMANHO_MAXIMO)} dígitos.`,
          { tamanho: limpo.length },
        ),
      );
    }

    return ok(new Matricula(removerZerosAEsquerda(limpo)));
  }

  get valor(): string {
    return this.#valor;
  }

  equals(outra: Matricula): boolean {
    return this.#valor === outra.#valor;
  }

  toString(): string {
    return this.#valor;
  }
}

/**
 * Normaliza `007` e `7` para a mesma matrícula.
 *
 * Sem isso, dois cadastros diferentes representariam a mesma pessoa: o gerente
 * cadastra `07`, o operador digita `7`, o login falha, e ninguém entende por
 * quê. É o tipo de detalhe que não aparece em teste e aparece em chamado.
 */
function removerZerosAEsquerda(digitos: string): string {
  const semZeros = digitos.replace(/^0+/, "");

  // Matrícula "0" (ou "000") é legítima e não deve virar texto vazio.
  return semZeros === "" ? "0" : semZeros;
}
