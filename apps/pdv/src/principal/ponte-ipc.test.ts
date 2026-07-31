import { describe, expect, it, vi } from "vitest";

import { interpretarConfiguracao } from "./configuracao.js";
import type { Impressora } from "./ponte-hardware/impressora.js";
import { ServicoImpressao } from "./ponte-hardware/servicoImpressao.js";
import { CANAIS, registrarCanais, type RegistradorIpc } from "./ponte-ipc.js";

function montar(config: unknown = {}, impressora?: Impressora) {
  const tratadores = new Map<string, (...a: never[]) => unknown>();

  const ipc: RegistradorIpc = {
    handle(canal, tratador) {
      tratadores.set(canal, tratador);
    },
  };

  const { configuracao } = interpretarConfiguracao(JSON.stringify(config));
  const impressa: Uint8Array[] = [];

  const servico = new ServicoImpressao(
    impressora ?? {
      imprimir(bytes) {
        impressa.push(bytes);
        return Promise.resolve({ tipo: "IMPRESSO" as const });
      },
    },
  );

  registrarCanais(ipc, servico, configuracao);

  async function chamar(canal: string, ...argumentos: unknown[]): Promise<unknown> {
    const tratador = tratadores.get(canal);
    if (tratador === undefined) throw new Error(`canal ${canal} não registrado`);
    return await tratador(...(argumentos as never[]));
  }

  return { chamar, tratadores, impressa };
}

const CUPOM = {
  cupom: {
    loja: { nome: "MERCADINHO" },
    numero: 1,
    emitidoEm: new Date("2026-07-31T14:35:00"),
    operador: "Maria",
    itens: [],
    subtotal: "0",
    descontoTotal: "0",
    total: "990",
    pagamentos: [],
    troco: "0",
    semValorFiscal: true,
  },
  houveDinheiro: false,
};

describe("Canais registrados", () => {
  it("🔑 os três canais existem — nome errado vira tela congelada, não erro", () => {
    // Canal escrito diferente nos dois lados da ponte não dá erro de
    // compilação: dá uma promessa que nunca resolve.
    const { tratadores } = montar();

    expect([...tratadores.keys()].sort()).toEqual(
      [CANAIS.abrirGaveta, CANAIS.configuracao, CANAIS.imprimirCupom].sort(),
    );
  });
});

describe("Impressão pela ponte", () => {
  it("imprime e devolve o aviso de sucesso", async () => {
    const { chamar, impressa } = montar();

    expect(await chamar(CANAIS.imprimirCupom, {}, CUPOM)).toEqual({
      tipo: "IMPRESSO",
    });
    expect(impressa).toHaveLength(1);
  });

  it("🔑 a largura da estação é aplicada quando a tela não manda uma", async () => {
    // A tela não sabe qual papel a loja usa — quem sabe é a configuração da
    // estação.
    const estreita = montar({ colunas: 32 });
    const larga = montar({ colunas: 48 });

    await estreita.chamar(CANAIS.imprimirCupom, {}, CUPOM);
    await larga.chamar(CANAIS.imprimirCupom, {}, CUPOM);

    expect(estreita.impressa[0]!.length).toBeLessThan(larga.impressa[0]!.length);
  });

  it("a tela pode sobrescrever a largura", async () => {
    const { chamar, impressa } = montar({ colunas: 48 });

    await chamar(CANAIS.imprimirCupom, {}, { ...CUPOM, colunas: 32 });
    await chamar(CANAIS.imprimirCupom, {}, CUPOM);

    expect(impressa[0]!.length).toBeLessThan(impressa[1]!.length);
  });

  it("🔑 chamada sem dados não derruba o caixa", async () => {
    // Defeito de programação da tela — e mesmo assim o balcão continua de pé.
    const { chamar } = montar();

    expect(await chamar(CANAIS.imprimirCupom, {}, undefined)).toMatchObject({
      tipo: "NAO_IMPRESSO",
    });
  });

  it("🔑 falha da impressora atravessa como aviso, nunca como exceção", async () => {
    // Um `handle` que rejeita vira exceção dentro da tela, no meio da venda.
    const { chamar } = montar(
      {},
      {
        imprimir: vi.fn().mockResolvedValue({ tipo: "FALHOU", motivo: "sem papel" }),
      },
    );

    await expect(chamar(CANAIS.imprimirCupom, {}, CUPOM)).resolves.toMatchObject({
      tipo: "NAO_IMPRESSO",
    });
  });
});

describe("Gaveta e configuração", () => {
  it("abre a gaveta pelo canal próprio", async () => {
    const { chamar, impressa } = montar();

    expect(await chamar(CANAIS.abrirGaveta)).toEqual({ tipo: "IMPRESSO" });
    expect([...impressa[0]!]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it("🔑 a tela descobre se há impressora, para não oferecer reimprimir sem ela", async () => {
    const sem = montar();
    const com = montar({ impressora: { tipo: "REDE", host: "192.168.0.50" } });

    expect(await sem.chamar(CANAIS.configuracao)).toMatchObject({
      temImpressora: false,
    });
    expect(await com.chamar(CANAIS.configuracao)).toMatchObject({
      temImpressora: true,
      api: "http://localhost:3000",
    });
  });
});
