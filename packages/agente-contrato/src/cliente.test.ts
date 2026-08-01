import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgenteIndisponivel, ClienteAgente } from "./cliente.js";
import { CABECALHO_SEGREDO, ROTAS } from "./rotas.js";

/**
 * A tela falando com o Agente Local.
 *
 * Duas promessas carregam este arquivo: **a venda nunca para por falta de
 * Agente**, e **a impressão nunca lança**. A segunda é consequência da primeira
 * — o cupom sai depois de a venda estar gravada, e transformar falha de
 * impressão em erro faria o operador refazer a venda, que é como se cobra o
 * cliente duas vezes.
 */

const CUPOM = {
  cupom: {
    loja: { nome: "Mercadinho" },
    numero: 7,
    emitidoEm: new Date("2026-08-01T12:00:00.000Z"),
    operador: "Maria",
    itens: [],
    subtotal: "0",
    descontoTotal: "0",
    total: "0",
    pagamentos: [],
    troco: "0",
    semValorFiscal: true,
  },
  houveDinheiro: true,
};

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function montar(responder: (url: string, opcoes?: RequestInit) => Promise<Response>) {
  const buscar = vi.fn(responder);
  const cliente = new ClienteAgente({
    segredo: "segredo-de-teste-1234",
    buscar: buscar as unknown as typeof fetch,
  });

  return { cliente, buscar };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("descoberta", () => {
  it("🔑 agente ausente não é erro: devolve indisponível", async () => {
    // Em desenvolvimento, em tablet, ou antes de o serviço subir. A tela
    // continua vendendo contra o servidor da loja.
    const { cliente } = montar(() => Promise.reject(new TypeError("conexão recusada")));

    await expect(cliente.disponivel()).resolves.toBe(false);
  });

  it("agente respondendo é agente disponível", async () => {
    const { cliente, buscar } = montar(() =>
      Promise.resolve(json(200, { estado: "ok" })),
    );

    await expect(cliente.disponivel()).resolves.toBe(true);
    expect(buscar.mock.calls[0]?.[0]).toContain(ROTAS.saude);
  });

  it("agente que recusa o segredo não é agente disponível", async () => {
    const { cliente } = montar(() =>
      Promise.resolve(json(403, { erro: "Segredo inválido." })),
    );

    await expect(cliente.disponivel()).resolves.toBe(false);
  });

  it("🔑 manda o segredo em toda chamada", async () => {
    const { cliente, buscar } = montar(() =>
      Promise.resolve(json(200, { estado: "ok" })),
    );

    await cliente.disponivel();

    const cabecalhos = buscar.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(cabecalhos[CABECALHO_SEGREDO]).toBe("segredo-de-teste-1234");
  });
});

describe("impressão nunca lança", () => {
  it("imprimiu: nada a avisar", async () => {
    const { cliente } = montar(() => Promise.resolve(json(200, { tipo: "IMPRESSO" })));

    await expect(cliente.imprimirCupom(CUPOM)).resolves.toBeUndefined();
  });

  it("não imprimiu: devolve a mensagem que o operador lê", async () => {
    const { cliente } = montar(() =>
      Promise.resolve(json(200, { tipo: "NAO_IMPRESSO", mensagem: "Sem papel." })),
    );

    await expect(cliente.imprimirCupom(CUPOM)).resolves.toBe("Sem papel.");
  });

  it("🔑 agente fora do ar vira aviso, não exceção", async () => {
    // A venda já está gravada. O operador precisa saber do cupom, não de um
    // erro de rede local.
    const { cliente } = montar(() => Promise.reject(new TypeError("sem agente")));

    await expect(cliente.imprimirCupom(CUPOM)).resolves.toContain(
      "venda foi registrada normalmente",
    );
  });

  it("gaveta que não abre também é só aviso", async () => {
    const { cliente } = montar(() => Promise.reject(new TypeError("sem agente")));

    await expect(cliente.abrirGaveta()).resolves.toBe("Gaveta não abriu.");
  });
});

describe("venda offline", () => {
  it("🔑 falha de transporte vira AgenteIndisponivel, não TypeError cru", async () => {
    // Quem chama precisa distinguir "não há agente" de qualquer outra coisa,
    // e `TypeError` vazando obrigaria cada tela a saber disso.
    const { cliente } = montar(() => Promise.reject(new TypeError("sem agente")));

    await expect(cliente.adicionarItem("789")).rejects.toBeInstanceOf(AgenteIndisponivel);
  });

  it("resposta de erro do agente também vira AgenteIndisponivel", async () => {
    const { cliente } = montar(() => Promise.resolve(json(500, { erro: "x" })));

    await expect(cliente.finalizar()).rejects.toBeInstanceOf(AgenteIndisponivel);
  });

  it("o caminho feliz devolve o que o agente respondeu", async () => {
    const { cliente, buscar } = montar(() =>
      Promise.resolve(json(200, { tipo: "OK", faltaPagar: "0" })),
    );

    await expect(cliente.registrarPagamento("DINHEIRO", "1000")).resolves.toEqual({
      tipo: "OK",
      faltaPagar: "0",
    });
    expect(buscar.mock.calls[0]?.[0]).toContain(ROTAS.pagamento);
  });

  it("iniciar, cancelar e sincronizar batem nas rotas certas", async () => {
    const { cliente, buscar } = montar(() => Promise.resolve(json(200, {})));

    await cliente.iniciarVenda({ estacaoId: "e1", operadorId: "o1" });
    await cliente.cancelar();
    await cliente.sincronizar();
    await cliente.estado();

    const caminhos = buscar.mock.calls.map((chamada) => chamada[0]);
    expect(caminhos[0]).toContain(ROTAS.iniciarVenda);
    expect(caminhos[1]).toContain(ROTAS.cancelar);
    expect(caminhos[2]).toContain(ROTAS.sincronizar);
    expect(caminhos[3]).toContain(ROTAS.estado);
  });
});
