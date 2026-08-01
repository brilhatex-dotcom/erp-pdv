import {
  CredencialHash,
  Dinheiro,
  Embalagem,
  Identificador,
  Matricula,
  MovimentoEstoque,
  Papel,
  papelPadrao,
  Produto,
  Quantidade,
  type TipoMovimento,
  Usuario,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { extratoDeEstoque, saldosDeEstoque } from "../consultas/estoque.js";
import { ALGORITMO_ARGON2ID } from "../HasherArgon2.js";
import type { PrismaClient } from "../gerado/index.js";
import {
  PapelRepositorioPrisma,
  UsuarioRepositorioPrisma,
} from "../repositorios/AcessoRepositorioPrisma.js";
import { EstoqueRepositorioPrisma } from "../repositorios/EstoqueRepositorioPrisma.js";
import { ProdutoRepositorioPrisma } from "../repositorios/ProdutoRepositorioPrisma.js";
import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

/**
 * As projeções de estoque.
 *
 * São consultas de leitura pura, e é por isso que precisam do Postgres de
 * verdade: o que se verifica é o `select` — que ele traga o produto **sem
 * movimento algum**, que a situação filtre pela ausência de linha de saldo, e
 * que o custo não escape para quem não pode vê-lo.
 */

let prisma: PrismaClient;

const AGORA = new Date("2026-08-01T12:00:00.000Z");

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;

  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3e8${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

let refrigerante: Produto;
let pao: Produto;
let usuarioId: Identificador;

beforeAll(() => {
  prepararBanco();
  prisma = criarClienteDeTeste();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);

  const produtos = new ProdutoRepositorioPrisma(prisma);

  refrigerante = Produto.criar({
    id: proximoId(),
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: Dinheiro.deReais("9,90").unwrap(),
    embalagens: [Embalagem.criar("FD", 12n).unwrap()],
  }).unwrap();

  pao = Produto.criar({
    id: proximoId(),
    sku: "PAO001",
    descricao: "Pão Francês",
    tipo: "PESAVEL",
    unidadeBase: "KG",
    precoVenda: Dinheiro.deReais("18,90").unwrap(),
  }).unwrap();

  await produtos.salvar(refrigerante);
  await produtos.salvar(pao);

  const papel = Papel.criar(papelPadrao("ESTOQUISTA", proximoId())).unwrap();
  await new PapelRepositorioPrisma(prisma).salvar(papel);

  const usuario = Usuario.criar({
    id: proximoId(),
    matricula: Matricula.criar("2").unwrap(),
    nome: "Bruno Estoquista",
    papel,
    hashPin: CredencialHash.criar(
      "$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA",
      ALGORITMO_ARGON2ID,
    ).unwrap(),
    precisaTrocarCredencial: false,
  }).unwrap();

  await new UsuarioRepositorioPrisma(prisma).salvar(usuario);
  usuarioId = usuario.id;
});

async function mover(
  produto: Produto,
  tipo: TipoMovimento,
  quantidade: string,
  extras: { readonly custo?: string; readonly observacao?: string } = {},
): Promise<void> {
  const movimento = MovimentoEstoque.criar({
    id: proximoId(),
    produtoId: produto.id,
    tipo,
    quantidade: Quantidade.de(quantidade, produto.unidadeBase.codigo).unwrap(),
    origem: { tipo: "MANUAL" },
    usuarioId,
    ocorridoEm: AGORA,
    ...(extras.custo === undefined
      ? {}
      : { custoUnitario: Dinheiro.deReais(extras.custo).unwrap() }),
    ...(extras.observacao === undefined ? {} : { observacao: extras.observacao }),
  }).unwrap();

  await new EstoqueRepositorioPrisma(prisma).registrar(movimento);
}

describe("Saldos de estoque", () => {
  it("🔑 produto sem movimento algum aparece zerado", async () => {
    // A consulta parte de `produtos`, não de `saldos_estoque`. Listar só quem
    // tem linha de saldo esconderia exatamente o item que ninguém deu entrada.
    const itens = await saldosDeEstoque(prisma, { limite: 20, comCusto: true });

    expect(itens).toHaveLength(2);
    expect(itens.every((item) => item.milesimos === "0")).toBe(true);
  });

  it("devolve o saldo e o valor imobilizado", async () => {
    await mover(refrigerante, "ENTRADA", "10", { custo: "3,00" });

    const [item] = await saldosDeEstoque(prisma, {
      termo: "refrigerante",
      limite: 20,
      comCusto: true,
    });

    expect(item?.milesimos).toBe("10000");
    expect(item?.custoMedio).toBe("300");
    // 10 unidades a R$ 3,00.
    expect(item?.valorEmEstoque).toBe("3000");
  });

  it("🔑 sem permissão, custo e valor nem entram na resposta", async () => {
    await mover(refrigerante, "ENTRADA", "10", { custo: "3,00" });

    const [item] = await saldosDeEstoque(prisma, { limite: 20, comCusto: false });

    expect(item).not.toHaveProperty("custoMedio");
    expect(item).not.toHaveProperty("valorEmEstoque");
    // Nem escondido em outro campo: a margem da loja não sai por aqui.
    expect(JSON.stringify(item)).not.toContain("300");
  });

  it("ordena por descrição, que é como o lojista procura", async () => {
    const itens = await saldosDeEstoque(prisma, { limite: 20, comCusto: false });

    expect(itens.map((item) => item.sku)).toEqual(["PAO001", "REF001"]);
  });

  it.each([
    ["pao", "PAO001"],
    ["PÃO", "PAO001"],
    ["cola", "REF001"],
    ["REF001", "REF001"],
  ])("encontra %p sem acento e sem caixa", async (termo, sku) => {
    const itens = await saldosDeEstoque(prisma, { termo, limite: 20, comCusto: false });

    expect(itens.map((item) => item.sku)).toEqual([sku]);
  });

  it("termo sem resultado devolve lista vazia", async () => {
    const itens = await saldosDeEstoque(prisma, {
      termo: "inexistente",
      limite: 20,
      comCusto: false,
    });

    expect(itens).toHaveLength(0);
  });

  it("🔑 zerado conta o produto que nunca se moveu", async () => {
    // Ignorar a ausência de linha faria a tela dizer que a loja tem tudo em
    // estoque no dia seguinte à instalação.
    await mover(refrigerante, "ENTRADA", "10");

    const zerados = await saldosDeEstoque(prisma, {
      situacao: "ZERADO",
      limite: 20,
      comCusto: false,
    });

    expect(zerados.map((item) => item.sku)).toEqual(["PAO001"]);
  });

  it("filtra com saldo e negativo", async () => {
    await mover(refrigerante, "ENTRADA", "10");
    await mover(pao, "AJUSTE_NEGATIVO", "3", { observacao: "Contagem" });

    const comSaldo = await saldosDeEstoque(prisma, {
      situacao: "COM_SALDO",
      limite: 20,
      comCusto: false,
    });
    const negativos = await saldosDeEstoque(prisma, {
      situacao: "NEGATIVO",
      limite: 20,
      comCusto: false,
    });

    expect(comSaldo.map((item) => item.sku)).toEqual(["REF001"]);
    expect(negativos.map((item) => item.sku)).toEqual(["PAO001"]);
    expect(negativos[0]?.milesimos).toBe("-3000");
  });

  it("situação TODOS não filtra nada", async () => {
    const itens = await saldosDeEstoque(prisma, {
      situacao: "TODOS",
      limite: 20,
      comCusto: false,
    });

    expect(itens).toHaveLength(2);
  });

  it("esconde inativos quando pedido, e respeita o limite", async () => {
    pao.desativar(AGORA);
    await new ProdutoRepositorioPrisma(prisma).salvar(pao);

    const ativos = await saldosDeEstoque(prisma, {
      apenasAtivos: true,
      limite: 20,
      comCusto: false,
    });

    expect(ativos.map((item) => item.sku)).toEqual(["REF001"]);
    expect(await saldosDeEstoque(prisma, { limite: 1, comCusto: false })).toHaveLength(1);
  });
});

describe("Extrato de estoque", () => {
  it("🔑 responde por que o saldo está assim, do mais recente ao mais antigo", async () => {
    await mover(refrigerante, "ENTRADA", "10", { custo: "3,00" });
    await mover(refrigerante, "PERDA", "2", { observacao: "Garrafas quebradas" });

    const itens = await extratoDeEstoque(prisma, refrigerante.id.valor, {
      limite: 20,
      comCusto: true,
    });

    expect(itens.map((item) => item.tipo)).toEqual(["PERDA", "ENTRADA"]);
    expect(itens[0]?.efeito).toBe(-1);
    expect(itens[1]?.efeito).toBe(1);
    expect(itens[0]?.observacao).toBe("Garrafas quebradas");
    expect(itens[1]?.custoUnitario).toBe("300");
  });

  it("🔑 movimentos do mesmo instante saem sempre na mesma ordem", async () => {
    // Uma nota de entrada com vários itens grava todos na mesma transação, com
    // o mesmo `ocorrido_em`. Ordenar só por instante deixa a sequência a cargo
    // do plano de execução — e a lista muda de ordem entre duas atualizações da
    // tela, com quem confere o estoque desconfiando do sistema, com razão.
    await mover(refrigerante, "ENTRADA", "10");
    await mover(refrigerante, "AJUSTE_POSITIVO", "1", { observacao: "Contagem" });
    await mover(refrigerante, "PERDA", "2", { observacao: "Garrafas quebradas" });

    const primeira = await extratoDeEstoque(prisma, refrigerante.id.valor, {
      limite: 20,
      comCusto: false,
    });
    const segunda = await extratoDeEstoque(prisma, refrigerante.id.valor, {
      limite: 20,
      comCusto: false,
    });

    // O id é UUIDv7 (ADR-0008): desempata na ordem em que foram criados.
    expect(primeira.map((item) => item.tipo)).toEqual([
      "PERDA",
      "AJUSTE_POSITIVO",
      "ENTRADA",
    ]);
    expect(segunda.map((item) => item.id)).toEqual(primeira.map((item) => item.id));
  });

  it("mostra quem lançou, para a conferência ter a quem perguntar", async () => {
    await mover(refrigerante, "ENTRADA", "10");

    const [item] = await extratoDeEstoque(prisma, refrigerante.id.valor, {
      limite: 20,
      comCusto: false,
    });

    expect(item?.usuarioNome).toBe("Bruno Estoquista");
  });

  it("🔑 sem permissão, o custo do movimento não sai", async () => {
    await mover(refrigerante, "ENTRADA", "10", { custo: "3,00" });

    const [item] = await extratoDeEstoque(prisma, refrigerante.id.valor, {
      limite: 20,
      comCusto: false,
    });

    expect(item).not.toHaveProperty("custoUnitario");
  });

  it("movimento sem custo não inventa o campo", async () => {
    await mover(refrigerante, "ENTRADA", "10");

    const [item] = await extratoDeEstoque(prisma, refrigerante.id.valor, {
      limite: 20,
      comCusto: true,
    });

    expect(item).not.toHaveProperty("custoUnitario");
  });

  it("produto sem movimento devolve lista vazia, sem consultar usuário nenhum", async () => {
    const itens = await extratoDeEstoque(prisma, pao.id.valor, {
      limite: 20,
      comCusto: true,
    });

    expect(itens).toHaveLength(0);
  });

  it("respeita o limite", async () => {
    await mover(refrigerante, "ENTRADA", "10");
    await mover(refrigerante, "ENTRADA", "5");

    const itens = await extratoDeEstoque(prisma, refrigerante.id.valor, {
      limite: 1,
      comCusto: false,
    });

    expect(itens).toHaveLength(1);
  });
});
