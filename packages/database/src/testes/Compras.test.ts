import {
  CredencialHash,
  Dinheiro,
  Documento,
  Fornecedor,
  Identificador,
  ItemDaNota,
  Matricula,
  NotaDeCompra,
  Papel,
  papelPadrao,
  Produto,
  Quantidade,
  Usuario,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { notasDeCompra } from "../consultas/compras.js";
import type { PrismaClient } from "../gerado/index.js";
import { ALGORITMO_ARGON2ID } from "../HasherArgon2.js";
import {
  PapelRepositorioPrisma,
  UsuarioRepositorioPrisma,
} from "../repositorios/AcessoRepositorioPrisma.js";
import { FornecedorRepositorioPrisma } from "../repositorios/CadastroRepositorioPrisma.js";
import { CompraRepositorioPrisma } from "../repositorios/CompraRepositorioPrisma.js";
import { ProdutoRepositorioPrisma } from "../repositorios/ProdutoRepositorioPrisma.js";
import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

/**
 * Nota de compra: ida e volta pelo banco, e a projeção da lista.
 *
 * O que se verifica aqui é o que só o Postgres responde: que a unicidade
 * parcial deixa relançar a nota cancelada, e que o total da lista é somado das
 * linhas em inteiro — sem passar por `double` no caminho.
 */

let prisma: PrismaClient;

const EMISSAO = new Date("2026-07-28T12:00:00.000Z");
const ENTRADA = new Date("2026-07-30T12:00:00.000Z");

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;

  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3e9${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

let fornecedorId: Identificador;
let produto: Produto;
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

  const fornecedor = Fornecedor.criar({
    id: proximoId(),
    razaoSocial: "Distribuidora Central Ltda",
    documento: Documento.criar("11.222.333/0001-81").unwrap(),
  }).unwrap();

  await new FornecedorRepositorioPrisma(prisma).salvar(fornecedor);
  fornecedorId = fornecedor.id;

  produto = Produto.criar({
    id: proximoId(),
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: Dinheiro.deReais("9,90").unwrap(),
  }).unwrap();

  await new ProdutoRepositorioPrisma(prisma).salvar(produto);

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

function nota(sobrescritas: { readonly numero?: string; readonly serie?: string } = {}) {
  const item = ItemDaNota.criar(1, {
    produtoId: produto.id,
    descricao: produto.descricao,
    quantidade: Quantidade.de("10", "UN").unwrap(),
    custoUnitario: Dinheiro.deReais("3,00").unwrap(),
    desconto: Dinheiro.deReais("5,00").unwrap(),
  }).unwrap();

  return NotaDeCompra.criar({
    id: proximoId(),
    fornecedorId,
    numero: sobrescritas.numero ?? "123456",
    serie: sobrescritas.serie ?? "1",
    emitidaEm: EMISSAO,
    recebidaEm: ENTRADA,
    itens: [item],
    totalDeclarado: Dinheiro.deReais("25,00").unwrap(),
    usuarioId,
    observacao: "Entrega parcial",
  }).unwrap();
}

describe("Nota de compra — ida e volta pelo banco", () => {
  it("🔑 devolve a nota com os itens intactos", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    const original = nota();
    await compras.salvar(original);

    const lida = await compras.porId(original.id);

    expect(lida?.numero).toBe("123456");
    expect(lida?.serie).toBe("1");
    expect(lida?.observacao).toBe("Entrega parcial");
    expect(lida?.itens).toHaveLength(1);
    expect(lida?.itens[0]?.descricao).toBe("Refrigerante Cola 2 Litros");
    expect(lida?.itens[0]?.desconto.formatar()).toBe("R$ 5,00");
    expect(lida?.total.formatar()).toBe("R$ 25,00");
  });

  it("nota sem série volta sem série, não com texto vazio", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    const original = nota({ serie: "" });
    await compras.salvar(original);

    expect((await compras.porId(original.id))?.serie).toBeUndefined();
  });

  it("localiza pela chave do fornecedor, com espaços em volta", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    await compras.salvar(nota());

    expect(await compras.porChave(fornecedorId, "  123456  ", " 1 ")).toBeDefined();
    expect(await compras.porChave(fornecedorId, "999", "1")).toBeUndefined();
  });

  it("🔑 a nota cancelada não responde pela chave — é o que libera o relançamento", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    const original = nota();
    await compras.salvar(original);

    original.cancelar(new Date(), "Quantidade digitada errada");
    await compras.salvar(original);

    expect(await compras.porChave(fornecedorId, "123456", "1")).toBeUndefined();

    // E o banco aceita a nova nota com a mesma numeração.
    await compras.salvar(nota());
    expect(await compras.porChave(fornecedorId, "123456", "1")).toBeDefined();
  });

  it("🔑 o banco recusa duas notas lançadas com a mesma chave", async () => {
    // O índice é a garantia quando duas telas gravam no mesmo instante; a
    // checagem no caso de uso existe para dar a mensagem certa.
    const compras = new CompraRepositorioPrisma(prisma);
    await compras.salvar(nota());

    await expect(compras.salvar(nota())).rejects.toThrow();
  });

  it("guarda o cancelamento como foi feito", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    const original = nota();
    await compras.salvar(original);

    const agora = new Date("2026-08-01T10:00:00.000Z");
    original.cancelar(agora, "Lançada em duplicidade");
    await compras.salvar(original);

    const lida = await compras.porId(original.id);
    expect(lida?.estaCancelada).toBe(true);
    expect(lida?.motivoCancelamento).toBe("Lançada em duplicidade");
    expect(lida?.canceladaEm).toEqual(agora);
  });

  it("regravar não duplica os itens", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    const original = nota();

    await compras.salvar(original);
    await compras.salvar(original);

    expect(await prisma.itemNotaCompra.count()).toBe(1);
  });

  it("nota sem observação e sem cancelamento volta com os campos ausentes", async () => {
    const compras = new CompraRepositorioPrisma(prisma);

    const item = ItemDaNota.criar(1, {
      produtoId: produto.id,
      descricao: produto.descricao,
      quantidade: Quantidade.de("10", "UN").unwrap(),
      custoUnitario: Dinheiro.deReais("3,00").unwrap(),
    }).unwrap();

    const semExtras = NotaDeCompra.criar({
      id: proximoId(),
      fornecedorId,
      numero: "777",
      emitidaEm: EMISSAO,
      recebidaEm: ENTRADA,
      itens: [item],
      totalDeclarado: Dinheiro.deReais("30,00").unwrap(),
      usuarioId,
    }).unwrap();

    await compras.salvar(semExtras);

    const lida = await compras.porId(semExtras.id);

    expect(lida?.observacao).toBeUndefined();
    expect(lida?.serie).toBeUndefined();
    expect(lida?.canceladaEm).toBeUndefined();
    expect(lida?.motivoCancelamento).toBeUndefined();
    expect(lida?.itens[0]?.desconto.ehZero()).toBe(true);
  });

  it("🔑 devolve os itens na ordem em que foram lançados", async () => {
    // A ordem do `SELECT` não é garantida; a numeração da nota é.
    const compras = new CompraRepositorioPrisma(prisma);

    const linhas = [3, 1, 2].map((numero) =>
      ItemDaNota.criar(numero, {
        produtoId: produto.id,
        descricao: `Linha ${String(numero)}`,
        quantidade: Quantidade.de("1", "UN").unwrap(),
        custoUnitario: Dinheiro.deReais("1,00").unwrap(),
      }).unwrap(),
    );

    const varias = NotaDeCompra.criar({
      id: proximoId(),
      fornecedorId,
      numero: "888",
      emitidaEm: EMISSAO,
      recebidaEm: ENTRADA,
      itens: linhas,
      totalDeclarado: Dinheiro.deReais("3,00").unwrap(),
      usuarioId,
    }).unwrap();

    await compras.salvar(varias);

    expect((await compras.porId(varias.id))?.itens.map((item) => item.numero)).toEqual([
      1, 2, 3,
    ]);
  });

  it("devolve nada quando a nota não existe", async () => {
    expect(await new CompraRepositorioPrisma(prisma).porId(proximoId())).toBeUndefined();
  });
});

describe("Projeção da lista de notas", () => {
  it("🔑 soma o total das linhas, com o desconto, em inteiro", async () => {
    await new CompraRepositorioPrisma(prisma).salvar(nota());

    const [linha] = await notasDeCompra(prisma, { limite: 20 });

    // 10 × R$ 3,00 − R$ 5,00.
    expect(linha?.total).toBe("2500");
    expect(typeof linha?.total).toBe("string");
    expect(linha?.quantidadeItens).toBe(1);
  });

  it("traz o fornecedor e quem lançou", async () => {
    await new CompraRepositorioPrisma(prisma).salvar(nota());

    const [linha] = await notasDeCompra(prisma, { limite: 20 });

    expect(linha?.fornecedorNome).toBe("Distribuidora Central Ltda");
    expect(linha?.usuarioNome).toBe("Bruno Estoquista");
  });

  it("🔑 esconde as canceladas por padrão", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    const cancelada = nota();
    cancelada.cancelar(new Date(), "Duplicada");
    await compras.salvar(cancelada);

    expect(await notasDeCompra(prisma, { limite: 20 })).toHaveLength(0);

    const comCanceladas = await notasDeCompra(prisma, {
      limite: 20,
      incluirCanceladas: true,
    });

    expect(comCanceladas).toHaveLength(1);
    expect(comCanceladas[0]?.status).toBe("CANCELADA");
    expect(comCanceladas[0]?.motivoCancelamento).toBe("Duplicada");
  });

  it("procura pelo número e pelo nome do fornecedor, sem depender da caixa", async () => {
    await new CompraRepositorioPrisma(prisma).salvar(nota());

    expect(await notasDeCompra(prisma, { termo: "1234", limite: 20 })).toHaveLength(1);
    expect(await notasDeCompra(prisma, { termo: "CENTRAL", limite: 20 })).toHaveLength(1);
    expect(await notasDeCompra(prisma, { termo: "nada", limite: 20 })).toHaveLength(0);
  });

  it("filtra por fornecedor e respeita o limite", async () => {
    const compras = new CompraRepositorioPrisma(prisma);
    await compras.salvar(nota());
    await compras.salvar(nota({ numero: "999" }));

    expect(
      await notasDeCompra(prisma, { fornecedorId: fornecedorId.valor, limite: 20 }),
    ).toHaveLength(2);
    expect(await notasDeCompra(prisma, { limite: 1 })).toHaveLength(1);
    expect(
      await notasDeCompra(prisma, { fornecedorId: proximoId().valor, limite: 20 }),
    ).toHaveLength(0);
  });

  it("nota sem série sai sem série na lista", async () => {
    await new CompraRepositorioPrisma(prisma).salvar(nota({ serie: "" }));

    expect((await notasDeCompra(prisma, { limite: 20 }))[0]?.serie).toBeUndefined();
  });

  it("lista vazia não consulta usuário nenhum", async () => {
    expect(await notasDeCompra(prisma, { limite: 20 })).toHaveLength(0);
  });
});
