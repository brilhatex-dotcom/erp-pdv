import { ItemDaNota, NotaDeCompra } from "@erp/domain";

import type {
  ItemNotaCompra as ItemLinha,
  NotaDeCompra as NotaLinha,
} from "../gerado/index.js";

import { paraDinheiro, paraId, paraQuantidade, paraUnidade } from "./comuns.js";

export type NotaCompleta = NotaLinha & {
  readonly itens: readonly ItemLinha[];
};

/** Linha do banco → agregado. */
export function paraDominio(linha: NotaCompleta): NotaDeCompra {
  return NotaDeCompra.reconstituir({
    id: paraId(linha.id),
    fornecedorId: paraId(linha.fornecedorId),
    numero: linha.numero,
    // Vazio no banco significa "sem série" — ver a nota no esquema sobre por
    // que a coluna não é nula.
    serie: linha.serie === "" ? undefined : linha.serie,
    emitidaEm: linha.emitidaEm,
    recebidaEm: linha.recebidaEm,
    itens: [...linha.itens]
      .sort((um, outro) => um.numero - outro.numero)
      .map((item) =>
        ItemDaNota.reconstituir(item.numero, {
          produtoId: paraId(item.produtoId),
          descricao: item.descricao,
          quantidade: paraQuantidade(item.quantidade, paraUnidade(item.unidade)),
          custoUnitario: paraDinheiro(item.custoUnitario),
          desconto: paraDinheiro(item.desconto),
        }),
      ),
    totalDeclarado: paraDinheiro(linha.totalDeclarado),
    usuarioId: paraId(linha.usuarioId),
    observacao: linha.observacao ?? undefined,
    status: linha.status,
    canceladaEm: linha.canceladaEm ?? undefined,
    motivoCancelamento: linha.motivoCancelamento ?? undefined,
  });
}

/** Agregado → colunas para gravar. */
export function paraLinha(nota: NotaDeCompra): Omit<NotaLinha, "criadoEm"> {
  return {
    id: nota.id.valor,
    fornecedorId: nota.fornecedorId.valor,
    numero: nota.numero,
    serie: nota.serie ?? "",
    emitidaEm: nota.emitidaEm,
    recebidaEm: nota.recebidaEm,
    totalDeclarado: nota.totalDeclarado.centavos,
    usuarioId: nota.usuarioId.valor,
    observacao: nota.observacao ?? null,
    status: nota.status,
    canceladaEm: nota.canceladaEm ?? null,
    motivoCancelamento: nota.motivoCancelamento ?? null,
  };
}

/** Itens da nota → linhas filhas. */
export function itensParaLinhas(nota: NotaDeCompra): ItemLinha[] {
  return nota.itens.map((item) => ({
    notaId: nota.id.valor,
    numero: item.numero,
    produtoId: item.produtoId.valor,
    descricao: item.descricao,
    quantidade: item.quantidade.milesimos,
    unidade: item.quantidade.unidade.codigo,
    custoUnitario: item.custoUnitario.centavos,
    desconto: item.desconto.centavos,
  }));
}
