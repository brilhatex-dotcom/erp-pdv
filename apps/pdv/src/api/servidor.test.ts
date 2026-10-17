import { ClienteApi, Sessao } from "@erp/cliente-api";
import { describe, expect, it, vi } from "vitest";

import { ApiDoBalcao, enderecoDaImagem } from "./servidor.js";

/**
 * Cada operação do balcão vai ao caminho certo, com o método e o corpo certos —
 * e o cliente do modo treinamento leva todas para `/treino`.
 */

interface Pedido {
  readonly url: string;
  readonly metodo: string;
  readonly corpo: unknown;
}

function montar(base = ""): {
  readonly api: ApiDoBalcao;
  readonly pedidos: Pedido[];
} {
  const pedidos: Pedido[] = [];
  const buscar = vi.fn((url: string, opcoes?: RequestInit) => {
    pedidos.push({
      url,
      metodo: opcoes?.method ?? "GET",
      corpo: typeof opcoes?.body === "string" ? JSON.parse(opcoes.body) : undefined,
    });

    const corpo = url.includes("/produtos")
      ? { produtos: [] }
      : url.includes("/clientes")
        ? { clientes: [] }
        : { vendas: [] };

    return Promise.resolve(
      new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  const cliente = new ClienteApi(new Sessao(), base, buscar as unknown as typeof fetch);

  return { api: new ApiDoBalcao(cliente), pedidos };
}

describe("ApiDoBalcao", () => {
  it("🔑 cada operação no seu caminho", async () => {
    const { api, pedidos } = montar();
    const credencial = { matricula: "7", pin: "860412" };

    await api.contexto();
    await api.atalhos();
    await api.buscarProdutos({ termo: "pão", categoriaId: "c1" });
    await api.buscarProdutos({});
    await api.buscarClientes("josé");
    await api.caixaAberto("e1");
    await api.abrirCaixa("e1", "10000");
    await api.movimentarCaixa("sangria", {
      estacaoId: "e1",
      valor: "100",
      motivo: "cofre",
    });
    await api.fecharCaixa({
      estacaoId: "e1",
      contadoEmDinheiro: "100",
      vendasPendentes: 0,
    });
    await api.iniciarVenda("e1");
    await api.venda("v1");
    await api.abertas("e1");
    await api.adicionarItem("v1", { codigo: "789" });
    await api.alterarQuantidade(
      "v1",
      2,
      { milesimos: "3000", unidade: "UN" },
      credencial,
    );
    await api.removerItem("v1", 2);
    await api.aplicarDesconto("v1", { percentualBps: 500 });
    await api.identificarCliente("v1", null);
    await api.registrarPagamento("v1", { forma: "PIX", valor: "100", chave: "chave-1" });
    await api.removerPagamento("v1", 0);
    await api.suspender("v1", "Mesa 3");
    await api.retomar("v1", "e1");
    await api.cancelar("v1", "desistiu");
    await api.finalizar("v1", { parcelas: 2 });
    await api.comprovante("v1");
    await api.recentes({ estacaoId: "e1", numero: 41, limite: 5 });
    await api.recentes({});
    await api.devolucoes("v1");
    await api.registrarDevolucao("v1", {
      estacaoId: "e1",
      itens: [],
      formaReembolso: "PIX",
      motivo: "troca",
    });

    expect(pedidos.map((pedido) => `${pedido.metodo} ${pedido.url}`)).toEqual([
      "GET /api/pdv/contexto",
      "GET /api/pdv/atalhos",
      "GET /api/pdv/produtos?termo=p%C3%A3o&categoriaId=c1",
      "GET /api/pdv/produtos?",
      "GET /api/pdv/clientes?termo=jos%C3%A9",
      "GET /api/caixa/aberto?estacaoId=e1",
      "POST /api/caixa/abrir",
      "POST /api/caixa/sangria",
      "POST /api/caixa/fechar",
      "POST /api/vendas",
      "GET /api/vendas/v1",
      "GET /api/vendas/abertas?estacaoId=e1",
      "POST /api/vendas/v1/itens",
      "PUT /api/vendas/v1/itens/2",
      "POST /api/vendas/v1/itens/2/remover",
      "POST /api/vendas/v1/desconto",
      "PUT /api/vendas/v1/cliente",
      "POST /api/vendas/v1/pagamentos",
      "POST /api/vendas/v1/pagamentos/0/remover",
      "POST /api/vendas/v1/suspender",
      "POST /api/vendas/v1/retomar",
      "POST /api/vendas/v1/cancelar",
      "POST /api/vendas/v1/finalizar",
      "GET /api/vendas/v1/comprovante",
      "GET /api/vendas/recentes?estacaoId=e1&numero=41&limite=5",
      "GET /api/vendas/recentes?",
      "GET /api/vendas/v1/devolucoes",
      "POST /api/vendas/v1/devolucoes",
    ]);
    expect(pedidos[13]?.corpo).toEqual({
      quantidade: { milesimos: "3000", unidade: "UN" },
      supervisor: credencial,
    });
    expect(pedidos[16]?.corpo).toEqual({ clienteId: null });
    expect(pedidos[22]?.corpo).toEqual({ crediario: { parcelas: 2 } });
  });

  it("🔑 o cliente do treinamento leva todas as chamadas para /treino, e as imagens também", async () => {
    const { api, pedidos } = montar("/treino");

    await api.contexto();
    await api.iniciarVenda("e1");
    await api.recomecarTreino();

    expect(pedidos.map((pedido) => [pedido.metodo, pedido.url])).toEqual([
      ["GET", "/treino/api/pdv/contexto"],
      ["POST", "/treino/api/vendas"],
      ["POST", "/treino/api/treinamento/recomecar"],
    ]);
    expect(enderecoDaImagem("img-1")).toBe("/api/imagens/img-1");
    expect(enderecoDaImagem("img-1", "/treino")).toBe("/treino/api/imagens/img-1");
  });
});
