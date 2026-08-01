import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";

import { type DadosItemDaNota, ItemDaNota } from "./ItemDaNota.js";
import { type DadosNotaDeCompra, NotaDeCompra } from "./NotaDeCompra.js";

const NOTA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0010").unwrap();
const FORNECEDOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0011").unwrap();
const PRODUTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0012").unwrap();
const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0013").unwrap();

const EMISSAO = new Date("2026-07-28T09:00:00.000Z");
const ENTRADA = new Date("2026-07-30T14:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function item(sobrescritas: Partial<DadosItemDaNota> = {}, numero = 1): ItemDaNota {
  const resultado = ItemDaNota.criar(numero, {
    produtoId: PRODUTO,
    descricao: "Refrigerante Cola 2 Litros",
    quantidade: Quantidade.de("10", "UN").unwrap(),
    custoUnitario: reais("3,00"),
    ...sobrescritas,
  });

  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.mensagem}`);
  }

  return resultado.unwrap();
}

function dadosBase(sobrescritas: Partial<DadosNotaDeCompra> = {}): DadosNotaDeCompra {
  const itens = sobrescritas.itens ?? [item()];

  return {
    id: NOTA,
    fornecedorId: FORNECEDOR,
    numero: "123456",
    serie: "1",
    emitidaEm: EMISSAO,
    recebidaEm: ENTRADA,
    itens,
    totalDeclarado: itens.reduce(
      (total, atual) => total.somar(atual.total),
      Dinheiro.zero(),
    ),
    usuarioId: USUARIO,
    ...sobrescritas,
  };
}

function criar(sobrescritas: Partial<DadosNotaDeCompra> = {}): NotaDeCompra {
  const resultado = NotaDeCompra.criar(dadosBase(sobrescritas));

  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.map(String).join(" · ")}`);
  }

  return resultado.unwrap();
}

describe("ItemDaNota", () => {
  it("calcula bruto e total", () => {
    const linha = item();

    expect(linha.bruto.formatar()).toBe("R$ 30,00");
    expect(linha.total.formatar()).toBe("R$ 30,00");
    expect(linha.desconto.ehZero()).toBe(true);
  });

  it("🔑 o desconto do fornecedor entra no custo que vai para o estoque", () => {
    // 10 a R$ 3,00 com R$ 5,00 de desconto: a loja pagou R$ 2,50 por unidade.
    // Ignorar o desconto inflaria o custo médio e encolheria a margem calculada.
    const linha = item({ desconto: reais("5,00") });

    expect(linha.total.formatar()).toBe("R$ 25,00");
    expect(linha.custoEfetivo.formatar()).toBe("R$ 2,50");
  });

  it("guarda a quantidade na unidade em que a mercadoria chegou", () => {
    // A nota diz "3 fardos"; o item guarda 3 fardos. A conversão para a unidade
    // do estoque é do movimento, não do documento.
    const linha = item({
      quantidade: Quantidade.de("3", "FD").unwrap(),
      custoUnitario: reais("60,00"),
    });

    expect(linha.quantidade.unidade.codigo).toBe("FD");
    expect(linha.total.formatar()).toBe("R$ 180,00");
  });

  it("congela a descrição do produto", () => {
    expect(item().descricao).toBe("Refrigerante Cola 2 Litros");
  });

  it.each([
    [0, "ITEM_NOTA_NUMERO_INVALIDO"],
    [-1, "ITEM_NOTA_NUMERO_INVALIDO"],
  ])("recusa número de item %p", (numero, codigo) => {
    const resultado = ItemDaNota.criar(numero, {
      produtoId: PRODUTO,
      descricao: "Produto",
      quantidade: Quantidade.de("1", "UN").unwrap(),
      custoUnitario: reais("1,00"),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe(codigo);
  });

  it("recusa descrição vazia, quantidade zero, custo e desconto negativos", () => {
    const semDescricao = ItemDaNota.criar(1, {
      produtoId: PRODUTO,
      descricao: "  ",
      quantidade: Quantidade.de("1", "UN").unwrap(),
      custoUnitario: reais("1,00"),
    });
    expect(semDescricao.isErr()).toBe(true);

    const semQuantidade = ItemDaNota.criar(1, {
      produtoId: PRODUTO,
      descricao: "Produto",
      quantidade: Quantidade.de("0", "UN").unwrap(),
      custoUnitario: reais("1,00"),
    });
    expect(semQuantidade.isErr()).toBe(true);

    const custoNegativo = ItemDaNota.criar(1, {
      produtoId: PRODUTO,
      descricao: "Produto",
      quantidade: Quantidade.de("1", "UN").unwrap(),
      custoUnitario: reais("1,00").negar(),
    });
    expect(custoNegativo.isErr()).toBe(true);

    const descontoNegativo = ItemDaNota.criar(1, {
      produtoId: PRODUTO,
      descricao: "Produto",
      quantidade: Quantidade.de("1", "UN").unwrap(),
      custoUnitario: reais("1,00"),
      desconto: reais("1,00").negar(),
    });
    expect(descontoNegativo.isErr()).toBe(true);
  });

  it("🔑 recusa desconto maior que o próprio item", () => {
    // Mercadoria com valor negativo levaria o custo médio do produto junto.
    const resultado = ItemDaNota.criar(1, {
      produtoId: PRODUTO,
      descricao: "Produto",
      quantidade: Quantidade.de("10", "UN").unwrap(),
      custoUnitario: reais("3,00"),
      desconto: reais("40,00"),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_NOTA_DESCONTO_MAIOR_QUE_ITEM");
    }
  });

  it("expõe cada campo da linha para quem confere com o papel na mão", () => {
    const linha = item({ desconto: reais("5,00") }, 2);

    expect(linha.numero).toBe(2);
    expect(linha.produtoId.equals(PRODUTO)).toBe(true);
    expect(linha.custoUnitario.formatar()).toBe("R$ 3,00");
    expect(linha.quantidade.formatar()).toBe("10 un");
  });

  it("reconstitui sem revalidar", () => {
    const linha = ItemDaNota.reconstituir(1, {
      produtoId: PRODUTO,
      descricao: "Produto",
      quantidade: Quantidade.de("10", "UN").unwrap(),
      custoUnitario: reais("3,00"),
      desconto: reais("5,00"),
    });

    expect(linha.total.formatar()).toBe("R$ 25,00");
  });
});

describe("NotaDeCompra — criação", () => {
  it("cria a nota com os dados do fornecedor", () => {
    const nota = criar();

    expect(nota.numero).toBe("123456");
    expect(nota.serie).toBe("1");
    expect(nota.status).toBe("LANCADA");
    expect(nota.estaCancelada).toBe(false);
    expect(nota.total.formatar()).toBe("R$ 30,00");
    expect(nota.chave).toBe("123456/1");
  });

  it("soma os itens", () => {
    const nota = criar({
      itens: [
        item({}, 1),
        item({ descricao: "Pão Francês", custoUnitario: reais("2,00") }, 2),
      ],
    });

    expect(nota.total.formatar()).toBe("R$ 50,00");
  });

  it("🔑 recusa quando o total impresso não bate com a soma das linhas", () => {
    // É conferência de digitação. Descobrir três meses depois, quando o estoque
    // não fecha, significa não descobrir mais de qual nota veio.
    const resultado = NotaDeCompra.criar(dadosBase({ totalDeclarado: reais("35,00") }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      const codigos = resultado.error.map((erro) => erro.codigo);
      expect(codigos).toContain("NOTA_TOTAL_NAO_CONFERE");
      // A mensagem mostra os dois valores: quem confere precisa saber o quanto
      // faltou para achar a linha errada.
      expect(resultado.error[0]?.mensagem).toContain("R$ 30,00");
    }
  });

  it("recusa nota sem itens", () => {
    const resultado = NotaDeCompra.criar(
      dadosBase({ itens: [], totalDeclarado: Dinheiro.zero() }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((erro) => erro.codigo)).toContain("NOTA_SEM_ITENS");
    }
  });

  it("recusa número vazio e número longo demais", () => {
    expect(NotaDeCompra.criar(dadosBase({ numero: "  " })).isErr()).toBe(true);
    expect(NotaDeCompra.criar(dadosBase({ numero: "1".repeat(21) })).isErr()).toBe(true);
  });

  it("recusa série e observação longas demais", () => {
    expect(NotaDeCompra.criar(dadosBase({ serie: "123456" })).isErr()).toBe(true);
    expect(NotaDeCompra.criar(dadosBase({ observacao: "x".repeat(501) })).isErr()).toBe(
      true,
    );
  });

  it("🔑 recusa entrada anterior à emissão", () => {
    // Data trocada na digitação desalinha o custo médio da ordem em que as
    // compras realmente aconteceram.
    const resultado = NotaDeCompra.criar(
      dadosBase({ recebidaEm: new Date("2026-07-27T00:00:00.000Z") }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((erro) => erro.codigo)).toContain(
        "NOTA_RECEBIDA_ANTES_DA_EMISSAO",
      );
    }
  });

  it("aceita entrada no mesmo instante da emissão", () => {
    expect(criar({ recebidaEm: EMISSAO }).recebidaEm).toEqual(EMISSAO);
  });

  it("🔑 devolve todos os erros de uma vez", () => {
    // Quem digita quarenta linhas não pode descobrir um problema por gravação.
    const resultado = NotaDeCompra.criar(
      dadosBase({ numero: "", itens: [], totalDeclarado: reais("1,00") }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("série e observação em branco viram ausentes", () => {
    const nota = criar({ serie: "   ", observacao: "" });

    expect(nota.serie).toBeUndefined();
    expect(nota.observacao).toBeUndefined();
    expect(nota.chave).toBe("123456/");
  });

  it("guarda quem lançou — nota de entrada é ato de pessoa", () => {
    expect(criar().usuarioId.equals(USUARIO)).toBe(true);
    expect(criar().fornecedorId.equals(FORNECEDOR)).toBe(true);
  });

  it("reconstitui uma nota cancelada como ela foi gravada", () => {
    const nota = NotaDeCompra.reconstituir(
      dadosBase({
        status: "CANCELADA",
        canceladaEm: ENTRADA,
        motivoCancelamento: "Lançada em duplicidade",
      }),
    );

    expect(nota.estaCancelada).toBe(true);
    expect(nota.motivoCancelamento).toBe("Lançada em duplicidade");
    expect(nota.canceladaEm).toEqual(ENTRADA);
  });
});

describe("NotaDeCompra — cancelamento", () => {
  const AGORA = new Date("2026-08-01T10:00:00.000Z");

  it("🔑 cancela preservando a nota, não apagando", () => {
    // Apagar deixaria o saldo certo e o histórico mentindo.
    const nota = criar();

    const resultado = nota.cancelar(AGORA, "Lançada em duplicidade");

    expect(resultado.isOk()).toBe(true);
    expect(nota.estaCancelada).toBe(true);
    expect(nota.motivoCancelamento).toBe("Lançada em duplicidade");
    expect(nota.canceladaEm).toEqual(AGORA);
    // Os itens continuam lá: é o que permite o estorno saber o que devolver.
    expect(nota.itens).toHaveLength(1);
  });

  it("registra o evento do cancelamento", () => {
    const nota = criar();
    nota.cancelar(AGORA, "Duplicada");

    expect(nota.eventos.map((evento) => evento.tipo)).toEqual(["NotaDeCompraCancelada"]);
  });

  it("🔑 exige motivo — cancelar em silêncio faz mercadoria desaparecer", () => {
    const nota = criar();

    const resultado = nota.cancelar(AGORA, "   ");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("NOTA_CANCELAMENTO_SEM_MOTIVO");
    }
    expect(nota.estaCancelada).toBe(false);
  });

  it("🔑 recusa cancelar duas vezes — o estorno dobraria", () => {
    const nota = criar();
    nota.cancelar(AGORA, "Duplicada");

    const denovo = nota.cancelar(AGORA, "Duplicada de novo");

    expect(denovo.isErr()).toBe(true);
    if (denovo.isErr()) {
      expect(denovo.error.codigo).toBe("NOTA_JA_CANCELADA");
    }
    expect(nota.motivoCancelamento).toBe("Duplicada");
  });

  it("corta motivo longo demais em vez de recusar a operação", () => {
    const nota = criar();

    expect(nota.cancelar(AGORA, "x".repeat(600)).isOk()).toBe(true);
    expect(nota.motivoCancelamento).toHaveLength(500);
  });
});
