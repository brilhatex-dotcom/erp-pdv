import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Fechamento } from "../telas/Fechamento.js";

/**
 * O fechamento, do ponto de vista de quem conta a gaveta.
 *
 * A regra que carrega tudo: **o esperado não pode aparecer antes da contagem**.
 * Se aparecer, o operador digita o número que está na frente dele e a falta que
 * o controle existe para achar passa despercebida todos os dias.
 */

const CONFERENCIA = {
  fundoTroco: "10000",
  recebidoEmDinheiro: "30000",
  trocoDevolvido: "5000",
  suprimentos: "0",
  sangrias: "0",
  esperadoEmDinheiro: "35000",
  contadoEmDinheiro: "33000",
  divergenciaEmDinheiro: "-2000",
  totalVendido: "25000",
  totalAReceber: "25000",
  quantidadeVendas: 1,
  porForma: [],
};

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function montar(responder: (corpo: unknown) => Response): {
  readonly corpos: unknown[];
  readonly aoSair: () => void;
} {
  // Só as chamadas de fechamento: o provedor de sessão consulta `/api/acesso/eu`
  // ao montar, e contá-la faria "nenhuma tentativa de fechar" parecer uma.
  const corpos: unknown[] = [];

  const buscar = vi.fn((url: string, opcoes?: RequestInit) => {
    const corpo =
      typeof opcoes?.body === "string" ? (JSON.parse(opcoes.body) as unknown) : undefined;

    if (url.includes("/api/caixa/fechar")) corpos.push(corpo);
    else return Promise.resolve(json(200, { id: "u1", nome: "Maria", permissoes: [] }));

    return Promise.resolve(responder(corpo));
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);
  const aoSair = vi.fn();

  function Envolvido(): ReactNode {
    return (
      <ProvedorSessao contexto="PDV" cliente={cliente}>
        <Fechamento aoSair={aoSair} />
      </ProvedorSessao>
    );
  }

  render(<Envolvido />);

  return { corpos, aoSair };
}

function instalarPonte(pendentes: number): void {
  Object.defineProperty(globalThis.window, "balcao", {
    value: {
      estadoConexao: vi.fn().mockResolvedValue({ tipo: "CONECTADO", pendentes }),
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  Object.defineProperty(globalThis.window, "balcao", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contagem às cegas", () => {
  it("🔑 não mostra o esperado antes de o operador contar", () => {
    // O teatro da conferência: com o número na tela, o operador confirma o
    // número da tela.
    montar(() => json(200, CONFERENCIA));

    expect(screen.queryByText(/Esperado/)).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 350,00")).not.toBeInTheDocument();
  });

  it("mostra em reais o que está sendo digitado em centavos", async () => {
    montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "33000");

    expect(await screen.findByText("R$ 330,00")).toBeInTheDocument();
  });

  it("campo vazio não fecha o caixa", async () => {
    const { corpos } = montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole("button", { name: /Conferir e fechar/ }));

    expect(corpos).toHaveLength(0);
  });
});

describe("depois de contar", () => {
  it("🔑 a diferença aparece, e só então o esperado", async () => {
    montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "33000{Enter}");

    expect(await screen.findByText(/Falta/)).toBeInTheDocument();
    expect(screen.getByLabelText("Diferença apurada")).toHaveTextContent("R$ 20,00");
    expect(screen.getByText("Esperado na gaveta")).toBeInTheDocument();
    expect(screen.getByText("R$ 350,00")).toBeInTheDocument();
  });

  it("gaveta que bate não é pintada de problema", async () => {
    montar(() =>
      json(200, {
        ...CONFERENCIA,
        contadoEmDinheiro: "35000",
        divergenciaEmDinheiro: "0",
      }),
    );

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "35000{Enter}");

    expect(await screen.findByText("A gaveta bateu")).toBeInTheDocument();
  });

  it("sobra é distinguida de falta", async () => {
    montar(() =>
      json(200, {
        ...CONFERENCIA,
        contadoEmDinheiro: "37000",
        divergenciaEmDinheiro: "2000",
      }),
    );

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "37000{Enter}");

    expect(await screen.findByText("Sobra")).toBeInTheDocument();
  });
});

describe("fila da estação", () => {
  it("🔑 informa ao servidor quantas vendas ainda não subiram", async () => {
    // O servidor não tem como saber: uma venda que nunca chegou não deixa
    // rastro nele.
    instalarPonte(3);
    const { corpos } = montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "33000{Enter}");

    await waitFor(() => {
      expect(corpos[0]).toMatchObject({ vendasPendentes: 3 });
    });
  });

  it("no navegador, sem ponte, não inventa pendências", async () => {
    const { corpos } = montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "33000{Enter}");

    await waitFor(() => {
      expect(corpos[0]).toMatchObject({ vendasPendentes: 0 });
    });
  });

  it("🔑 recusa do servidor vira mensagem que o operador entende", async () => {
    instalarPonte(2);
    montar(() =>
      json(409, {
        erro: {
          codigo: "CAIXA_COM_VENDAS_PENDENTES",
          mensagem:
            "Há 2 vendas ainda não enviadas ao servidor. Aguarde a sincronização.",
        },
      }),
    );

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "33000{Enter}");

    expect(await screen.findByText(/2 vendas ainda não enviadas/)).toBeInTheDocument();
  });

  it("ponte quebrada não impede o fechamento do dia", async () => {
    // Travar o fechamento porque o IPC não respondeu deixaria a loja sem
    // conseguir fechar por um problema que não tem a ver com dinheiro.
    Object.defineProperty(globalThis.window, "balcao", {
      value: {
        estadoConexao: vi.fn().mockRejectedValue(new Error("IPC morreu")),
      },
      configurable: true,
      writable: true,
    });

    const { corpos } = montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "33000{Enter}");

    await waitFor(() => {
      expect(corpos[0]).toMatchObject({ vendasPendentes: 0 });
    });
  });
});

describe("saída", () => {
  it("voltar não fecha o caixa", async () => {
    const { corpos, aoSair } = montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole("button", { name: "Voltar" }));

    expect(aoSair).toHaveBeenCalledOnce();
    expect(corpos).toHaveLength(0);
  });

  it("concluir devolve ao balcão", async () => {
    const { aoSair } = montar(() => json(200, CONFERENCIA));

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText(/Total contado/), "33000{Enter}");
    await usuario.click(await screen.findByRole("button", { name: "Concluir" }));

    expect(aoSair).toHaveBeenCalledOnce();
  });
});
