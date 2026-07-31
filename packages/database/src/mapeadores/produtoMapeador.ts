import { CodigoBarras, Embalagem, Produto, ReferenciaProduto } from "@erp/domain";

import type {
  Embalagem as EmbalagemLinha,
  Produto as ProdutoLinha,
  ReferenciaProduto as ReferenciaLinha,
} from "../../gerado/index.js";
import { ouNulo, paraDinheiro, paraId, paraIdOpcional, paraUnidade } from "./comuns.js";

export type ProdutoCompleto = ProdutoLinha & {
  readonly referencias: readonly ReferenciaLinha[];
  readonly embalagens: readonly EmbalagemLinha[];
};

/** Linha do banco → agregado. */
export function paraDominio(linha: ProdutoCompleto): Produto {
  return Produto.reconstituir({
    id: paraId(linha.id),
    sku: linha.sku,
    descricao: linha.descricao,
    descricaoPdv: linha.descricaoPdv,
    tipo: linha.tipo,
    unidadeBase: paraUnidade(linha.unidadeBase),
    precoVenda: paraDinheiro(linha.precoVenda),
    custo: paraDinheiro(linha.custo),
    codigoBarras:
      linha.codigoBarras === null
        ? undefined
        : // Já validado quando foi gravado; reconstituição não revalida.
          CodigoBarras.criarInterno(linha.codigoBarras).unwrap(),
    codigoBalanca: linha.codigoBalanca ?? undefined,
    categoriaId: paraIdOpcional(linha.categoriaId),
    perfilTributarioId: paraIdOpcional(linha.perfilTributarioId),
    ativo: linha.ativo,
    referencias: linha.referencias.map((referencia) =>
      ReferenciaProduto.criar(referencia.tipo, referencia.valor).unwrap(),
    ),
    embalagens: linha.embalagens.map((embalagem) =>
      Embalagem.criar(
        paraUnidade(embalagem.unidade),
        embalagem.fator,
        embalagem.codigoBarras === null
          ? undefined
          : CodigoBarras.criarInterno(embalagem.codigoBarras).unwrap(),
      ).unwrap(),
    ),
  });
}

/** Agregado → colunas para gravar. */
export function paraLinha(
  produto: Produto,
): Omit<ProdutoLinha, "criadoEm" | "atualizadoEm"> {
  return {
    id: produto.id.valor,
    sku: produto.sku,
    descricao: produto.descricao,
    descricaoPdv: produto.descricaoPdv,
    descricaoBusca: produto.descricaoBusca,
    tipo: produto.tipo,
    unidadeBase: produto.unidadeBase.codigo,
    precoVenda: produto.precoVenda.centavos,
    custo: produto.custo.centavos,
    codigoBarras: ouNulo(produto.codigoBarras?.valor),
    codigoBalanca: ouNulo(produto.codigoBalanca),
    categoriaId: ouNulo(produto.categoriaId?.valor),
    perfilTributarioId: ouNulo(produto.perfilTributarioId?.valor),
    ativo: produto.ativo,
  };
}
