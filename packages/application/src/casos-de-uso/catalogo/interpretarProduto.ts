import {
  CodigoBarras,
  type CodigoUnidade,
  Dinheiro,
  Embalagem,
  type ErroValidacao,
  ReferenciaProduto,
  type TipoReferencia,
} from "@erp/domain";
import { textoOpcional } from "@erp/utils";

/**
 * Tradução do formulário de produto para objetos de valor.
 *
 * Mora na aplicação, e não em cada porta de entrada, pelo mesmo motivo de
 * `interpretar.ts` nos cadastros: a conversão é a mesma para a tela da
 * retaguarda, para a importação de planilha e para a entrada de mercadoria por
 * XML. Repetida em cada adapter, uma delas aceitaria um código de barras que a
 * outra recusa.
 *
 * Acumula os erros em vez de parar no primeiro: cadastro de produto é um
 * formulário longo, e descobrir um erro por vez é desperdício do tempo de quem
 * está cadastrando cem itens (CLAUDE.md §8, papel UX).
 */

export interface ReferenciaBruta {
  readonly tipo: TipoReferencia;
  readonly valor: string;
}

export interface EmbalagemBruta {
  readonly unidade: CodigoUnidade;
  /** Quantas unidades base a embalagem contém. */
  readonly fator: bigint;
  readonly codigoBarras?: string | undefined;
}

export function interpretarCodigoBarras(
  bruto: string | undefined,
  erros: ErroValidacao[],
): CodigoBarras | undefined {
  const texto = textoOpcional(bruto);
  if (texto === undefined) return undefined;

  const resultado = CodigoBarras.criar(texto);

  if (resultado.isErr()) {
    erros.push(resultado.error);
    return undefined;
  }

  return resultado.unwrap();
}

export function interpretarReferencias(
  brutas: readonly ReferenciaBruta[] | undefined,
  erros: ErroValidacao[],
): ReferenciaProduto[] {
  const referencias: ReferenciaProduto[] = [];

  for (const bruta of brutas ?? []) {
    const resultado = ReferenciaProduto.criar(bruta.tipo, bruta.valor);

    if (resultado.isErr()) {
      erros.push(resultado.error);
      continue;
    }

    referencias.push(resultado.unwrap());
  }

  return referencias;
}

export function interpretarEmbalagens(
  brutas: readonly EmbalagemBruta[] | undefined,
  erros: ErroValidacao[],
): Embalagem[] {
  const embalagens: Embalagem[] = [];

  for (const bruta of brutas ?? []) {
    // O código de barras da embalagem é opcional e independente: uma caixa sem
    // DUN-14 continua sendo uma caixa válida. Erro nele não descarta a
    // embalagem inteira, só o código.
    const codigoBarras = interpretarCodigoBarras(bruta.codigoBarras, erros);

    const resultado = Embalagem.criar(bruta.unidade, bruta.fator, codigoBarras);

    if (resultado.isErr()) {
      erros.push(resultado.error);
      continue;
    }

    embalagens.push(resultado.unwrap());
  }

  return embalagens;
}

/**
 * Converte centavos em `Dinheiro`.
 *
 * Recebe `bigint`, e não `number`: dinheiro atravessa a fronteira como inteiro
 * em texto (ADR-0019), e quem converte para número no caminho reintroduz o
 * `double` que o ADR-0009 proíbe.
 */
export function interpretarCentavos(
  centavos: bigint | undefined,
  erros: ErroValidacao[],
): Dinheiro | undefined {
  if (centavos === undefined) return undefined;

  const resultado = Dinheiro.deCentavos(centavos);

  if (resultado.isErr()) {
    erros.push(resultado.error);
    return undefined;
  }

  return resultado.unwrap();
}
