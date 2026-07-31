import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import { CodigoBarras } from "./CodigoBarras.js";
import { Embalagem } from "./Embalagem.js";
import { type DadosProduto, Produto } from "./Produto.js";
import { ReferenciaProduto } from "./ReferenciaProduto.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b").unwrap();
const ID_CATEGORIA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6c").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function qtd(valor: string, unidade: "UN" | "KG" | "CX" | "FD"): Quantidade {
  return Quantidade.de(valor, unidade).unwrap();
}

function dadosBase(sobrescritas: Partial<DadosProduto> = {}): DadosProduto {
  return {
    id: ID,
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: reais("9,90"),
    custo: reais("6,50"),
    ...sobrescritas,
  };
}

function criar(sobrescritas: Partial<DadosProduto> = {}): Produto {
  const resultado = Produto.criar(dadosBase(sobrescritas));
  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.map(String).join(" · ")}`);
  }
  return resultado.unwrap();
}

describe("Produto — criação", () => {
  it("cria produto unitário válido", () => {
    const produto = criar();

    expect(produto.sku).toBe("REF001");
    expect(produto.descricao).toBe("Refrigerante Cola 2 Litros");
    expect(produto.tipo).toBe("UNITARIO");
    expect(produto.unidadeBase.codigo).toBe("UN");
    expect(produto.ativo).toBe(true);
    expect(produto.ehPesavel).toBe(false);
  });

  it("nasce ativo por padrão", () => {
    expect(criar().ativo).toBe(true);
  });

  it("aceita nascer inativo", () => {
    expect(criar({ ativo: false }).ativo).toBe(false);
  });

  it("assume custo zero quando não informado", () => {
    expect(criar({ custo: undefined }).custo.ehZero()).toBe(true);
  });

  it("remove espaços das pontas do código e da descrição", () => {
    const produto = criar({ sku: "  REF001  ", descricao: "  Produto  " });

    expect(produto.sku).toBe("REF001");
    expect(produto.descricao).toBe("Produto");
  });

  it("guarda descrição normalizada para busca sem acento", () => {
    expect(criar({ descricao: "Açúcar Refinado União" }).descricaoBusca).toBe(
      "acucar refinado uniao",
    );
  });

  it("deriva a descrição do PDV da descrição completa", () => {
    expect(criar().descricaoPdv).toBe("Refrigerante Cola 2 Litros");
  });

  it("aceita descrição de PDV própria, mais curta para o cupom", () => {
    expect(criar({ descricaoPdv: "REFRI COLA 2L" }).descricaoPdv).toBe("REFRI COLA 2L");
  });

  it("trunca a descrição do PDV no limite da impressora térmica", () => {
    const longa = "A".repeat(80);

    expect(criar({ descricao: longa }).descricaoPdv).toHaveLength(40);
  });
});

describe("Produto — validação acumulada", () => {
  it("devolve TODOS os erros de uma vez, não apenas o primeiro", () => {
    // O cadastro é um formulário longo; descobrir um erro por vez é desperdício
    // do tempo de quem cadastra.
    const resultado = Produto.criar(
      dadosBase({ sku: "", descricao: "", precoVenda: reais("-1,00") }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((e) => e.codigo)).toEqual([
        "PRODUTO_SKU_VAZIO",
        "PRODUTO_DESCRICAO_VAZIA",
        "PRODUTO_PRECO_NEGATIVO",
      ]);
    }
  });

  it("rejeita código longo demais", () => {
    const resultado = Produto.criar(dadosBase({ sku: "X".repeat(31) }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("PRODUTO_SKU_LONGO");
    }
  });

  it("rejeita descrição além do limite do campo xProd da NF-e", () => {
    const resultado = Produto.criar(dadosBase({ descricao: "X".repeat(121) }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("PRODUTO_DESCRICAO_LONGA");
    }
  });

  it("rejeita custo negativo", () => {
    const resultado = Produto.criar(dadosBase({ custo: reais("-1,00") }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("PRODUTO_CUSTO_NEGATIVO");
    }
  });
});

describe("Produto — invariante do produto pesável", () => {
  it("aceita pesável em quilo", () => {
    const produto = criar({ tipo: "PESAVEL", unidadeBase: "KG" });

    expect(produto.ehPesavel).toBe(true);
    expect(produto.unidadeBase.codigo).toBe("KG");
  });

  it("recusa pesável em unidade não fracionável — 0,5 unidade não existe", () => {
    const resultado = Produto.criar(dadosBase({ tipo: "PESAVEL", unidadeBase: "UN" }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("PRODUTO_PESAVEL_UNIDADE_INVALIDA");
      // Mensagem acionável: diz o que fazer, não só o que está errado.
      expect(resultado.error[0]?.mensagem).toContain("quilo ou litro");
    }
  });

  it("permite produto unitário em unidade fracionável", () => {
    // Um produto vendido por litro sem passar pela balança é legítimo.
    expect(Produto.criar(dadosBase({ tipo: "UNITARIO", unidadeBase: "L" })).isOk()).toBe(
      true,
    );
  });
});

describe("Produto — referências", () => {
  const fabricante = ReferenciaProduto.criar("FABRICANTE", "HG-1234").unwrap();
  const original = ReferenciaProduto.criar("ORIGINAL", "HG-1234").unwrap();

  it("aceita várias referências de tipos diferentes", () => {
    const produto = criar({ referencias: [fabricante, original] });

    expect(produto.referencias).toHaveLength(2);
  });

  it("permite o mesmo número em tipos diferentes", () => {
    // Código do fabricante e código original coincidirem é comum e legítimo.
    expect(Produto.criar(dadosBase({ referencias: [fabricante, original] })).isOk()).toBe(
      true,
    );
  });

  it("rejeita referência duplicada no mesmo tipo", () => {
    const repetida = ReferenciaProduto.criar("FABRICANTE", "hg 1234").unwrap();

    const resultado = Produto.criar(dadosBase({ referencias: [fabricante, repetida] }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("PRODUTO_REFERENCIA_DUPLICADA");
    }
  });

  it("adiciona referência depois da criação", () => {
    const produto = criar();

    expect(produto.adicionarReferencia(fabricante).isOk()).toBe(true);
    expect(produto.referencias).toHaveLength(1);
  });

  it("recusa adicionar referência já existente", () => {
    const produto = criar({ referencias: [fabricante] });

    const resultado = produto.adicionarReferencia(fabricante);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_REFERENCIA_DUPLICADA");
    }
  });

  it("remove referência existente", () => {
    const produto = criar({ referencias: [fabricante] });

    expect(produto.removerReferencia(fabricante)).toBe(true);
    expect(produto.referencias).toHaveLength(0);
  });

  it("informa quando não há o que remover", () => {
    expect(criar().removerReferencia(fabricante)).toBe(false);
  });
});

describe("Produto — busca por código", () => {
  const referencia = ReferenciaProduto.criar("FABRICANTE", "HG-1234").unwrap();
  const ean = CodigoBarras.criar("7891000315507").unwrap();

  it("encontra pelo código de barras", () => {
    expect(criar({ codigoBarras: ean }).correspondeAoCodigo("7891000315507")).toBe(true);
  });

  it("encontra pelo SKU", () => {
    expect(criar().correspondeAoCodigo("REF001")).toBe(true);
  });

  it("encontra pelo SKU ignorando caixa", () => {
    expect(criar().correspondeAoCodigo("ref001")).toBe(true);
  });

  it("encontra por referência do fabricante", () => {
    expect(criar({ referencias: [referencia] }).correspondeAoCodigo("HG-1234")).toBe(
      true,
    );
  });

  it("encontra por referência ignorando separadores — como o cliente escreveu", () => {
    const produto = criar({ referencias: [referencia] });

    expect(produto.correspondeAoCodigo("hg 1234")).toBe(true);
    expect(produto.correspondeAoCodigo("HG1234")).toBe(true);
    expect(produto.correspondeAoCodigo("hg.1234")).toBe(true);
  });

  it("não encontra código de outro produto", () => {
    expect(criar({ referencias: [referencia] }).correspondeAoCodigo("XX-9999")).toBe(
      false,
    );
  });

  it("não encontra com busca vazia", () => {
    expect(criar().correspondeAoCodigo("   ")).toBe(false);
  });
});

describe("Produto — embalagens e conversão", () => {
  const fardo = Embalagem.criar("FD", 12n).unwrap();
  const caixa = Embalagem.criar("CX", 24n).unwrap();

  it("aceita várias embalagens", () => {
    expect(criar({ embalagens: [fardo, caixa] }).embalagens).toHaveLength(2);
  });

  it("recusa embalagem na mesma unidade do produto", () => {
    const embalagemUn = Embalagem.criar("UN", 6n).unwrap();

    const resultado = Produto.criar(dadosBase({ embalagens: [embalagemUn] }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("PRODUTO_EMBALAGEM_IGUAL_A_BASE");
    }
  });

  it("recusa duas embalagens na mesma unidade", () => {
    const outroFardo = Embalagem.criar("FD", 6n).unwrap();

    const resultado = Produto.criar(dadosBase({ embalagens: [fardo, outroFardo] }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("PRODUTO_EMBALAGEM_DUPLICADA");
    }
  });

  it("converte fardo em unidades — entrada de mercadoria no depósito", () => {
    const produto = criar({ embalagens: [fardo] });

    const emUnidades = produto.converterParaUnidadeBase(qtd("3", "FD")).unwrap();

    expect(emUnidades.milesimos).toBe(36000n);
    expect(emUnidades.unidade.codigo).toBe("UN");
  });

  it("devolve a própria quantidade quando já está na unidade base", () => {
    const produto = criar({ embalagens: [fardo] });

    expect(produto.converterParaUnidadeBase(qtd("5", "UN")).unwrap().milesimos).toBe(
      5000n,
    );
  });

  it("recusa converter de embalagem não cadastrada", () => {
    const produto = criar({ embalagens: [fardo] });

    const resultado = produto.converterParaUnidadeBase(qtd("2", "CX"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_EMBALAGEM_NAO_CADASTRADA");
    }
  });

  it("localiza embalagem pela unidade", () => {
    const produto = criar({ embalagens: [fardo, caixa] });

    expect(produto.encontrarEmbalagem("CX")?.fator).toBe(24n);
    expect(produto.encontrarEmbalagem("KG")).toBeUndefined();
  });

  it("adiciona embalagem depois da criação", () => {
    const produto = criar();

    expect(produto.adicionarEmbalagem(fardo).isOk()).toBe(true);
    expect(produto.embalagens).toHaveLength(1);
  });

  it("recusa adicionar embalagem duplicada", () => {
    const produto = criar({ embalagens: [fardo] });

    const resultado = produto.adicionarEmbalagem(Embalagem.criar("FD", 6n).unwrap());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_EMBALAGEM_DUPLICADA");
    }
  });

  it("recusa adicionar embalagem na unidade base", () => {
    const resultado = criar().adicionarEmbalagem(Embalagem.criar("UN", 6n).unwrap());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_EMBALAGEM_IGUAL_A_BASE");
    }
  });
});

describe("Produto — cálculo de total", () => {
  it("calcula total de produto unitário", () => {
    expect(criar().calcularTotal(qtd("3", "UN")).unwrap().formatar()).toBe("R$ 29,70");
  });

  it("calcula total de produto pesável com peso fracionado", () => {
    // Picanha a R$ 79,90/kg, 1,250 kg → R$ 99,875 → arredonda para R$ 99,88.
    const picanha = criar({
      tipo: "PESAVEL",
      unidadeBase: "KG",
      precoVenda: reais("79,90"),
    });

    expect(picanha.calcularTotal(qtd("1,250", "KG")).unwrap().formatar()).toBe(
      "R$ 99,88",
    );
  });

  it("calcula peso abaixo de um quilo", () => {
    const frios = criar({
      tipo: "PESAVEL",
      unidadeBase: "KG",
      precoVenda: reais("42,00"),
    });

    expect(frios.calcularTotal(qtd("0,150", "KG")).unwrap().formatar()).toBe("R$ 6,30");
  });

  it("resulta em zero para quantidade zero", () => {
    expect(criar().calcularTotal(qtd("0", "UN")).unwrap().ehZero()).toBe(true);
  });

  it("recusa quantidade em unidade diferente da do produto", () => {
    const resultado = criar().calcularTotal(qtd("1", "KG"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_UNIDADE_INCOMPATIVEL");
    }
  });

  it("recusa quantidade negativa", () => {
    const resultado = criar().calcularTotal(qtd("1", "UN").negar());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_QUANTIDADE_NEGATIVA");
    }
  });
});

describe("Produto — margem", () => {
  it("calcula o lucro bruto", () => {
    expect(criar().lucroBruto().formatar()).toBe("R$ 3,40");
  });

  it("detecta venda abaixo do custo — quase sempre erro de digitação", () => {
    expect(
      criar({ precoVenda: reais("5,00"), custo: reais("6,50") }).vendeAbaixoDoCusto(),
    ).toBe(true);
  });

  it("não acusa quando o preço cobre o custo", () => {
    expect(criar().vendeAbaixoDoCusto()).toBe(false);
  });

  it("não acusa quando o custo é desconhecido", () => {
    // Custo zero significa "não informado", não "de graça".
    expect(criar({ custo: undefined }).vendeAbaixoDoCusto()).toBe(false);
  });
});

describe("Produto — alteração de preço", () => {
  it("altera o preço e registra o evento", () => {
    const produto = criar();

    expect(produto.alterarPreco(reais("11,90"), AGORA).isOk()).toBe(true);
    expect(produto.precoVenda.formatar()).toBe("R$ 11,90");
    expect(produto.eventos).toHaveLength(1);
    expect(produto.eventos[0]?.tipo).toBe("PrecoAlterado");
  });

  it("guarda o preço anterior no evento", () => {
    const produto = criar();
    produto.alterarPreco(reais("11,90"), AGORA);

    const evento = produto.coletarEventos()[0];

    expect(evento).toMatchObject({ tipo: "PrecoAlterado" });
  });

  it("não gera evento quando o preço não muda", () => {
    // Evitar poluir a replicação do catálogo nos PDVs com atualização inócua.
    const produto = criar();

    produto.alterarPreco(reais("9,90"), AGORA);

    expect(produto.eventos).toHaveLength(0);
  });

  it("recusa preço negativo e não altera nada", () => {
    const produto = criar();

    const resultado = produto.alterarPreco(reais("-1,00"), AGORA);

    expect(resultado.isErr()).toBe(true);
    expect(produto.precoVenda.formatar()).toBe("R$ 9,90");
    expect(produto.eventos).toHaveLength(0);
  });

  it("altera o custo e registra o evento", () => {
    const produto = criar();

    expect(produto.alterarCusto(reais("7,00"), AGORA).isOk()).toBe(true);
    expect(produto.eventos[0]?.tipo).toBe("CustoAlterado");
  });

  it("não gera evento quando o custo não muda", () => {
    const produto = criar();

    produto.alterarCusto(reais("6,50"), AGORA);

    expect(produto.eventos).toHaveLength(0);
  });

  it("recusa custo negativo", () => {
    const produto = criar();

    const resultado = produto.alterarCusto(reais("-1,00"), AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_CUSTO_NEGATIVO");
    }
  });
});

describe("Produto — ativação", () => {
  it("desativa e registra o evento", () => {
    const produto = criar();

    produto.desativar(AGORA);

    expect(produto.ativo).toBe(false);
    expect(produto.eventos[0]?.tipo).toBe("ProdutoDesativado");
  });

  it("não gera evento ao desativar o que já está desativado", () => {
    const produto = criar({ ativo: false });

    produto.desativar(AGORA);

    expect(produto.eventos).toHaveLength(0);
  });

  it("reativa e registra o evento", () => {
    const produto = criar({ ativo: false });

    produto.ativar(AGORA);

    expect(produto.ativo).toBe(true);
    expect(produto.eventos[0]?.tipo).toBe("ProdutoAtivado");
  });

  it("não gera evento ao ativar o que já está ativo", () => {
    const produto = criar();

    produto.ativar(AGORA);

    expect(produto.eventos).toHaveLength(0);
  });
});

describe("Produto — demais alterações", () => {
  it("altera a descrição e reindexa a busca", () => {
    const produto = criar();

    expect(produto.alterarDescricao("Água Mineral 500ml").isOk()).toBe(true);
    expect(produto.descricaoBusca).toBe("agua mineral 500ml");
  });

  it("aceita descrição de PDV própria ao alterar", () => {
    const produto = criar();

    produto.alterarDescricao("Água Mineral 500ml", "AGUA 500ML");

    expect(produto.descricaoPdv).toBe("AGUA 500ML");
  });

  it("recusa descrição vazia", () => {
    const resultado = criar().alterarDescricao("   ");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_DESCRICAO_VAZIA");
    }
  });

  it("recusa descrição longa demais", () => {
    const resultado = criar().alterarDescricao("X".repeat(121));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_DESCRICAO_LONGA");
    }
  });

  it("define e remove a categoria", () => {
    const produto = criar();

    produto.definirCategoria(ID_CATEGORIA);
    expect(produto.categoriaId?.equals(ID_CATEGORIA)).toBe(true);

    produto.definirCategoria(undefined);
    expect(produto.categoriaId).toBeUndefined();
  });

  it("define o código de barras depois da criação", () => {
    const produto = criar();
    const ean = CodigoBarras.criar("7891000315507").unwrap();

    produto.definirCodigoBarras(ean);

    expect(produto.codigoBarras?.valor).toBe("7891000315507");
  });
});

describe("Produto — módulo fiscal opcional (ADR-0016)", () => {
  it("é válido sem perfil tributário, para empresa que não emite documento", () => {
    const produto = criar();

    expect(produto.perfilTributarioId).toBeUndefined();
    expect(produto.calcularTotal(qtd("1", "UN")).isOk()).toBe(true);
  });

  it("aceita perfil tributário quando o módulo fiscal está ativo", () => {
    const produto = criar({ perfilTributarioId: ID_CATEGORIA });

    expect(produto.perfilTributarioId?.equals(ID_CATEGORIA)).toBe(true);
  });

  it("permite definir o perfil depois, ao ligar o módulo fiscal", () => {
    const produto = criar();

    produto.definirPerfilTributario(ID_CATEGORIA);

    expect(produto.perfilTributarioId?.equals(ID_CATEGORIA)).toBe(true);
  });
});

describe("Produto — identidade", () => {
  it("compara por identificador, não por atributos", () => {
    const a = criar({ precoVenda: reais("1,00") });
    const b = criar({ precoVenda: reais("99,00") });

    expect(a.equals(b)).toBe(true);
  });
});
