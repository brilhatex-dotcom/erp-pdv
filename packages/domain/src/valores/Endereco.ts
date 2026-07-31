import { apenasDigitos, textoOpcional } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { ValueObject } from "../shared/ValueObject.js";

import { ehSiglaUF, type SiglaUF } from "./UF.js";

/** Limite dos campos de endereço no layout da NF-e (`xLgr`, `xBairro`, `xMun`). */
const TAMANHO_MAXIMO_CAMPO = 60;
const TAMANHO_MAXIMO_NUMERO = 60;
/** `cMun` do IBGE tem sempre 7 dígitos. */
const DIGITOS_CODIGO_MUNICIPIO = 7;

export interface DadosEndereco {
  readonly logradouro: string;
  readonly numero: string;
  readonly complemento?: string | undefined;
  readonly bairro: string;
  readonly municipio: string;
  /** Código do IBGE do município — `cMun` do XML fiscal. */
  readonly codigoMunicipioIbge?: string | undefined;
  readonly uf: string;
  readonly cep: string;
}

/**
 * Endereço completo, validado na construção.
 *
 * **Ou o endereço existe inteiro, ou não existe.** Meio endereço — com CEP e
 * sem número, ou com cidade e sem UF — é o que faz a entrega não chegar e a
 * nota fiscal ser rejeitada. Quem não tem endereço para informar simplesmente
 * não constrói um: no cliente e no fornecedor o campo é opcional.
 *
 * Os limites de tamanho vêm do layout da NF-e, e não de gosto: um logradouro
 * com 80 caracteres é aceito pelo formulário, gravado no banco e **rejeitado**
 * na emissão, quando já não há como corrigir sem refazer a venda.
 */
export class Endereco implements ValueObject<Endereco> {
  readonly #logradouro: string;
  readonly #numero: string;
  readonly #complemento: string | undefined;
  readonly #bairro: string;
  readonly #municipio: string;
  readonly #codigoMunicipioIbge: string | undefined;
  readonly #uf: SiglaUF;
  readonly #cep: string;

  private constructor(dados: {
    readonly logradouro: string;
    readonly numero: string;
    readonly complemento: string | undefined;
    readonly bairro: string;
    readonly municipio: string;
    readonly codigoMunicipioIbge: string | undefined;
    readonly uf: SiglaUF;
    readonly cep: string;
  }) {
    this.#logradouro = dados.logradouro;
    this.#numero = dados.numero;
    this.#complemento = dados.complemento;
    this.#bairro = dados.bairro;
    this.#municipio = dados.municipio;
    this.#codigoMunicipioIbge = dados.codigoMunicipioIbge;
    this.#uf = dados.uf;
    this.#cep = dados.cep;
  }

  /**
   * Cria um endereço validado, devolvendo **todos** os erros de uma vez.
   *
   * Endereço é o bloco mais longo do cadastro; corrigir um campo por vez, com
   * uma gravação a cada tentativa, é o tipo de fricção que faz o usuário
   * desistir de preencher — e um cadastro pela metade custa mais do que nenhum.
   */
  static criar(dados: DadosEndereco): Result<Endereco, ErroValidacao[]> {
    const erros: ErroValidacao[] = [];

    const logradouro = exigirTexto(
      dados.logradouro,
      "ENDERECO_LOGRADOURO",
      "a rua",
      erros,
    );
    const numero = dados.numero.trim();
    if (numero === "") {
      erros.push(
        new ErroValidacao(
          "ENDERECO_NUMERO_VAZIO",
          "Informe o número. Use S/N quando não houver.",
        ),
      );
    } else if (numero.length > TAMANHO_MAXIMO_NUMERO) {
      erros.push(
        new ErroValidacao(
          "ENDERECO_NUMERO_LONGO",
          `O número deve ter no máximo ${String(TAMANHO_MAXIMO_NUMERO)} caracteres.`,
          { tamanho: numero.length },
        ),
      );
    }

    const bairro = exigirTexto(dados.bairro, "ENDERECO_BAIRRO", "o bairro", erros);
    const municipio = exigirTexto(
      dados.municipio,
      "ENDERECO_MUNICIPIO",
      "a cidade",
      erros,
    );

    const complemento = textoOpcional(dados.complemento);
    if (complemento !== undefined && complemento.length > TAMANHO_MAXIMO_CAMPO) {
      erros.push(
        new ErroValidacao(
          "ENDERECO_COMPLEMENTO_LONGO",
          `O complemento deve ter no máximo ${String(TAMANHO_MAXIMO_CAMPO)} caracteres.`,
          { tamanho: complemento.length },
        ),
      );
    }

    const bruta = dados.uf.trim().toUpperCase();
    // Guardar o resultado do estreitamento em vez de afirmá-lo depois: um
    // `as SiglaUF` no fim diria ao compilador algo que ele não verificou.
    const uf = ehSiglaUF(bruta) ? bruta : undefined;
    if (uf === undefined) {
      erros.push(
        new ErroValidacao("ENDERECO_UF_INVALIDA", "Informe uma UF válida, como SP.", {
          uf: bruta,
        }),
      );
    }

    const cep = apenasDigitos(dados.cep);
    if (cep.length !== 8) {
      erros.push(
        new ErroValidacao("ENDERECO_CEP_INVALIDO", "O CEP deve ter 8 dígitos.", {
          quantidadeInformada: cep.length,
        }),
      );
    }

    const informado = textoOpcional(dados.codigoMunicipioIbge);
    const codigoMunicipio =
      informado === undefined ? undefined : apenasDigitos(informado);

    if (
      codigoMunicipio !== undefined &&
      codigoMunicipio.length !== DIGITOS_CODIGO_MUNICIPIO
    ) {
      erros.push(
        new ErroValidacao(
          "ENDERECO_MUNICIPIO_IBGE_INVALIDO",
          `O código do município deve ter ${String(DIGITOS_CODIGO_MUNICIPIO)} dígitos.`,
          { quantidadeInformada: codigoMunicipio.length },
        ),
      );
    }

    if (uf === undefined || erros.length > 0) return err(erros);

    return ok(
      new Endereco({
        logradouro,
        numero,
        complemento,
        bairro,
        municipio,
        codigoMunicipioIbge: codigoMunicipio,
        uf,
        cep,
      }),
    );
  }

  get logradouro(): string {
    return this.#logradouro;
  }

  get numero(): string {
    return this.#numero;
  }

  get complemento(): string | undefined {
    return this.#complemento;
  }

  get bairro(): string {
    return this.#bairro;
  }

  get municipio(): string {
    return this.#municipio;
  }

  get codigoMunicipioIbge(): string | undefined {
    return this.#codigoMunicipioIbge;
  }

  get uf(): SiglaUF {
    return this.#uf;
  }

  /** Os 8 dígitos, sem máscara. */
  get cep(): string {
    return this.#cep;
  }

  equals(outro: Endereco): boolean {
    return this.linhaUnica() === outro.linhaUnica();
  }

  /** Formata como `01310-100`. */
  cepFormatado(): string {
    return `${this.#cep.slice(0, 5)}-${this.#cep.slice(5)}`;
  }

  /** Uma linha, como se escreve num envelope. */
  linhaUnica(): string {
    const complemento = this.#complemento === undefined ? "" : ` ${this.#complemento}`;

    return `${this.#logradouro}, ${this.#numero}${complemento} — ${this.#bairro}, ${this.#municipio}/${this.#uf} — ${this.cepFormatado()}`;
  }

  toString(): string {
    return this.linhaUnica();
  }
}

/** Valida um campo de texto obrigatório do endereço, acumulando o erro. */
function exigirTexto(
  bruto: string,
  prefixoCodigo: string,
  oQue: string,
  erros: ErroValidacao[],
): string {
  const valor = bruto.trim();

  if (valor === "") {
    erros.push(new ErroValidacao(`${prefixoCodigo}_VAZIO`, `Informe ${oQue}.`));
  } else if (valor.length > TAMANHO_MAXIMO_CAMPO) {
    erros.push(
      new ErroValidacao(
        `${prefixoCodigo}_LONGO`,
        `O campo deve ter no máximo ${String(TAMANHO_MAXIMO_CAMPO)} caracteres.`,
        { tamanho: valor.length },
      ),
    );
  }

  return valor;
}
