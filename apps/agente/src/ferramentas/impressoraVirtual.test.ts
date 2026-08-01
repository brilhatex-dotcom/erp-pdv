import { mkdtempSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COLUNAS_80MM } from "@erp/printing";
import { afterEach, describe, expect, it } from "vitest";

import { impressoraDeRede } from "../hardware/impressora.js";
import { ServicoImpressao } from "../hardware/servicoImpressao.js";
import { ImpressoraVirtual } from "./impressoraVirtual.js";

const CUPOM = {
  loja: { nome: "MERCADINHO DO BAIRRO" },
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
  ],
  subtotal: "995",
  descontoTotal: "0",
  total: "995",
  pagamentos: [{ descricao: "Dinheiro", valor: "1000" }],
  troco: "5",
  semValorFiscal: true,
};

let virtual: ImpressoraVirtual | undefined;

afterEach(async () => {
  await virtual?.desligar();
  virtual = undefined;
});

async function ligar(colunas = COLUNAS_80MM): Promise<number> {
  virtual = new ImpressoraVirtual({ porta: 0, colunas });
  return virtual.ligar();
}

async function esperarCupom(): Promise<void> {
  // A impressora fecha o cupom depois de uma pausa curta no fluxo.
  await new Promise((pronto) => setTimeout(pronto, 250));
}

describe("Caminho completo até a impressora", () => {
  it("🔑 o cupom atravessa a rede e chega legível", async () => {
    // Este é o teste que substitui o equipamento: tela → ponte → socket →
    // bytes → cupom decodificado. O que sobra exige papel de verdade.
    const porta = await ligar();

    const servico = new ServicoImpressao(impressoraDeRede({ host: "127.0.0.1", porta }));
    const aviso = await servico.imprimirCupom({ cupom: CUPOM, houveDinheiro: true });

    expect(aviso.tipo).toBe("IMPRESSO");

    await esperarCupom();

    const recebido = virtual?.ultimo;

    expect(recebido).toBeDefined();
    expect(recebido?.texto).toContain("MERCADINHO DO BAIRRO");
    expect(recebido?.texto).toContain("PÃO FRANCÊS");
    expect(recebido?.texto).toContain("TROCO");
  });

  it("🔑 o acento chega inteiro do outro lado do socket", async () => {
    // A volta pela CP860 depois de atravessar a rede: se o byte tivesse virado
    // dois, a coluna do preço desalinharia no papel.
    const porta = await ligar();

    await new ServicoImpressao(
      impressoraDeRede({ host: "127.0.0.1", porta }),
    ).imprimirCupom({ cupom: CUPOM, houveDinheiro: false });

    await esperarCupom();

    expect(virtual?.ultimo?.texto).toContain("PÃO FRANCÊS");
  });

  it("🔑 a gaveta só é pulsada quando houve dinheiro", async () => {
    const porta = await ligar();
    const servico = new ServicoImpressao(impressoraDeRede({ host: "127.0.0.1", porta }));

    await servico.imprimirCupom({ cupom: CUPOM, houveDinheiro: false });
    await esperarCupom();
    expect(virtual?.ultimo?.abriuGaveta).toBe(false);

    await servico.imprimirCupom({ cupom: CUPOM, houveDinheiro: true });
    await esperarCupom();
    expect(virtual?.ultimo?.abriuGaveta).toBe(true);
  });

  it("o papel é cortado ao fim de cada cupom", async () => {
    const porta = await ligar();

    await new ServicoImpressao(
      impressoraDeRede({ host: "127.0.0.1", porta }),
    ).imprimirCupom({ cupom: CUPOM, houveDinheiro: false });

    await esperarCupom();

    expect(virtual?.ultimo?.cortouPapel).toBe(true);
  });

  it("dois cupons chegam como dois, não como um", async () => {
    const porta = await ligar();
    const servico = new ServicoImpressao(impressoraDeRede({ host: "127.0.0.1", porta }));

    await servico.imprimirCupom({ cupom: CUPOM, houveDinheiro: false });
    await esperarCupom();
    await servico.imprimirCupom({ cupom: CUPOM, houveDinheiro: false });
    await esperarCupom();

    expect(virtual?.recebidos).toHaveLength(2);
  });

  it("a gaveta avulsa chega sem consumir papel", async () => {
    const porta = await ligar();

    await new ServicoImpressao(
      impressoraDeRede({ host: "127.0.0.1", porta }),
    ).abrirGaveta();

    await esperarCupom();

    expect(virtual?.ultimo?.abriuGaveta).toBe(true);
    expect(virtual?.ultimo?.cortouPapel).toBe(false);
  });

  it("🔑 em 58 mm o cupom não estoura a borda, ponta a ponta", async () => {
    const porta = await ligar(32);

    await new ServicoImpressao(
      impressoraDeRede({ host: "127.0.0.1", porta }),
    ).imprimirCupom({ cupom: CUPOM, colunas: 32, houveDinheiro: false });

    await esperarCupom();

    for (const linha of (virtual?.ultimo?.texto ?? "").split("\n")) {
      // Duas colunas a mais pela borda desenhada.
      expect(linha.length).toBeLessThanOrEqual(34);
    }
  });
});

describe("Como ferramenta de suporte", () => {
  it("avisa cada cupom recebido a quem estiver observando", async () => {
    const vistos: string[] = [];

    virtual = new ImpressoraVirtual({
      porta: 0,
      aoReceber: (cupom) => vistos.push(cupom.texto),
    });

    const porta = await virtual.ligar();

    await new ServicoImpressao(
      impressoraDeRede({ host: "127.0.0.1", porta }),
    ).imprimirCupom({ cupom: CUPOM, houveDinheiro: false });

    await esperarCupom();

    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toContain("MERCADINHO");
  });

  it("desligar duas vezes é inofensivo", async () => {
    await ligar();
    await virtual?.desligar();
    await expect(virtual?.desligar()).resolves.toBeUndefined();
  });
});

describe("Opções da ferramenta", () => {
  it("🔑 registra os cupons em arquivo — é o que se pede ao cliente no suporte", async () => {
    // "Aponta a estação para a impressora virtual e me manda o arquivo" resolve
    // sem ninguém ir à loja.
    const registro = join(mkdtempSync(join(tmpdir(), "cupons-")), "cupons.txt");

    virtual = new ImpressoraVirtual({ porta: 0, colunas: 48, registroEm: registro });
    const porta = await virtual.ligar();

    await new ServicoImpressao(
      impressoraDeRede({ host: "127.0.0.1", porta }),
    ).imprimirCupom({ cupom: CUPOM, houveDinheiro: false });

    await esperarCupom();

    const gravado = readFileSync(registro, "utf8");
    expect(gravado).toContain("MERCADINHO DO BAIRRO");
    expect(gravado).toContain("PÃO FRANCÊS");
  });

  it("sem largura configurada, o cupom sai sem a borda desenhada", async () => {
    virtual = new ImpressoraVirtual({ porta: 0 });
    const porta = await virtual.ligar();

    await new ServicoImpressao(
      impressoraDeRede({ host: "127.0.0.1", porta }),
    ).imprimirCupom({ cupom: CUPOM, houveDinheiro: false });

    await esperarCupom();

    expect(virtual.ultimo?.texto).not.toContain("╔");
    expect(virtual.ultimo?.texto).toContain("MERCADINHO DO BAIRRO");
  });

  it("conexão que não manda nada não vira cupom vazio", async () => {
    // Varredura de porta e verificação de saúde abrem e fecham sem escrever.
    const porta = await ligar();

    await new Promise<void>((pronto) => {
      const socket = connect({ host: "127.0.0.1", port: porta }, () => {
        socket.end();
        pronto();
      });
    });

    await esperarCupom();

    expect(virtual?.recebidos).toHaveLength(0);
  });

  it("desligar derruba conexão ainda aberta", async () => {
    const porta = await ligar();

    const socket = connect({ host: "127.0.0.1", port: porta });
    await new Promise<void>((pronto) => {
      socket.on("connect", () => {
        pronto();
      });
    });

    const fechou = new Promise<void>((pronto) => {
      socket.on("close", () => {
        pronto();
      });
    });

    await virtual?.desligar();
    virtual = undefined;

    // A conexão cai do lado do cliente: é o que garante que a ferramenta não
    // deixa porta pendurada entre execuções.
    await expect(fechou).resolves.toBeUndefined();
    socket.destroy();
  });
});
