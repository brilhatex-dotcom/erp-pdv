import { Documento, Email, Endereco, InscricaoEstadual, Telefone } from "@erp/domain";

/**
 * Conversões compartilhadas por cliente e fornecedor.
 *
 * O endereço fica **achatado em colunas**, não em JSON. Custa oito campos a
 * mais no schema e devolve o que importa: consultar por município ou UF é uma
 * cláusula `WHERE` comum, indexável, em vez de extração de JSON — e é
 * exatamente o que o relatório de vendas por região vai pedir. JSON aqui
 * pareceria mais simples hoje e viraria varredura de tabela depois.
 *
 * Os `unwrap()` na volta do banco são intencionais: o que está gravado passou
 * pela validação na ida. Um endereço inválido no banco é defeito de
 * programação — precisa estourar alto, não virar `undefined` silencioso que a
 * tela mostra como campo vazio.
 */

/** As oito colunas de endereço, como o Prisma as recebe. */
export interface ColunasEndereco {
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly municipio: string | null;
  readonly codigoMunicipioIbge: string | null;
  readonly uf: string | null;
  readonly cep: string | null;
}

export function enderecoParaColunas(endereco: Endereco | undefined): ColunasEndereco {
  if (endereco === undefined) {
    return {
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      municipio: null,
      codigoMunicipioIbge: null,
      uf: null,
      cep: null,
    };
  }

  return {
    logradouro: endereco.logradouro,
    numero: endereco.numero,
    complemento: endereco.complemento ?? null,
    bairro: endereco.bairro,
    municipio: endereco.municipio,
    codigoMunicipioIbge: endereco.codigoMunicipioIbge ?? null,
    uf: endereco.uf,
    cep: endereco.cep,
  };
}

export function enderecoDeColunas(colunas: ColunasEndereco): Endereco | undefined {
  const { logradouro, numero, bairro, municipio, uf, cep } = colunas;

  // As oito colunas são gravadas juntas ou nenhuma: `enderecoParaColunas` não
  // produz meio endereço. Por isso a checagem é uma só — ou o conjunto
  // obrigatório está lá, ou não há endereço.
  if (
    logradouro === null ||
    numero === null ||
    bairro === null ||
    municipio === null ||
    uf === null ||
    cep === null
  ) {
    return undefined;
  }

  // `unwrap()` de propósito: o que está gravado passou pela validação na ida.
  // Endereço inválido no banco é corrupção, e precisa estourar alto em vez de
  // virar campo vazio na tela (mesma doutrina de `comuns.ts`).
  return Endereco.criar({
    logradouro,
    numero,
    complemento: colunas.complemento ?? undefined,
    bairro,
    municipio,
    codigoMunicipioIbge: colunas.codigoMunicipioIbge ?? undefined,
    uf,
    cep,
  }).unwrap();
}

export function documentoDeColuna(valor: string | null): Documento | undefined {
  return valor === null ? undefined : Documento.criar(valor).unwrap();
}

export function telefoneDeColuna(valor: string | null): Telefone | undefined {
  return valor === null ? undefined : Telefone.criar(valor).unwrap();
}

export function emailDeColuna(valor: string | null): Email | undefined {
  return valor === null ? undefined : Email.criar(valor).unwrap();
}

export function inscricaoDeColuna(valor: string | null): InscricaoEstadual | undefined {
  return valor === null ? undefined : InscricaoEstadual.criar(valor).unwrap();
}
