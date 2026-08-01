import { describe, expect, it } from "vitest";

import { montarCupomVenda } from "./cupomVenda.js";
import { COLUNAS_58MM, COLUNAS_80MM, Cupom } from "./escpos.js";
import { comoTexto, previsualizar } from "./previsualizacao.js";

const VENDA = {
  loja: {
    nome: "MERCADINHO DO BAIRRO",
    documento: "11.222.333/0001-81",
    endereco: "Rua das Acacias, 120",
  },
  numero: 42,
  emitidoEm: new Date("2026-07-31T14:35:00"),
  operador: "Maria",
  itens: [
    {
      numero: 1,
      descricao: "PÃO FRANCÊS",
      quantidade: "500",
      unidade: "KG",
      precoUnitario: "1990",
      total: "995",
    },
    {
      numero: 2,
      descricao: "REFRIGERANTE COLA GARRAFA 2 LITROS",
      quantidade: "2000",
      unidade: "UN",
      precoUnitario: "990",
      total: "1980",
    },
  ],
  subtotal: "2975",
  descontoTotal: "0",
  total: "2975",
  pagamentos: [{ descricao: "Dinheiro", valor: "3000" }],
  troco: "25",
  semValorFiscal: true,
};

describe("Decodificação", () => {
  it("devolve o texto que sai no papel", () => {
    const bytes = new Cupom(20).linha("PAO FRANCES").linha("9,90").bytes();

    expect(previsualizar(bytes).linhas.map((l) => l.texto)).toEqual([
      "PAO FRANCES",
      "9,90",
    ]);
  });

  it("🔑 acento volta como uma letra, provando que a coluna não desalinhou", () => {
    // Ida e volta pela CP860. Se "Ã" tivesse virado dois bytes, voltaria como
    // dois caracteres — e é exatamente esse o defeito que desalinha o preço.
    const bytes = new Cupom(20).linha("PÃO AÇÚCAR").bytes();

    const [linha] = previsualizar(bytes).linhas;

    expect(linha?.texto).toBe("PÃO AÇÚCAR");
    expect(linha?.texto).toHaveLength(10);
  });

  it("registra alinhamento e estilo de cada linha", () => {
    const bytes = new Cupom(20)
      .alinhar("CENTRO")
      .negrito(true)
      .linha("LOJA")
      .negrito(false)
      .alinhar("ESQUERDA")
      .destaque(true)
      .linha("TOTAL")
      .destaque(false)
      .linha("fim")
      .bytes();

    const linhas = previsualizar(bytes).linhas;

    expect(linhas[0]).toMatchObject({ texto: "LOJA", alinhamento: "CENTRO" });
    expect(linhas[0]?.estilos).toContain("NEGRITO");
    expect(linhas[1]).toMatchObject({ texto: "TOTAL", alinhamento: "ESQUERDA" });
    expect(linhas[1]?.estilos).toContain("DESTAQUE");
    expect(linhas[2]?.estilos).toEqual([]);
  });

  it("alinhamento à direita é reconhecido", () => {
    const bytes = new Cupom(20).alinhar("DIREITA").linha("9,90").bytes();

    expect(previsualizar(bytes).linhas[0]?.alinhamento).toBe("DIREITA");
  });

  it("conteúdo depois da última quebra ainda conta como linha", () => {
    const bytes = new Cupom(20).texto("SEM QUEBRA").bytes();

    expect(previsualizar(bytes).linhas.map((l) => l.texto)).toEqual(["SEM QUEBRA"]);
  });

  it("byte fora da tabela vira interrogação, sem quebrar a decodificação", () => {
    const bytes = Uint8Array.from([0x41, 0xff, 0x42]);

    expect(previsualizar(bytes).linhas[0]?.texto).toBe("A?B");
  });
});

describe("Gaveta e corte", () => {
  it("🔑 detecta o pulso da gaveta no fluxo", () => {
    // É o que permite conferir, sem gaveta, que ela só abre quando devia.
    expect(previsualizar(montarCupomVenda(VENDA)).abriuGaveta).toBe(false);
    expect(
      previsualizar(montarCupomVenda(VENDA, { abrirGaveta: true })).abriuGaveta,
    ).toBe(true);
  });

  it("detecta o corte do papel", () => {
    expect(previsualizar(montarCupomVenda(VENDA)).cortouPapel).toBe(true);
    expect(previsualizar(new Cupom().linha("x").bytes()).cortouPapel).toBe(false);
  });
});

describe("Comando desconhecido", () => {
  it("🔑 é denunciado, não engolido", () => {
    // Um comando novo que a pré-visualização não conheça faria o cupom passar a
    // ser conferido às cegas — o teste continuaria verde medindo menos.
    const bytes = Uint8Array.from([0x1b, 0x7a, 0x01, 0x41]);

    const previsto = previsualizar(bytes);

    expect(previsto.comandosDesconhecidos).toContain("27,122");
  });

  it("o cupom de venda não usa nenhum comando desconhecido", () => {
    expect(
      previsualizar(montarCupomVenda(VENDA, { abrirGaveta: true })).comandosDesconhecidos,
    ).toEqual([]);
  });
});

describe("Cupom conferido a olho", () => {
  it("🔑 o cupom de 80 mm sai como o esperado", () => {
    // Este é o teste que substitui a impressora para efeito de layout: qualquer
    // mudança de alinhamento, quebra ou acentuação aparece aqui como diferença
    // no instantâneo.
    expect(comoTexto(montarCupomVenda(VENDA), COLUNAS_80MM)).toMatchInlineSnapshot(`
      "╔════════════════════════════════════════════════╗
      ║              MERCADINHO DO BAIRRO              ║
      ║            CNPJ 11.222.333/0001-81             ║
      ║              Rua das Acacias, 120              ║
      ║                                                ║
      ║------------------------------------------------║
      ║VENDA 42                        31/07/2026 14:35║
      ║Operador: Maria                                 ║
      ║------------------------------------------------║
      ║001 PÃO FRANCÊS                                 ║
      ║    0,5 KG x 19,90                          9,95║
      ║002 REFRIGERANTE COLA GARRAFA 2 LITROS          ║
      ║    2 UN x 9,90                            19,80║
      ║------------------------------------------------║
      ║TOTAL                                      29,75║
      ║                                                ║
      ║Dinheiro...................................30,00║
      ║TROCO                                       0,25║
      ║                                                ║
      ║            *** SEM VALOR FISCAL ***            ║
      ║              Documento nao fiscal              ║
      ║                   2 item(ns)                   ║
      ║                                                ║
      ║                                                ║
      ║                                                ║
      ║                                                ║
      ╚════════════════════════════════════════════════╝"
    `);
  });

  it("🔑 em 58 mm nada estoura a borda do papel", () => {
    const texto = comoTexto(montarCupomVenda(VENDA, { colunas: COLUNAS_58MM }));

    for (const linha of texto.split("\n")) {
      expect(linha.length).toBeLessThanOrEqual(COLUNAS_58MM);
    }
  });

  it("sem largura, devolve o texto puro", () => {
    const texto = comoTexto(new Cupom(20).alinhar("CENTRO").linha("LOJA").bytes());

    expect(texto).toBe("LOJA");
  });

  it("linha maior que a largura não é recentralizada", () => {
    // Centralizar o que já não cabe empurraria o texto para fora da borda.
    const bytes = new Cupom(10).alinhar("CENTRO").linha("TEXTO BEM LONGO").bytes();

    expect(comoTexto(bytes, 10)).toContain("TEXTO BEM LONGO");
  });
});
