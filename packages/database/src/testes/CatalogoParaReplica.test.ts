import {
  CodigoBarras,
  Dinheiro,
  Identificador,
  Produto,
  type TipoProduto,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogoParaReplica } from "../consultas/catalogoParaReplica.js";
import type { PrismaClient } from "../gerado/index.js";
import { ProdutoRepositorioPrisma } from "../repositorios/ProdutoRepositorioPrisma.js";
import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

/**
 * A projeção que vira o catálogo no disco da estação.
 *
 * É consulta de leitura pura, e é justamente por isso que precisa de teste
 * contra o Postgres de verdade: o que se verifica aqui é o `select` — que ele
 * traga o que a bipada precisa e **não traga** o que não deve sair da loja.
 */

let prisma: PrismaClient;

const AGORA = new Date("2026-08-01T12:00:00.000Z");

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;

  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3e7${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

beforeAll(() => {
  prepararBanco();
  prisma = criarClienteDeTeste();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
});

async function cadastrar(dados: {
  readonly sku: string;
  readonly descricaoPdv: string;
  readonly preco: string;
  readonly custo?: string;
  readonly codigoBarras?: string;
  readonly tipo?: TipoProduto;
  readonly ativo?: boolean;
}): Promise<void> {
  const produto = Produto.criar({
    id: proximoId(),
    sku: dados.sku,
    descricao: `${dados.descricaoPdv} — descrição longa`,
    descricaoPdv: dados.descricaoPdv,
    tipo: dados.tipo ?? "UNITARIO",
    unidadeBase: "UN",
    precoVenda: Dinheiro.deReais(dados.preco).unwrap(),
    custo: Dinheiro.deReais(dados.custo ?? "0,00").unwrap(),
    ...(dados.codigoBarras === undefined
      ? {}
      : { codigoBarras: CodigoBarras.criar(dados.codigoBarras).unwrap() }),
  }).unwrap();

  if (dados.ativo === false) produto.desativar(AGORA);

  await new ProdutoRepositorioPrisma(prisma).salvar(produto);
}

describe("catalogoParaReplica", () => {
  it("devolve o que a bipada precisa", async () => {
    await cadastrar({
      sku: "REF001",
      descricaoPdv: "REFRI COLA 2L",
      preco: "9,90",
      codigoBarras: "7891000315507",
    });

    const catalogo = await catalogoParaReplica(prisma, AGORA);

    expect(catalogo.atualizadoEm).toBe("2026-08-01T12:00:00.000Z");
    expect(catalogo.produtos).toEqual([
      {
        id: expect.any(String) as string,
        sku: "REF001",
        descricao: "REFRI COLA 2L — descrição longa",
        descricaoPdv: "REFRI COLA 2L",
        unidade: "UN",
        precoVenda: "990",
        codigoBarras: "7891000315507",
        codigoBalanca: undefined,
        ativo: true,
      },
    ]);
  });

  it("🔑 o custo nunca sai da loja", async () => {
    // O arquivo vai para o disco de uma máquina de balcão. Margem replicada em
    // toda estação é margem exposta a quem abrir o arquivo.
    await cadastrar({
      sku: "REF001",
      descricaoPdv: "REFRI COLA 2L",
      preco: "9,90",
      custo: "6,50",
    });

    const catalogo = await catalogoParaReplica(prisma, AGORA);

    expect(JSON.stringify(catalogo)).not.toContain("650");
    expect(catalogo.produtos[0]).not.toHaveProperty("custo");
  });

  it("🔑 dinheiro sai como texto", async () => {
    // `bigint` não sobrevive a `JSON.stringify`, e número vira `double` no
    // `JSON.parse` do outro lado — o centavo some no fechamento (ADR-0019).
    await cadastrar({ sku: "REF001", descricaoPdv: "REFRI", preco: "1234,56" });

    const catalogo = await catalogoParaReplica(prisma, AGORA);

    expect(catalogo.produtos[0]?.precoVenda).toBe("123456");
  });

  it("não manda produto inativo", async () => {
    await cadastrar({ sku: "ATIVO", descricaoPdv: "ATIVO", preco: "1,00" });
    await cadastrar({
      sku: "MORTO",
      descricaoPdv: "MORTO",
      preco: "1,00",
      ativo: false,
    });

    const catalogo = await catalogoParaReplica(prisma, AGORA);

    expect(catalogo.produtos.map((produto) => produto.sku)).toEqual(["ATIVO"]);
  });

  it("ordem estável entre baixadas", async () => {
    // Sem ordem, duas baixadas do mesmo catálogo produzem arquivos diferentes
    // byte a byte — e nada em cima consegue comparar versões.
    await cadastrar({ sku: "ZZZ", descricaoPdv: "Z", preco: "1,00" });
    await cadastrar({ sku: "AAA", descricaoPdv: "A", preco: "1,00" });
    await cadastrar({ sku: "MMM", descricaoPdv: "M", preco: "1,00" });

    const catalogo = await catalogoParaReplica(prisma, AGORA);

    expect(catalogo.produtos.map((produto) => produto.sku)).toEqual([
      "AAA",
      "MMM",
      "ZZZ",
    ]);
  });

  it("catálogo vazio não é erro", async () => {
    const catalogo = await catalogoParaReplica(prisma, AGORA);

    expect(catalogo.produtos).toEqual([]);
  });
});
