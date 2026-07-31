import { describe, expect, it } from "vitest";

import { type DadosCupom, montarCupomVenda } from "./cupomVenda.js";
import { COLUNAS_58MM } from "./escpos.js";

/**
 * Bytes → o texto que sai no papel.
 *
 * Precisa **pular as sequências de comando**, não apenas filtrar bytes não
 * imprimíveis: em `ESC a 1`, o `a` é ASCII e entraria no texto como se fosse
 * conteúdo. Foi exatamente isso que fez a primeira versão deste teste acusar
 * uma linha de 33 colunas que não existe no papel.
 */
function comoTexto(bytes: Uint8Array): string {
  const TAMANHO: Readonly<Record<string, number>> = {
    "27,64": 2, // ESC @
    "27,97": 3, // ESC a n
    "27,69": 3, // ESC E n
    "27,112": 5, // ESC p m t1 t2
    "29,33": 3, // GS ! n
    "29,86": 4, // GS V B n
  };

  let saida = "";
  let i = 0;

  while (i < bytes.length) {
    const atual = bytes[i]!;

    if (atual === 0x1b || atual === 0x1d) {
      const salto = TAMANHO[`${String(atual)},${String(bytes[i + 1] ?? 0)}`];
      if (salto === undefined) throw new Error(`comando desconhecido em ${String(i)}`);
      i += salto;
      continue;
    }

    saida += String.fromCodePoint(atual);
    i += 1;
  }

  return saida;
}

function contem(bytes: Uint8Array, sequencia: readonly number[]): boolean {
  const lista = [...bytes];

  return lista.some((_, indice) =>
    sequencia.every((valor, deslocamento) => lista[indice + deslocamento] === valor),
  );
}

const BASE: DadosCupom = {
  loja: {
    nome: "MERCADINHO DO BAIRRO",
    documento: "11.222.333/0001-81",
    endereco: "Rua das Acacias, 120 - Centro",
  },
  numero: 42,
  emitidoEm: new Date("2026-07-31T14:35:00"),
  operador: "Maria",
  itens: [
    {
      numero: 1,
      descricao: "REFRI COLA 2L",
      quantidade: "2000",
      unidade: "UN",
      precoUnitario: "990",
      total: "1980",
    },
  ],
  subtotal: "1980",
  descontoTotal: "0",
  total: "1980",
  pagamentos: [{ descricao: "Dinheiro", valor: "2000" }],
  troco: "20",
  semValorFiscal: true,
};

const PULSO_GAVETA = [0x1b, 0x70, 0, 0x19, 0xfa];
const DESTAQUE_LIGADO = [0x1d, 0x21, 0x11];

describe("Cabeçalho", () => {
  it("traz o nome da loja, documento e endereço", () => {
    const saida = comoTexto(montarCupomVenda(BASE));

    expect(saida).toContain("MERCADINHO DO BAIRRO");
    expect(saida).toContain("CNPJ 11.222.333/0001-81");
    expect(saida).toContain("Rua das Acacias, 120 - Centro");
  });

  it("loja sem endereço nem documento não deixa linha em branco", () => {
    const saida = comoTexto(
      montarCupomVenda({ ...BASE, loja: { nome: "PADARIA CENTRAL" } }),
    );

    expect(saida).toContain("PADARIA CENTRAL");
    expect(saida).not.toContain("CNPJ");
  });

  it("identifica a venda, a data e o operador", () => {
    const saida = comoTexto(montarCupomVenda(BASE));

    expect(saida).toContain("VENDA 42");
    expect(saida).toContain("31/07/2026 14:35");
    expect(saida).toContain("Operador: Maria");
  });

  it("o cliente aparece só quando a venda tem um", () => {
    expect(comoTexto(montarCupomVenda(BASE))).not.toContain("Cliente:");
    expect(comoTexto(montarCupomVenda({ ...BASE, cliente: "Ana Maria" }))).toContain(
      "Cliente: Ana Maria",
    );
  });
});

describe("Itens", () => {
  it("🔑 a descrição fica na própria linha, sem ser cortada", () => {
    // É o que o cliente usa para conferir o que levou. Cortá-la para caber ao
    // lado do preço tira justamente isso.
    const saida = comoTexto(
      montarCupomVenda({
        ...BASE,
        itens: [
          {
            ...BASE.itens[0]!,
            descricao: "REFRIGERANTE COLA GARRAFA 2 LITROS RETORNAVEL",
          },
        ],
      }),
    );

    // 49 caracteres em papel de 48 colunas: quebra entre palavras, e nenhuma
    // parte da descrição se perde.
    expect(saida).toContain("001 REFRIGERANTE COLA GARRAFA 2 LITROS");
    expect(saida).toContain("RETORNAVEL");
  });

  it("🔑 descrição longa em papel de 58 mm não estoura a coluna", () => {
    // Açougue e hortifruti têm descrição comprida, e a impressora compacta
    // quebraria no meio da palavra.
    const linhas = comoTexto(
      montarCupomVenda(
        {
          ...BASE,
          itens: [
            {
              ...BASE.itens[0]!,
              descricao: "REFRIGERANTE COLA GARRAFA 2 LITROS RETORNAVEL",
            },
          ],
        },
        { colunas: COLUNAS_58MM },
      ),
    ).split("\n");

    for (const linha of linhas) {
      expect(linha.length).toBeLessThanOrEqual(COLUNAS_58MM);
    }
  });

  it("mostra quantidade, unidade e preço unitário na linha de baixo", () => {
    expect(comoTexto(montarCupomVenda(BASE))).toContain("2 UN x 9,90");
  });

  it("quantidade fracionada aparece com as casas que tem", () => {
    const saida = comoTexto(
      montarCupomVenda({
        ...BASE,
        itens: [
          {
            ...BASE.itens[0]!,
            descricao: "PICANHA KG",
            quantidade: "1250",
            unidade: "KG",
            precoUnitario: "8990",
            total: "11238",
          },
        ],
      }),
    );

    expect(saida).toContain("1,25 KG x 89,90");
    expect(saida).toContain("112,38");
  });

  it("conta os itens no rodapé", () => {
    expect(comoTexto(montarCupomVenda(BASE))).toContain("1 item(ns)");
  });
});

describe("Totais", () => {
  it("🔑 só o total e o troco saem em destaque", () => {
    // Destacar tudo é o mesmo que não destacar nada: quem confere o cupom
    // procura um número só.
    const bytes = montarCupomVenda(BASE);
    const ligados = [...bytes].filter(
      (_, i) => bytes[i] === 0x1d && bytes[i + 1] === 0x21 && bytes[i + 2] === 0x11,
    );

    expect(ligados).toHaveLength(2);
    expect(contem(bytes, DESTAQUE_LIGADO)).toBe(true);
  });

  it("mostra subtotal e desconto só quando houve desconto", () => {
    expect(comoTexto(montarCupomVenda(BASE))).not.toContain("Subtotal");

    const comDesconto = comoTexto(
      montarCupomVenda({ ...BASE, descontoTotal: "180", total: "1800" }),
    );

    expect(comDesconto).toContain("Subtotal");
    expect(comDesconto).toContain("-1,80");
  });

  it("o troco some quando é zero", () => {
    const saida = comoTexto(
      montarCupomVenda({
        ...BASE,
        troco: "0",
        pagamentos: [{ descricao: "PIX", valor: "1980" }],
      }),
    );

    expect(saida).not.toContain("TROCO");
    expect(saida).toContain("PIX");
  });

  it("lista todos os pagamentos de uma venda dividida", () => {
    const saida = comoTexto(
      montarCupomVenda({
        ...BASE,
        troco: "0",
        pagamentos: [
          { descricao: "Dinheiro", valor: "1000" },
          { descricao: "Cartao de debito", valor: "980" },
        ],
      }),
    );

    expect(saida).toContain("Dinheiro");
    expect(saida).toContain("Cartao de debito");
  });

  it("valor acima de mil vem com separador de milhar", () => {
    const saida = comoTexto(
      montarCupomVenda({ ...BASE, total: "123456", subtotal: "123456" }),
    );

    expect(saida).toContain("1.234,56");
  });
});

describe("Aviso fiscal", () => {
  it("🔑 sem NFC-e, o cupom declara que não é documento fiscal", () => {
    // Sem o aviso, o comprovante pode ser confundido com nota — e quem responde
    // na fiscalização é a loja.
    expect(comoTexto(montarCupomVenda(BASE))).toContain("SEM VALOR FISCAL");
  });

  it("some quando o cupom acompanha documento fiscal", () => {
    expect(comoTexto(montarCupomVenda({ ...BASE, semValorFiscal: false }))).not.toContain(
      "SEM VALOR FISCAL",
    );
  });
});

describe("Gaveta", () => {
  it("🔑 não abre por padrão", () => {
    // Gaveta aberta em venda paga só no cartão fica aberta sem motivo — e
    // gaveta aberta sem operador ao lado é convite.
    expect(contem(montarCupomVenda(BASE), PULSO_GAVETA)).toBe(false);
  });

  it("abre quando pedido, antes do corte do papel", () => {
    const bytes = montarCupomVenda(BASE, { abrirGaveta: true });

    expect(contem(bytes, PULSO_GAVETA)).toBe(true);

    const lista = [...bytes];
    const pulso = lista.findIndex((_, i) => lista[i] === 0x1b && lista[i + 1] === 0x70);
    const corte = lista.findIndex((_, i) => lista[i] === 0x1d && lista[i + 1] === 0x56);

    // A gaveta abre enquanto a impressora termina — não depois do corte.
    expect(pulso).toBeLessThan(corte);
  });
});

describe("Largura do papel", () => {
  it("🔑 cabe em 58 mm sem estourar a coluna", () => {
    // Impressora compacta existe na base instalada, e uma linha maior que o
    // papel volta embaralhada.
    const linhas = comoTexto(montarCupomVenda(BASE, { colunas: COLUNAS_58MM })).split(
      "\n",
    );

    for (const linha of linhas) {
      expect(linha.length).toBeLessThanOrEqual(COLUNAS_58MM);
    }
  });

  it("em 80 mm o separador ocupa as 48 colunas", () => {
    expect(comoTexto(montarCupomVenda(BASE))).toContain("-".repeat(48));
  });
});

describe("Fechamento", () => {
  it("inicia a impressora e corta o papel", () => {
    const bytes = montarCupomVenda(BASE);

    expect([...bytes].slice(0, 2)).toEqual([0x1b, 0x40]);
    expect([...bytes].slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it("venda sem item ainda produz cupom válido", () => {
    // Acontece em cancelamento e em teste de impressora. Não pode explodir.
    const bytes = montarCupomVenda({
      ...BASE,
      itens: [],
      subtotal: "0",
      total: "0",
      pagamentos: [],
      troco: "0",
    });

    expect(comoTexto(bytes)).toContain("0 item(ns)");
    expect([...bytes].slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
});
