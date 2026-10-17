import type { ClienteAgente } from "@erp/agente-contrato";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { Comprovante, VendaNoFio } from "../api/tipos.js";
import { definirAgenteParaTeste } from "../balcao.js";
import {
  abrirGaveta,
  avisosDoComprovante,
  imprimirComprovante,
  imprimirSemConexao,
  paraCupom,
  teveDinheiro,
} from "./comprovante.js";

/**
 * O comprovante: o mesmo dado para o Agente e para o navegador, sempre marcado
 * como não fiscal, e problema de impressora como aviso — nunca como erro.
 */

const VENDA: VendaNoFio = {
  id: "venda-1",
  numero: 41,
  status: "FINALIZADA",
  estacaoId: "estacao-1",
  operadorId: "operador-1",
  abertaEm: "2026-10-17T12:00:00.000Z",
  finalizadaEm: "2026-10-17T12:05:00.000Z",
  subtotal: "1250",
  descontoItens: "0",
  descontoVenda: "0",
  descontoTotal: "0",
  total: "1250",
  totalPago: "2000",
  faltaPagar: "0",
  troco: "750",
  itens: [
    {
      numero: 1,
      produtoId: "p",
      descricao: "PAO FRANCES",
      quantidade: { milesimos: "1000", unidade: "UN" },
      precoUnitario: "1250",
      totalBruto: "1250",
      desconto: "0",
      descontoRateado: "0",
      total: "1250",
    },
  ],
  pagamentos: [
    {
      indice: 0,
      forma: "DINHEIRO",
      descricao: "Dinheiro",
      valor: "2000",
      parcelas: 1,
      confirmacao: "MANUAL",
    },
  ],
};

const COMPROVANTE: Comprovante = {
  aviso: "NÃO É DOCUMENTO FISCAL",
  treinamento: false,
  larguraCupom: 80,
  operadorNome: "Maria",
  emitidoEm: "2026-10-17T12:06:00.000Z",
  venda: VENDA,
};

function apiCom(comprovante: () => Promise<Comprovante>): ApiDoBalcao {
  return { comprovante } as unknown as ApiDoBalcao;
}

interface PonteDeImpressao {
  readonly imprimirCupom: Mock;
  readonly abrirGaveta: Mock;
}

function instalar(sobrescritas: Partial<PonteDeImpressao> = {}): PonteDeImpressao {
  const ponte = {
    imprimirCupom: sobrescritas.imprimirCupom ?? vi.fn().mockResolvedValue(undefined),
    abrirGaveta: sobrescritas.abrirGaveta ?? vi.fn().mockResolvedValue(undefined),
  };
  definirAgenteParaTeste(ponte as unknown as ClienteAgente);

  return ponte;
}

beforeEach(() => {
  definirAgenteParaTeste(undefined);
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
});

describe("imprimirComprovante", () => {
  it("🔑 comprovante que não chega vira aviso, porque a venda já está gravada", async () => {
    const resultado = await imprimirComprovante(
      apiCom(() => Promise.reject(new Error("x"))),
      "venda-1",
      {
        segundaVia: false,
        abrirGaveta: true,
      },
    );

    expect(resultado).toEqual({
      via: "FALHOU",
      aviso: "Comprovante não impresso. A venda foi registrada normalmente.",
    });
  });

  it("sem Agente, devolve o comprovante para o navegador imprimir", async () => {
    const resultado = await imprimirComprovante(
      apiCom(() => Promise.resolve(COMPROVANTE)),
      "venda-1",
      {
        segundaVia: false,
        abrirGaveta: true,
      },
    );

    expect(resultado).toEqual({ via: "NAVEGADOR", comprovante: COMPROVANTE });
  });

  it("🔑 a gaveta abre só quando pedido, com dinheiro, e nunca na segunda via", async () => {
    const ponte = instalar();
    const api = apiCom(() => Promise.resolve(COMPROVANTE));

    await imprimirComprovante(api, "venda-1", { segundaVia: false, abrirGaveta: true });
    await imprimirComprovante(api, "venda-1", { segundaVia: false, abrirGaveta: false });
    await imprimirComprovante(api, "venda-1", { segundaVia: true, abrirGaveta: true });

    expect(
      ponte.imprimirCupom.mock.calls.map(
        ([dados]) => (dados as { houveDinheiro: boolean }).houveDinheiro,
      ),
    ).toEqual([true, false, false]);
  });

  it("o aviso do Agente volta para a tela", async () => {
    instalar({ imprimirCupom: vi.fn().mockResolvedValue("Impressora sem papel.") });

    const resultado = await imprimirComprovante(
      apiCom(() => Promise.resolve(COMPROVANTE)),
      "venda-1",
      {
        segundaVia: false,
        abrirGaveta: false,
      },
    );

    expect(resultado).toEqual({ via: "AGENTE", aviso: "Impressora sem papel." });
  });
});

describe("imprimirSemConexao", () => {
  const dados = {
    loja: "Padaria",
    operador: "Maria",
    larguraCupom: 58 as const,
    treinamento: false,
    abrirGaveta: true,
  };

  it("sem Agente, avisa que não há como imprimir", async () => {
    const resultado = await imprimirSemConexao(VENDA, dados);

    expect(resultado.via).toBe("FALHOU");
  });

  it("🔑 monta o papel na estação, sem número e marcado como sem conexão", async () => {
    const ponte = instalar();

    await imprimirSemConexao(
      { ...VENDA, finalizadaEm: undefined },
      { ...dados, loja: undefined },
    );

    expect(ponte.imprimirCupom).toHaveBeenCalledWith(
      expect.objectContaining({
        houveDinheiro: true,
        colunas: 32,
        cupom: expect.objectContaining({
          numero: 0,
          loja: { nome: "COMPROVANTE DE VENDA" },
          avisos: ["VENDA SEM CONEXAO"],
          itens: [expect.objectContaining({ unidade: "un", quantidade: "1000" })],
        }) as unknown,
      }),
    );
  });
});

describe("abrirGaveta", () => {
  it("sem Agente, não há gaveta — e isso não é aviso", async () => {
    expect(await abrirGaveta()).toBeUndefined();
  });

  it("com Agente, o aviso dele volta", async () => {
    instalar({ abrirGaveta: vi.fn().mockResolvedValue("Gaveta não abriu.") });

    expect(await abrirGaveta()).toBe("Gaveta não abriu.");
  });
});

describe("o papel", () => {
  it("🔑 os avisos do alto: treinamento, cancelada e segunda via", () => {
    expect(avisosDoComprovante(COMPROVANTE, false)).toEqual([]);
    expect(
      avisosDoComprovante(
        { ...COMPROVANTE, treinamento: true, venda: { ...VENDA, status: "CANCELADA" } },
        true,
      ),
    ).toEqual(["TREINAMENTO - SEM VALOR", "VENDA CANCELADA", "SEGUNDA VIA"]);
  });

  it("sem cadastro da loja, o cabeçalho diz o que o papel é", () => {
    const cupom = paraCupom(
      { ...COMPROVANTE, venda: { ...VENDA, finalizadaEm: undefined } },
      false,
    );

    expect(cupom.loja).toEqual({
      nome: "COMPROVANTE DE VENDA",
      endereco: undefined,
      documento: undefined,
    });
    expect(cupom.emitidoEm).toEqual(new Date(COMPROVANTE.emitidoEm));
    expect(cupom.semValorFiscal).toBe(true);
  });

  it("teveDinheiro olha as formas, não o troco", () => {
    expect(teveDinheiro(VENDA)).toBe(true);
    expect(teveDinheiro({ ...VENDA, pagamentos: [] })).toBe(false);
  });
});
