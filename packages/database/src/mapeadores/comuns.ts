import {
  type CodigoUnidade,
  Dinheiro,
  ehCodigoUnidade,
  Identificador,
  Quantidade,
} from "@erp/domain";

/**
 * Conversões entre domínio e linha do banco.
 *
 * Funções puras, testáveis sem banco — e é onde mora o risco real desta
 * camada: perder precisão convertendo `BigInt` ou trocar unidade.
 *
 * As funções `paraX` lançam quando o dado é inválido, e isso é deliberado:
 * linha corrompida no banco é bug ou corrupção, não regra de negócio. Devolver
 * `Result` faria cada leitura carregar um tratamento de erro que nunca deveria
 * acontecer (princípio 7 do CLAUDE.md).
 */

export function paraId(valor: string): Identificador {
  const id = Identificador.criar(valor);

  if (id.isErr()) {
    throw new Error(`Identificador inválido no banco: ${valor}`);
  }

  return id.unwrap();
}

export function paraIdOpcional(valor: string | null): Identificador | undefined {
  return valor === null ? undefined : paraId(valor);
}

export function paraDinheiro(centavos: bigint): Dinheiro {
  const valor = Dinheiro.deCentavos(centavos);

  if (valor.isErr()) {
    throw new Error(`Valor monetário inválido no banco: ${centavos.toString()}`);
  }

  return valor.unwrap();
}

export function paraUnidade(codigo: string): CodigoUnidade {
  if (!ehCodigoUnidade(codigo)) {
    throw new Error(`Unidade de medida desconhecida no banco: ${codigo}`);
  }

  return codigo;
}

export function paraQuantidade(milesimos: bigint, unidade: string): Quantidade {
  const quantidade = Quantidade.deMilesimos(milesimos, paraUnidade(unidade));

  if (quantidade.isErr()) {
    throw new Error(`Quantidade inválida no banco: ${milesimos.toString()} ${unidade}`);
  }

  return quantidade.unwrap();
}

/** Converte `undefined` em `null`, que é o que o Prisma espera em coluna opcional. */
export function ouNulo<T>(valor: T | undefined): T | null {
  return valor ?? null;
}
