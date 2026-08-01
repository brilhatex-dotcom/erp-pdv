import type { FiltroBusca, ProdutoRepository } from "@erp/application";
import type { Identificador, Produto } from "@erp/domain";
import { normalizarParaBusca } from "@erp/utils";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import { paraDominio, paraLinha } from "../mapeadores/produtoMapeador.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

const INCLUIR = { referencias: true, embalagens: true } as const;

/**
 * Repositório de produtos sobre PostgreSQL.
 *
 * `porCodigo` é a consulta do caminho quente do PDV — cada bipada passa por
 * ela, com meta de 100 ms sobre 50 mil SKUs (RNF-02). Por isso ela busca por
 * **igualdade** em colunas indexadas, e não por `LIKE`: código de barras, SKU
 * e referência normalizada. Busca por texto é outro fluxo, com outra tela.
 */
export class ProdutoRepositorioPrisma implements ProdutoRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Produto | undefined> {
    const linha = await this.prisma.produto.findUnique({
      where: { id: id.valor },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  async porCodigo(codigo: string): Promise<Produto | undefined> {
    const limpo = codigo.trim();
    if (limpo === "") return undefined;

    const normalizado = normalizarParaBusca(limpo).replace(/[\s\-./]/g, "");

    const linha = await this.prisma.produto.findFirst({
      where: {
        OR: [
          { codigoBarras: limpo },
          { sku: limpo },
          { sku: limpo.toUpperCase() },
          { referencias: { some: { normalizado } } },
        ],
      },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  async porSku(sku: string): Promise<Produto | undefined> {
    const linha = await this.prisma.produto.findUnique({
      where: { sku: sku.trim() },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  async porCodigoBarras(codigo: string): Promise<Produto | undefined> {
    const linha = await this.prisma.produto.findUnique({
      where: { codigoBarras: codigo.trim() },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  /**
   * Busca por texto para a lista da retaguarda.
   *
   * Usa `contains` sobre `descricaoBusca`, que é varredura — o índice B-tree só
   * serviria a busca por prefixo, e quem procura "coca" dentro de
   * "REFRIGERANTE COCA COLA" precisa de contenção. A escolha é deliberada: esta
   * **não** é a consulta do balcão (aquela é `porCodigo`, por igualdade), o
   * resultado é limitado a algumas dezenas de linhas, e a alternativa —
   * índice GIN com `pg_trgm` — acrescentaria uma extensão do PostgreSQL à
   * responsabilidade do instalador em troca de milissegundos numa tela onde
   * ninguém está com fila esperando.
   *
   * **Gatilho de revisão:** acima de ~50 mil produtos, ou busca passando de
   * 300 ms, vale medir e considerar o `pg_trgm`.
   */
  async buscar(filtro: FiltroBusca): Promise<readonly Produto[]> {
    const termo = (filtro.termo ?? "").trim();
    const normalizado = normalizarParaBusca(termo).replace(/[\s\-./]/g, "");

    const linhas = await this.prisma.produto.findMany({
      where: {
        ...(filtro.apenasAtivos === true ? { ativo: true } : {}),
        ...(termo === ""
          ? {}
          : {
              OR: [
                { descricaoBusca: { contains: normalizarParaBusca(termo) } },
                { sku: termo },
                { sku: termo.toUpperCase() },
                { codigoBarras: termo },
                { referencias: { some: { normalizado } } },
              ],
            }),
      },
      include: INCLUIR,
      orderBy: { descricao: "asc" },
      take: filtro.limite,
    });

    return linhas.map(paraDominio);
  }

  async porCodigoBalanca(codigo: string): Promise<Produto | undefined> {
    const linha = await this.prisma.produto.findUnique({
      where: { codigoBalanca: codigo },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  /**
   * Grava o produto e seus filhos.
   *
   * Referências e embalagens são regravadas por completo. É o caminho simples
   * e correto para coleções pequenas — um produto tem unidades de referências,
   * não milhares — e evita a lógica de diferença, que é onde esse tipo de
   * código costuma errar.
   *
   * As tabelas filhas têm **chave natural** (`produto + tipo + normalizado`,
   * `produto + unidade`): não existe identidade fora do produto, e inventar um
   * UUID para elas só criaria o problema de mantê-lo estável entre regravações.
   */
  async salvar(produto: Produto): Promise<void> {
    const linha = paraLinha(produto);

    await this.prisma.produto.upsert({
      where: { id: linha.id },
      create: linha,
      update: linha,
    });

    await this.prisma.referenciaProduto.deleteMany({
      where: { produtoId: linha.id },
    });

    if (produto.referencias.length > 0) {
      await this.prisma.referenciaProduto.createMany({
        data: produto.referencias.map((referencia) => ({
          produtoId: linha.id,
          tipo: referencia.tipo,
          valor: referencia.valor,
          normalizado: referencia.normalizado,
        })),
      });
    }

    await this.prisma.embalagem.deleteMany({ where: { produtoId: linha.id } });

    if (produto.embalagens.length > 0) {
      await this.prisma.embalagem.createMany({
        data: produto.embalagens.map((embalagem) => ({
          produtoId: linha.id,
          unidade: embalagem.unidade.codigo,
          fator: embalagem.fator,
          codigoBarras: embalagem.codigoBarras?.valor ?? null,
        })),
      });
    }
  }
}
