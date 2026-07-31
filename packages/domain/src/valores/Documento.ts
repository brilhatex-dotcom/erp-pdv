import { apenasAlfanumericos, apenasDigitos } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

import { CNPJ } from "./CNPJ.js";
import { CPF } from "./CPF.js";

export type TipoDocumento = "CPF" | "CNPJ";

/**
 * Documento de uma pessoa — CPF ou CNPJ, decidido pelo que foi digitado.
 *
 * Existe porque cliente e fornecedor precisam da **mesma pergunta** ("qual o
 * documento?") sem que a tela obrigue o usuário a classificar antes de digitar.
 * Quem atende no balcão digita o que está no papel; separar pessoa física de
 * jurídica é trabalho do sistema, e é derivável do tamanho.
 *
 * Não é uma terceira validação: delega a `CPF` e `CNPJ`, que continuam sendo os
 * donos da regra. O que ele acrescenta é a **escolha** entre os dois e um tipo
 * único para persistir, comparar e exibir.
 */
export class Documento implements ValueObject<Documento> {
  readonly #tipo: TipoDocumento;
  readonly #cpf: CPF | undefined;
  readonly #cnpj: CNPJ | undefined;

  private constructor(tipo: TipoDocumento, cpf: CPF | undefined, cnpj: CNPJ | undefined) {
    this.#tipo = tipo;
    this.#cpf = cpf;
    this.#cnpj = cnpj;
  }

  /**
   * Interpreta o documento pelo tamanho: 11 caracteres é CPF, 14 é CNPJ.
   *
   * Qualquer outro tamanho é recusado com mensagem que diz **os dois** formatos
   * aceitos. "Documento inválido" sozinho faz o operador tentar de novo com o
   * mesmo número errado.
   */
  static criar(valor: string): Result<Documento, ErroValidacao> {
    const caracteres = apenasAlfanumericos(valor);

    if (caracteres.length === 0) {
      return err(new ErroValidacao("DOCUMENTO_VAZIO", "Informe o CPF ou o CNPJ."));
    }

    if (caracteres.length === 11) {
      return CPF.criar(apenasDigitos(valor)).map((cpf) => Documento.deCpf(cpf));
    }

    if (caracteres.length === 14) {
      return CNPJ.criar(caracteres).map((cnpj) => Documento.deCnpj(cnpj));
    }

    return err(
      new ErroValidacao(
        "DOCUMENTO_TAMANHO_INVALIDO",
        "O documento deve ter 11 caracteres (CPF) ou 14 (CNPJ).",
        { quantidadeInformada: caracteres.length },
      ),
    );
  }

  static deCpf(cpf: CPF): Documento {
    return new Documento("CPF", cpf, undefined);
  }

  static deCnpj(cnpj: CNPJ): Documento {
    return new Documento("CNPJ", undefined, cnpj);
  }

  get tipo(): TipoDocumento {
    return this.#tipo;
  }

  /** Caracteres sem máscara — é o formato que o XML fiscal exige. */
  get valor(): string {
    return this.#cpf?.digitos ?? this.#cnpj?.caracteres ?? "";
  }

  get ehPessoaFisica(): boolean {
    return this.#tipo === "CPF";
  }

  get ehPessoaJuridica(): boolean {
    return this.#tipo === "CNPJ";
  }

  equals(outro: Documento): boolean {
    return this.#tipo === outro.#tipo && this.valor === outro.valor;
  }

  formatar(): string {
    return this.#cpf?.formatar() ?? this.#cnpj?.formatar() ?? "";
  }

  /**
   * Formato reduzido para listagem, onde o dado fica visível no balcão.
   *
   * Só o CPF é mascarado: é dado pessoal de pessoa natural (LGPD), enquanto o
   * CNPJ é informação pública de empresa e esconder metade dele só atrapalharia
   * quem confere uma nota de entrada.
   */
  formatarParaListagem(): string {
    return this.#cpf?.formatarMascarado() ?? this.formatar();
  }

  toString(): string {
    return this.formatar();
  }

  toJSON(): string {
    return this.valor;
  }
}
