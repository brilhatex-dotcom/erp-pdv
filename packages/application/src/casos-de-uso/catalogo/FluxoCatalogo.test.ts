import { Categoria, Identificador } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";

import { AlterarPrecoDoProduto } from "./AlterarPrecoDoProduto.js";
import { AlterarProduto, type EntradaAlterarProduto } from "./AlterarProduto.js";
import { CadastrarProduto, type EntradaCadastrarProduto } from "./CadastrarProduto.js";

const AUSENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999").unwrap();

function montar() {
  const ambiente = montarAmbiente();

  return {
    ...ambiente,
    cadastrar: new CadastrarProduto(ambiente.unitOfWork, ambiente.geradorId),
    alterar: new AlterarProduto(ambiente.unitOfWork, ambiente.relogio),
    alterarPreco: new AlterarPrecoDoProduto(ambiente.unitOfWork, ambiente.relogio),
  };
}

let cenario: ReturnType<typeof montar>;

beforeEach(() => {
  cenario = montar();
});

function entradaBase(
  sobrescritas: Partial<EntradaCadastrarProduto> = {},
): EntradaCadastrarProduto {
  return {
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: 990n,
    custo: 650n,
    ...sobrescritas,
  };
}

async function cadastrado(sobrescritas: Partial<EntradaCadastrarProduto> = {}) {
  const resultado = await cenario.cadastrar.executar(entradaBase(sobrescritas));

  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.mensagem}`);
  }

  return resultado.unwrap();
}

function alteracaoBase(
  id: Identificador,
  sobrescritas: Partial<EntradaAlterarProduto> = {},
): EntradaAlterarProduto {
  return {
    id,
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    precoVenda: 990n,
    ativo: true,
    podeAlterarPreco: true,
    ...sobrescritas,
  };
}

describe("Cadastro de produto", () => {
  it("cadastra o produto simples da mercearia", async () => {
    const produto = await cadastrado();

    expect(produto.sku).toBe("REF001");
    expect(produto.precoVenda.centavos).toBe(990n);
    expect(produto.custo.centavos).toBe(650n);
    expect(produto.ativo).toBe(true);
    // A descrição do cupom nasce da longa quando ninguém informa uma curta.
    expect(produto.descricaoPdv).toBe("Refrigerante Cola 2 Litros");
    expect(cenario.produtos.itens.size).toBe(1);
  });

  it("cadastra o produto de autopeças, com referências de fabricante", async () => {
    const produto = await cadastrado({
      sku: "VELA-F7",
      descricao: "Vela de Ignição",
      referencias: [
        { tipo: "ORIGINAL", valor: "90919-01210" },
        { tipo: "SIMILAR", valor: "F7TC" },
      ],
    });

    expect(produto.referencias).toHaveLength(2);
    // É o que o balconista digita quando o cliente traz o código num papel.
    expect(await cenario.produtos.porCodigo("f7 tc")).toBeDefined();
  });

  it("cadastra o produto do depósito, com embalagem de fardo", async () => {
    const produto = await cadastrado({
      embalagens: [{ unidade: "FD", fator: 12n }],
    });

    expect(produto.embalagens).toHaveLength(1);
    expect(produto.encontrarEmbalagem("FD")?.fator).toBe(12n);
  });

  it("cadastra o pesável do açougue, com código de balança", async () => {
    const produto = await cadastrado({
      sku: "PIC001",
      descricao: "Picanha Bovina",
      tipo: "PESAVEL",
      unidadeBase: "KG",
      codigoBalanca: "0421",
    });

    expect(produto.ehPesavel).toBe(true);
    expect(produto.codigoBalanca).toBe("0421");
  });

  it("custo ausente vira zero, e zero significa 'não informado'", async () => {
    const produto = await cadastrado({ custo: undefined });

    expect(produto.custo.ehZero()).toBe(true);
    // E por isso não acusa venda abaixo do custo.
    expect(produto.vendeAbaixoDoCusto()).toBe(false);
  });

  it("🔑 recusa SKU repetido dizendo de quem ele é", async () => {
    await cadastrado();

    const repetido = await cenario.cadastrar.executar(
      entradaBase({ descricao: "Outro produto" }),
    );

    expect(repetido.isErr()).toBe(true);
    if (repetido.isErr()) {
      expect(repetido.error.codigo).toBe("PRODUTO_SKU_EM_USO");
      // "Já existe" sem dizer onde faz o usuário procurar às cegas.
      expect(repetido.error.mensagem).toContain("Refrigerante Cola 2 Litros");
    }
    expect(cenario.produtos.itens.size).toBe(1);
  });

  it("🔑 recusa código de barras repetido — bipar traria o produto errado", async () => {
    await cadastrado({ codigoBarras: "7891000100103" });

    const repetido = await cenario.cadastrar.executar(
      entradaBase({ sku: "OUTRO", codigoBarras: "7891000100103" }),
    );

    expect(repetido.isErr()).toBe(true);
    if (repetido.isErr()) {
      expect(repetido.error.codigo).toBe("PRODUTO_CODIGO_BARRAS_EM_USO");
    }
  });

  it("recusa código de balança repetido", async () => {
    await cadastrado({ tipo: "PESAVEL", unidadeBase: "KG", codigoBalanca: "0421" });

    const repetido = await cenario.cadastrar.executar(
      entradaBase({
        sku: "OUTRO",
        tipo: "PESAVEL",
        unidadeBase: "KG",
        codigoBalanca: "0421",
      }),
    );

    expect(repetido.isErr()).toBe(true);
    if (repetido.isErr()) {
      expect(repetido.error.codigo).toBe("PRODUTO_CODIGO_BALANCA_EM_USO");
    }
  });

  it("🔑 recusa categoria que não existe, em vez de deixar o banco recusar", async () => {
    const resultado = await cenario.cadastrar.executar(
      entradaBase({ categoriaId: AUSENTE }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CATEGORIA_NAO_ENCONTRADA");
      // Mensagem para o operador, não erro de chave estrangeira.
      expect(resultado.error.mensagem).not.toContain("constraint");
    }
  });

  it("aceita a categoria que existe", async () => {
    const categoria = Categoria.criar({
      id: cenario.geradorId.proximo(),
      nome: "Bebidas",
    }).unwrap();
    await cenario.categorias.salvar(categoria);

    const produto = await cadastrado({ categoriaId: categoria.id });

    expect(produto.categoriaId?.equals(categoria.id)).toBe(true);
  });

  it("recusa código de barras com dígito verificador errado", async () => {
    const resultado = await cenario.cadastrar.executar(
      entradaBase({ codigoBarras: "7891000100104" }),
    );

    expect(resultado.isErr()).toBe(true);
    expect(cenario.produtos.itens.size).toBe(0);
  });

  it("recusa embalagem com fator 1 — é a própria unidade do produto", async () => {
    const resultado = await cenario.cadastrar.executar(
      entradaBase({ embalagens: [{ unidade: "CX", fator: 1n }] }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMBALAGEM_FATOR_UNITARIO");
    }
  });

  it("🔑 devolve os vários erros do formulário de uma vez", async () => {
    const resultado = await cenario.cadastrar.executar(
      entradaBase({
        codigoBarras: "7891000100104",
        referencias: [{ tipo: "SIMILAR", valor: "" }],
      }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      // Corrigir um campo por gravação é desperdício do tempo de quem cadastra
      // cem itens numa tarde.
      expect(resultado.error.codigo).toBe("DADOS_INVALIDOS");
      expect(resultado.error.detalhes?.["erros"]).toHaveLength(2);
    }
  });

  it("recusa pesável em unidade que não aceita fração", async () => {
    const resultado = await cenario.cadastrar.executar(
      entradaBase({ tipo: "PESAVEL", unidadeBase: "UN" }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_PESAVEL_UNIDADE_INVALIDA");
    }
  });

  it("recusa preço em valor que não é dinheiro válido", async () => {
    const resultado = await cenario.cadastrar.executar(
      entradaBase({ precoVenda: 10n ** 20n }),
    );

    expect(resultado.isErr()).toBe(true);
    expect(cenario.produtos.itens.size).toBe(0);
  });
});

describe("Alteração de produto", () => {
  it("corrige descrição e preço", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, {
        descricao: "Refrigerante Cola 2L Retornável",
        precoVenda: 1090n,
      }),
    );

    expect(alterado.isOk()).toBe(true);
    expect(alterado.unwrap().descricao).toBe("Refrigerante Cola 2L Retornável");
    expect(alterado.unwrap().precoVenda.centavos).toBe(1090n);
  });

  it("corrige o SKU digitado errado no cadastro", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { sku: "REF002" }),
    );

    expect(alterado.unwrap().sku).toBe("REF002");
  });

  it("🔑 não acusa conflito do produto consigo mesmo", async () => {
    const produto = await cadastrado({ codigoBarras: "7891000100103" });

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, {
        descricao: "Só a descrição muda",
        codigoBarras: "7891000100103",
      }),
    );

    expect(alterado.isOk()).toBe(true);
  });

  it("recusa assumir o SKU de outro produto", async () => {
    const primeiro = await cadastrado();
    await cadastrado({ sku: "REF002", descricao: "Outro" });

    const alterado = await cenario.alterar.executar(
      alteracaoBase(primeiro.id, { sku: "REF002" }),
    );

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("PRODUTO_SKU_EM_USO");
    }
  });

  it("🔑 preserva o custo quando ele não vem no formulário", async () => {
    const produto = await cadastrado({ custo: 650n });

    // É o formulário de quem não tem `produto:ver_custo`: o campo nem é
    // enviado. Sem esta regra, a margem de todo relatório iria a zero.
    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { custo: undefined }),
    );

    expect(alterado.unwrap().custo.centavos).toBe(650n);
  });

  it("altera o custo quando ele vem no formulário", async () => {
    const produto = await cadastrado({ custo: 650n });

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { custo: 700n }),
    );

    expect(alterado.unwrap().custo.centavos).toBe(700n);
  });

  it("🔑 recusa mudança de preço de quem não pode alterar preço", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { precoVenda: 1090n, podeAlterarPreco: false }),
    );

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("SEM_PERMISSAO_PARA_PRECO");
      expect(alterado.error.tipo).toBe("NAO_AUTORIZADO");
    }
    expect(cenario.produtos.itens.get(produto.id.valor)?.precoVenda.centavos).toBe(990n);
  });

  it("🔑 deixa o estoquista corrigir a descrição sem mexer no preço", async () => {
    const produto = await cadastrado();

    // O formulário devolve o mesmo preço que carregou. Bloquear aqui impediria
    // quem só pode editar cadastro de editar cadastro.
    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, {
        descricao: "Refrigerante Cola 2L Garrafa",
        podeAlterarPreco: false,
      }),
    );

    expect(alterado.isOk()).toBe(true);
    expect(alterado.unwrap().descricao).toBe("Refrigerante Cola 2L Garrafa");
  });

  it("troca a lista inteira de referências", async () => {
    const produto = await cadastrado({
      referencias: [{ tipo: "ORIGINAL", valor: "90919-01210" }],
    });

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { referencias: [{ tipo: "SIMILAR", valor: "F7TC" }] }),
    );

    expect(alterado.unwrap().referencias.map((r) => r.valor)).toEqual(["F7TC"]);
  });

  it("troca a lista inteira de embalagens", async () => {
    const produto = await cadastrado({ embalagens: [{ unidade: "FD", fator: 12n }] });

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { embalagens: [{ unidade: "CX", fator: 24n }] }),
    );

    expect(alterado.unwrap().embalagens.map((e) => e.unidade.codigo)).toEqual(["CX"]);
  });

  it("recusa referência repetida no formulário", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, {
        referencias: [
          { tipo: "SIMILAR", valor: "F7TC" },
          { tipo: "SIMILAR", valor: "f7-tc" },
        ],
      }),
    );

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("PRODUTO_REFERENCIA_DUPLICADA");
    }
  });

  it("recusa código de balança em produto que não é pesável", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { codigoBalanca: "0421" }),
    );

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("PRODUTO_CODIGO_BALANCA_SEM_PESAGEM");
    }
  });

  it("recusa descrição vazia", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { descricao: "   " }),
    );

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("PRODUTO_DESCRICAO_VAZIA");
    }
  });

  it("recusa SKU vazio e descrição vazia de uma vez", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { sku: " ", descricao: " " }),
    );

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("DADOS_INVALIDOS");
    }
  });

  it("recusa código de barras com dígito verificador errado", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { codigoBarras: "7891000100104" }),
    );

    expect(alterado.isErr()).toBe(true);
  });

  it("recusa categoria que não existe", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { categoriaId: AUSENTE }),
    );

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("CATEGORIA_NAO_ENCONTRADA");
    }
  });

  it("🔑 desativa sem apagar — venda antiga continua apontando para ele", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { ativo: false }),
    );

    expect(alterado.unwrap().ativo).toBe(false);
    expect(cenario.produtos.itens.size).toBe(1);
  });

  it("reativa um produto desativado", async () => {
    const produto = await cadastrado();
    await cenario.alterar.executar(alteracaoBase(produto.id, { ativo: false }));

    const alterado = await cenario.alterar.executar(
      alteracaoBase(produto.id, { ativo: true }),
    );

    expect(alterado.unwrap().ativo).toBe(true);
  });

  it("recusa produto que não existe", async () => {
    const alterado = await cenario.alterar.executar(alteracaoBase(AUSENTE));

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("PRODUTO_NAO_ENCONTRADO");
    }
  });
});

describe("Alteração só do preço", () => {
  it("🔑 acerta o preço da etiqueta com o cliente no caixa", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterarPreco.executar({
      id: produto.id,
      precoVenda: 490n,
    });

    expect(alterado.isOk()).toBe(true);
    expect(alterado.unwrap().precoVenda.centavos).toBe(490n);
  });

  it("não mexe no custo — quem corrige preço no balcão nem sempre pode vê-lo", async () => {
    const produto = await cadastrado({ custo: 650n });

    const alterado = await cenario.alterarPreco.executar({
      id: produto.id,
      precoVenda: 490n,
    });

    expect(alterado.unwrap().custo.centavos).toBe(650n);
  });

  it("recusa preço negativo", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterarPreco.executar({
      id: produto.id,
      precoVenda: -100n,
    });

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("PRODUTO_PRECO_NEGATIVO");
    }
  });

  it("recusa valor que não é dinheiro válido", async () => {
    const produto = await cadastrado();

    const alterado = await cenario.alterarPreco.executar({
      id: produto.id,
      precoVenda: 10n ** 20n,
    });

    expect(alterado.isErr()).toBe(true);
  });

  it("recusa produto que não existe", async () => {
    const alterado = await cenario.alterarPreco.executar({
      id: AUSENTE,
      precoVenda: 490n,
    });

    expect(alterado.isErr()).toBe(true);
    if (alterado.isErr()) {
      expect(alterado.error.codigo).toBe("PRODUTO_NAO_ENCONTRADO");
    }
  });
});

describe("Busca da retaguarda", () => {
  it("encontra por parte da descrição, sem acento e sem caixa", async () => {
    await cadastrado({ descricao: "Refrigerante Cola 2 Litros" });
    await cadastrado({ sku: "PAO001", descricao: "Pão Francês" });

    const encontrados = await cenario.produtos.buscar({ termo: "PAO", limite: 20 });

    expect(encontrados.map((p) => p.sku)).toEqual(["PAO001"]);
  });

  it("termo vazio devolve os primeiros, não todos", async () => {
    await cadastrado();
    await cadastrado({ sku: "PAO001", descricao: "Pão Francês" });

    const encontrados = await cenario.produtos.buscar({ termo: "", limite: 1 });

    expect(encontrados).toHaveLength(1);
  });

  it("filtra os inativos quando pedido", async () => {
    const produto = await cadastrado();
    await cenario.alterar.executar(alteracaoBase(produto.id, { ativo: false }));

    expect(
      await cenario.produtos.buscar({ limite: 20, apenasAtivos: true }),
    ).toHaveLength(0);
    expect(await cenario.produtos.buscar({ limite: 20 })).toHaveLength(1);
  });
});
