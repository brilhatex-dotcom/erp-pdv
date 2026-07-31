import { describe, expect, it } from "vitest";

import { COLUNAS_58MM, COLUNAS_80MM, Cupom, paraBytesDaImpressora } from "./escpos.js";

function texto(bytes: Uint8Array): string {
  return [...bytes].map((b) => String.fromCodePoint(b)).join("");
}

describe("Comandos", () => {
  it("iniciar manda ESC @", () => {
    expect([...new Cupom().iniciar().bytes()]).toEqual([0x1b, 0x40]);
  });

  it("alinhamento usa ESC a com o código de cada posição", () => {
    expect([...new Cupom().alinhar("ESQUERDA").bytes()]).toEqual([0x1b, 0x61, 0]);
    expect([...new Cupom().alinhar("CENTRO").bytes()]).toEqual([0x1b, 0x61, 1]);
    expect([...new Cupom().alinhar("DIREITA").bytes()]).toEqual([0x1b, 0x61, 2]);
  });

  it("negrito e destaque ligam e desligam", () => {
    expect([...new Cupom().negrito(true).bytes()]).toEqual([0x1b, 0x45, 1]);
    expect([...new Cupom().negrito(false).bytes()]).toEqual([0x1b, 0x45, 0]);
    expect([...new Cupom().destaque(true).bytes()]).toEqual([0x1d, 0x21, 0x11]);
    expect([...new Cupom().destaque(false).bytes()]).toEqual([0x1d, 0x21, 0x00]);
  });

  it("cortar deixa margem antes do corte", () => {
    const bytes = [...new Cupom().cortar().bytes()];

    // Quatro avanços de linha e então GS V B 0.
    expect(bytes).toEqual([0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
  });

  it("🔑 a gaveta abre por comando da impressora, não por porta separada", () => {
    // A gaveta é ligada na impressora — é assim que o balcão brasileiro é
    // montado. Tratá-la como periférico próprio exigiria um cabo que a loja não
    // tem.
    expect([...new Cupom().abrirGaveta().bytes()]).toEqual([0x1b, 0x70, 0, 0x19, 0xfa]);
    expect([...new Cupom().abrirGaveta(1).bytes()]).toEqual([0x1b, 0x70, 1, 0x19, 0xfa]);
  });

  it("quebrar aceita mais de uma linha", () => {
    expect([...new Cupom().quebrar(3).bytes()]).toEqual([0x0a, 0x0a, 0x0a]);
  });

  it("encadeia na ordem em que foi escrito", () => {
    const bytes = new Cupom().iniciar().alinhar("CENTRO").texto("OI").bytes();

    expect([...bytes]).toEqual([0x1b, 0x40, 0x1b, 0x61, 1, 0x4f, 0x49]);
  });
});

describe("Largura do papel", () => {
  it("80 mm são 48 colunas; 58 mm são 32", () => {
    expect(new Cupom().colunas).toBe(COLUNAS_80MM);
    expect(new Cupom(COLUNAS_58MM).colunas).toBe(32);
  });

  it("o separador ocupa a largura escolhida", () => {
    expect(texto(new Cupom(COLUNAS_58MM).separador().bytes())).toBe(
      `${"-".repeat(32)}\n`,
    );
  });
});

describe("Rótulo e valor nos extremos", () => {
  it("preenche o meio até a largura da linha", () => {
    const linha = texto(new Cupom(20).entreExtremos("Total", "9,90", ".").bytes());

    expect(linha).toBe("Total...........9,90\n");
    expect(linha.trimEnd()).toHaveLength(20);
  });

  it("🔑 descrição longa não é cortada — quebra em duas linhas", () => {
    // Cortar tiraria justamente o que o cliente usa para conferir o que levou.
    const linha = texto(
      new Cupom(20).entreExtremos("REFRIGERANTE COLA 2 LITROS", "9,90").bytes(),
    );

    expect(linha).toBe("REFRIGERANTE COLA 2\n                9,90\n");
  });

  it("caso exato: sem folga, quebra igual", () => {
    // Rótulo + valor ocupando a linha inteira não deixa espaço de separação, e
    // ficariam grudados. Quebrar é mais legível.
    const linha = texto(new Cupom(10).entreExtremos("ABCDEF", "1234").bytes());

    expect(linha).toBe("ABCDEF\n      1234\n");
  });

  it("uma folga de um caractere ainda cabe", () => {
    expect(texto(new Cupom(10).entreExtremos("ABCDE", "1234").bytes())).toBe(
      "ABCDE 1234\n",
    );
  });
});

describe("Acentuação", () => {
  it("🔑 ASCII passa direto", () => {
    expect(paraBytesDaImpressora("PAO")).toEqual([0x50, 0x41, 0x4f]);
  });

  it("🔑 acento vira CP860, não UTF-8", () => {
    // UTF-8 cru faria "ç" ocupar dois bytes e desalinhar a coluna do preço —
    // defeito em todo cupom de padaria.
    expect(paraBytesDaImpressora("ç")).toEqual([0x87]);
    expect(paraBytesDaImpressora("ã")).toEqual([0x84]);
    expect(paraBytesDaImpressora("é")).toEqual([0x82]);
    expect(paraBytesDaImpressora("Ç")).toEqual([0x80]);
  });

  it("🔑 uma letra acentuada é um byte — é o que mantém a coluna", () => {
    expect(paraBytesDaImpressora("PÃO")).toHaveLength(3);
    expect(paraBytesDaImpressora("AÇÃO")).toHaveLength(4);
  });

  it("🔑 Ó e Ò não se confundem — são bytes diferentes na CP860", () => {
    // Mapear "Ó" para o byte de "Ò" faria "ÓLEO" sair "ÒLEO" em todo cupom de
    // mercadinho. O acento errado passa despercebido na revisão e não na loja.
    expect(paraBytesDaImpressora("Ó")).toEqual([0x9f]);
    expect(paraBytesDaImpressora("Ò")).toEqual([0xa9]);
    expect(paraBytesDaImpressora("ÓLEO")).toEqual([0x9f, 0x4c, 0x45, 0x4f]);
  });

  it("cobre as vogais acentuadas que o português usa", () => {
    for (const letra of "áàâãéêíóôõúüç") {
      const bytes = paraBytesDaImpressora(letra);
      expect(bytes).toHaveLength(1);
      expect(bytes[0]).toBeGreaterThanOrEqual(0x80);
    }
  });

  it("fora da tabela, perde o acento antes de virar interrogação", () => {
    // Perder o acento é aceitável; perder o alinhamento não.
    expect(paraBytesDaImpressora("ä")).toEqual([0x61]);
    expect(paraBytesDaImpressora("Ö")).toEqual([0x4f]);
    expect(paraBytesDaImpressora("€")).toEqual([0x45]);
  });

  it("caractere sem equivalente vira interrogação, mantendo uma coluna", () => {
    expect(paraBytesDaImpressora("日")).toEqual([0x3f]);
    expect(paraBytesDaImpressora("🙂")).toEqual([0x3f]);
  });

  it("aspas e travessão tipográficos viram os de máquina", () => {
    expect(paraBytesDaImpressora("“x”")).toEqual([0x22, 0x78, 0x22]);
    expect(paraBytesDaImpressora("—")).toEqual([0x2d]);
  });

  it("texto vazio não gera byte", () => {
    expect(paraBytesDaImpressora("")).toEqual([]);
  });
});

describe("Parágrafo", () => {
  it("🔑 quebra entre palavras, não no meio delas", () => {
    // A impressora quebraria sozinha na borda — mas em "REFRIGERAN/TE", e é
    // nessa linha que o cliente lê o que levou.
    expect(texto(new Cupom(20).paragrafo("REFRIGERANTE COLA 2 LITROS").bytes())).toBe(
      "REFRIGERANTE COLA 2\nLITROS\n",
    );
  });

  it("texto que cabe sai numa linha só", () => {
    expect(texto(new Cupom(20).paragrafo("PAO FRANCES").bytes())).toBe("PAO FRANCES\n");
  });

  it("palavra maior que a largura vai inteira — não há onde separar", () => {
    expect(texto(new Cupom(10).paragrafo("7891000315507").bytes())).toBe(
      "7891000315507\n",
    );
  });

  it("texto vazio produz uma linha vazia", () => {
    expect(texto(new Cupom(10).paragrafo("").bytes())).toBe("\n");
  });
});
