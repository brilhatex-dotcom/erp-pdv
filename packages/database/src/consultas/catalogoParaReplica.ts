import type { PrismaClient } from "../gerado/index.js";

/**
 * O catálogo como a estação precisa dele.
 *
 * ### Por que não é método de repositório
 *
 * `ProdutoRepository` devolve agregados. Remontar 50 mil `Produto` — cada um com
 * referências, embalagens e objetos de valor validados — para em seguida
 * serializá-los seria minutos de CPU e centenas de megabytes, para produzir um
 * JSON que não precisa de nenhuma regra de negócio. Isto aqui é projeção de
 * leitura: sai do banco no formato em que vai para o disco da estação.
 *
 * ### Só o que a bipada precisa
 *
 * Custo, categoria e perfil tributário ficam de fora. Não é economia de bytes:
 * é que o arquivo vai para o disco de uma máquina de balcão, e margem de lucro
 * replicada em toda estação é margem exposta a quem abrir o arquivo.
 *
 * ### Inativo não vem
 *
 * O índice da réplica já descarta produto inativo. Filtrar aqui também evita
 * mandar pela rede da loja um catálogo inteiro de itens que nunca serão
 * bipados — em loja com histórico longo, é a maior parte dele.
 */

export interface ProdutoParaReplica {
  readonly id: string;
  readonly sku: string;
  readonly descricao: string;
  readonly descricaoPdv: string;
  readonly unidade: string;
  /** Centavos em texto: `bigint` não sobrevive a `JSON.stringify` (ADR-0019). */
  readonly precoVenda: string;
  readonly codigoBarras?: string | undefined;
  readonly codigoBalanca?: string | undefined;
  readonly ativo: boolean;
}

export interface CatalogoParaReplica {
  readonly atualizadoEm: string;
  readonly produtos: readonly ProdutoParaReplica[];
}

export async function catalogoParaReplica(
  prisma: PrismaClient,
  agora: Date = new Date(),
): Promise<CatalogoParaReplica> {
  const linhas = await prisma.produto.findMany({
    where: { ativo: true },
    select: {
      id: true,
      sku: true,
      descricao: true,
      descricaoPdv: true,
      unidadeBase: true,
      precoVenda: true,
      codigoBarras: true,
      codigoBalanca: true,
    },
    // Ordem estável para a réplica ser comparável entre baixadas: sem ela, duas
    // baixadas do mesmo catálogo produzem arquivos diferentes byte a byte.
    orderBy: { sku: "asc" },
  });

  return {
    atualizadoEm: agora.toISOString(),
    produtos: linhas.map((linha) => ({
      id: linha.id,
      sku: linha.sku,
      descricao: linha.descricao,
      descricaoPdv: linha.descricaoPdv,
      unidade: linha.unidadeBase,
      precoVenda: linha.precoVenda.toString(),
      codigoBarras: linha.codigoBarras ?? undefined,
      codigoBalanca: linha.codigoBalanca ?? undefined,
      ativo: true,
    })),
  };
}
