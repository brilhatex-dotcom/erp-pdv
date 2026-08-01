import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App.js";
import type { ClienteAgente } from "@erp/agente-contrato";

import { definirAgenteParaTeste } from "../balcao.js";

/**
 * O balcão com o servidor fora do ar.
 *
 * É o cenário que justifica o produto inteiro: a loja não pode parar de vender
 * porque um cabo caiu. O que se verifica aqui é o que o **operador** vê — que a
 * venda continua, que ele sabe que está offline, e que o troco aparece igual.
 */

const OPERADOR = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
  nome: "Maria da Silva",
  matricula: "42",
  papel: "OPERADOR_CAIXA",
  permissoes: ["venda:criar"],
  precisaTrocarCredencial: false,
};

const ITEM_LOCAL = {
  numero: 1,
  codigo: "789",
  descricao: "REFRI COLA 2L",
  quantidade: { milesimos: "1000", unidade: "UN" },
  precoUnitario: "990",
  total: "990",
};

const VENDA_LOCAL = {
  id: "local-1",
  offline: true as const,
  total: "990",
  faltaPagar: "990",
  itens: [ITEM_LOCAL],
};

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Agente completo, como a estação instalada o expõe. */
function instalarPonte(sobrescritas: Partial<ClienteAgente> = {}): void {
  const ponte = {
    disponivel: vi.fn().mockResolvedValue(true),
    imprimirCupom: vi.fn().mockResolvedValue(undefined),
    abrirGaveta: vi.fn().mockResolvedValue(undefined),
    estado: vi.fn().mockResolvedValue({ tipo: "OFFLINE", pendentes: 2 }),
    iniciarVenda: vi.fn().mockResolvedValue({
      id: "local-1",
      offline: true,
      total: "0",
      faltaPagar: "0",
      itens: [],
    }),
    adicionarItem: vi.fn().mockResolvedValue({ tipo: "OK", venda: VENDA_LOCAL }),
    registrarPagamento: vi.fn().mockResolvedValue({ tipo: "OK", faltaPagar: "0" }),
    finalizar: vi.fn().mockResolvedValue({ tipo: "OK", troco: "10" }),
    cancelar: vi.fn().mockResolvedValue(undefined),
    sincronizar: vi.fn(),
    ...sobrescritas,
  };

  definirAgenteParaTeste(ponte as unknown as ClienteAgente);
}

/** Servidor que autentica e depois some — a queda no meio do expediente. */
function montarComServidorFora(): void {
  const buscar = vi.fn((url: string) => {
    if (url.includes("/api/acesso/eu")) return Promise.resolve(json(200, OPERADOR));

    return Promise.reject(new TypeError("Failed to fetch"));
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

  function Envolvido(): ReactNode {
    return (
      <ProvedorSessao contexto="PDV" cliente={cliente}>
        <App />
      </ProvedorSessao>
    );
  }

  render(<Envolvido />);
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
  vi.restoreAllMocks();
});

describe("venda com o servidor fora do ar", () => {
  it("🔑 a venda inteira acontece, do bipe ao troco", async () => {
    // Nenhuma tecla a mais que no caminho online: o operador não muda de modo,
    // não confirma nada, não escolhe "vender offline". Ele bipa.
    instalarPonte();
    montarComServidorFora();

    const usuario = userEvent.setup();
    const campo = await waitFor(() => screen.getByLabelText(/Código do produto/));

    await usuario.type(campo, "789{Enter}");

    await waitFor(() => {
      expect(screen.getByLabelText("Total da venda")).toHaveTextContent("9,90");
    });

    // Enter no campo vazio leva ao pagamento, igual ao caminho online.
    await usuario.type(screen.getByLabelText(/Código do produto/), "{Enter}");

    const valor = await screen.findByLabelText(/Valor recebido/);
    await usuario.clear(valor);
    await usuario.type(valor, "1000{Enter}");

    expect(await screen.findByText("R$ 0,10")).toBeInTheDocument();
  });

  it("🔑 o operador sabe que está offline", async () => {
    instalarPonte();
    montarComServidorFora();

    // A tela de carregamento também é `role="status"`; esperar o balcão evita
    // casar com ela.
    await waitFor(() => screen.getByLabelText(/Código do produto/));

    const aviso = await screen.findByRole("status");

    expect(aviso).toHaveTextContent("Sem conexão com o servidor");
    expect(aviso).toHaveTextContent("2 vendas aguardando envio");
  });

  it("🔑 a venda offline não inventa número", async () => {
    // Numerar é do servidor. Mostrar um número que vai mudar depois é pior que
    // não mostrar número nenhum — o operador anota o errado na conferência.
    instalarPonte();
    montarComServidorFora();

    const usuario = userEvent.setup();
    const campo = await waitFor(() => screen.getByLabelText(/Código do produto/));

    await usuario.type(campo, "789{Enter}");

    expect(await screen.findByText(/Venda offline/)).toBeInTheDocument();
  });

  it("🔑 a tela de conclusão avisa que a venda ainda vai subir", async () => {
    instalarPonte();
    montarComServidorFora();

    const usuario = userEvent.setup();
    const campo = await waitFor(() => screen.getByLabelText(/Código do produto/));

    await usuario.type(campo, "789{Enter}");
    await waitFor(() => {
      expect(screen.getByLabelText("Total da venda")).toHaveTextContent("9,90");
    });
    await usuario.type(screen.getByLabelText(/Código do produto/), "{Enter}");

    const valor = await screen.findByLabelText(/Valor recebido/);
    await usuario.clear(valor);
    await usuario.type(valor, "1000{Enter}");

    expect(
      await screen.findByText(/será enviada quando o servidor voltar/),
    ).toBeInTheDocument();
  });

  it("🔑 produto fora do catálogo local vira mensagem de operador", async () => {
    // A réplica pode estar velha. O operador precisa saber que o problema é
    // este computador, não o produto — senão ele recusa a venda ao cliente.
    instalarPonte({
      adicionarItem: vi.fn().mockResolvedValue({
        tipo: "ERRO",
        mensagem: "Produto não encontrado no catálogo local.",
      }),
    });
    montarComServidorFora();

    const usuario = userEvent.setup();
    const campo = await waitFor(() => screen.getByLabelText(/Código do produto/));

    await usuario.type(campo, "000{Enter}");

    expect(await screen.findByText(/catálogo local/)).toBeInTheDocument();
  });
});
