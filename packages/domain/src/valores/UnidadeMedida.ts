/**
 * Unidades de medida do varejo atendido pelo produto.
 *
 * `fracionavel` é regra de negócio, não enfeite: meio quilo de carne é venda
 * normal num açougue, mas meia caixa de cerveja não existe num depósito. Marcar
 * isso na unidade faz o domínio recusar `0,5 CX` sem que cada tela precise
 * lembrar da regra.
 */

/**
 * Códigos aceitos. Declarado explicitamente, e não derivado de `UNIDADES`,
 * para que `UnidadeMedida.codigo` possa ser este tipo sem criar referência
 * circular — é o que evita `as CodigoUnidade` espalhado por quem consome.
 */
export type CodigoUnidade =
  | "UN"
  | "PC"
  | "CX"
  | "FD"
  | "PCT"
  | "DZ"
  | "KG"
  | "G"
  | "L"
  | "ML"
  | "M"
  | "M2"
  | "M3"
  | "SC";

export interface UnidadeMedida {
  /** Código usado no XML fiscal (campo `uCom`, até 6 caracteres). */
  readonly codigo: CodigoUnidade;
  readonly simbolo: string;
  readonly descricao: string;
  readonly fracionavel: boolean;
}

export const UNIDADES = {
  UN: { codigo: "UN", simbolo: "un", descricao: "Unidade", fracionavel: false },
  PC: { codigo: "PC", simbolo: "pç", descricao: "Peça", fracionavel: false },
  CX: { codigo: "CX", simbolo: "cx", descricao: "Caixa", fracionavel: false },
  FD: { codigo: "FD", simbolo: "fd", descricao: "Fardo", fracionavel: false },
  PCT: { codigo: "PCT", simbolo: "pct", descricao: "Pacote", fracionavel: false },
  DZ: { codigo: "DZ", simbolo: "dz", descricao: "Dúzia", fracionavel: false },
  KG: { codigo: "KG", simbolo: "kg", descricao: "Quilograma", fracionavel: true },
  G: { codigo: "G", simbolo: "g", descricao: "Grama", fracionavel: true },
  L: { codigo: "L", simbolo: "L", descricao: "Litro", fracionavel: true },
  ML: { codigo: "ML", simbolo: "mL", descricao: "Mililitro", fracionavel: true },
  M: { codigo: "M", simbolo: "m", descricao: "Metro", fracionavel: true },
  M2: { codigo: "M2", simbolo: "m²", descricao: "Metro quadrado", fracionavel: true },
  M3: { codigo: "M3", simbolo: "m³", descricao: "Metro cúbico", fracionavel: true },
  SC: { codigo: "SC", simbolo: "sc", descricao: "Saco", fracionavel: false },
} as const satisfies Record<CodigoUnidade, UnidadeMedida>;

export function ehCodigoUnidade(codigo: string): codigo is CodigoUnidade {
  return Object.hasOwn(UNIDADES, codigo);
}

export function obterUnidade(codigo: CodigoUnidade): UnidadeMedida {
  return UNIDADES[codigo];
}
