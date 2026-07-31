/**
 * Unidades da federação, com o código do IBGE.
 *
 * O código do IBGE não é enfeite: é o campo `cUF` do XML fiscal, e sem ele o
 * endereço do destinatário não fecha uma NF-e. Guardá-lo aqui, junto da sigla,
 * evita a tabela paralela que sempre nasce depois — e que sempre diverge.
 *
 * A união fechada existe pelo mesmo motivo de `Permissao`: `uf: string` aceita
 * "SP " com espaço, "sp" minúsculo e "XX", e o erro só aparece na rejeição da
 * SEFAZ, com a venda já feita.
 */
export type SiglaUF =
  | "AC"
  | "AL"
  | "AP"
  | "AM"
  | "BA"
  | "CE"
  | "DF"
  | "ES"
  | "GO"
  | "MA"
  | "MT"
  | "MS"
  | "MG"
  | "PA"
  | "PB"
  | "PR"
  | "PE"
  | "PI"
  | "RJ"
  | "RN"
  | "RS"
  | "RO"
  | "RR"
  | "SC"
  | "SP"
  | "SE"
  | "TO";

export interface UnidadeFederativa {
  readonly sigla: SiglaUF;
  readonly nome: string;
  /** Código do IBGE — campo `cUF` do XML fiscal. */
  readonly codigoIbge: number;
}

export const UFS = {
  AC: { sigla: "AC", nome: "Acre", codigoIbge: 12 },
  AL: { sigla: "AL", nome: "Alagoas", codigoIbge: 27 },
  AP: { sigla: "AP", nome: "Amapá", codigoIbge: 16 },
  AM: { sigla: "AM", nome: "Amazonas", codigoIbge: 13 },
  BA: { sigla: "BA", nome: "Bahia", codigoIbge: 29 },
  CE: { sigla: "CE", nome: "Ceará", codigoIbge: 23 },
  DF: { sigla: "DF", nome: "Distrito Federal", codigoIbge: 53 },
  ES: { sigla: "ES", nome: "Espírito Santo", codigoIbge: 32 },
  GO: { sigla: "GO", nome: "Goiás", codigoIbge: 52 },
  MA: { sigla: "MA", nome: "Maranhão", codigoIbge: 21 },
  MT: { sigla: "MT", nome: "Mato Grosso", codigoIbge: 51 },
  MS: { sigla: "MS", nome: "Mato Grosso do Sul", codigoIbge: 50 },
  MG: { sigla: "MG", nome: "Minas Gerais", codigoIbge: 31 },
  PA: { sigla: "PA", nome: "Pará", codigoIbge: 15 },
  PB: { sigla: "PB", nome: "Paraíba", codigoIbge: 25 },
  PR: { sigla: "PR", nome: "Paraná", codigoIbge: 41 },
  PE: { sigla: "PE", nome: "Pernambuco", codigoIbge: 26 },
  PI: { sigla: "PI", nome: "Piauí", codigoIbge: 22 },
  RJ: { sigla: "RJ", nome: "Rio de Janeiro", codigoIbge: 33 },
  RN: { sigla: "RN", nome: "Rio Grande do Norte", codigoIbge: 24 },
  RS: { sigla: "RS", nome: "Rio Grande do Sul", codigoIbge: 43 },
  RO: { sigla: "RO", nome: "Rondônia", codigoIbge: 11 },
  RR: { sigla: "RR", nome: "Roraima", codigoIbge: 14 },
  SC: { sigla: "SC", nome: "Santa Catarina", codigoIbge: 42 },
  SP: { sigla: "SP", nome: "São Paulo", codigoIbge: 35 },
  SE: { sigla: "SE", nome: "Sergipe", codigoIbge: 28 },
  TO: { sigla: "TO", nome: "Tocantins", codigoIbge: 17 },
} as const satisfies Record<SiglaUF, UnidadeFederativa>;

export function ehSiglaUF(valor: string): valor is SiglaUF {
  return Object.hasOwn(UFS, valor);
}

export function obterUF(sigla: SiglaUF): UnidadeFederativa {
  return UFS[sigla];
}
