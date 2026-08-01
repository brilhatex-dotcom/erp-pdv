import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Balcao } from "../balcao.js";
import type { EstadoConexaoNaPonte } from "../contrato-ponte.js";
import { IndicadorConexao } from "../telas/IndicadorConexao.js";

/**
 * O indicador é lido de relance, por alguém de pé e com pressa. Duas regras
 * valem mais que qualquer detalhe visual: **não aparece quando está tudo bem**,
 * e **nunca diz que a venda parou** — porque ela não parou.
 */

function instalarPonte(estado: EstadoConexaoNaPonte | undefined): void {
  const ponte =
    estado === undefined
      ? undefined
      : ({ estadoConexao: vi.fn().mockResolvedValue(estado) } as unknown as Balcao);

  Object.defineProperty(globalThis.window, "balcao", {
    value: ponte,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  instalarPonte(undefined);
  vi.restoreAllMocks();
});

describe("IndicadorConexao", () => {
  it("🔑 não mostra nada quando está conectado", async () => {
    // Selo verde permanente vira parte do cenário em dois dias, e o dia em que
    // mudar de cor ninguém repara.
    instalarPonte({ tipo: "CONECTADO" });

    const { container } = render(<IndicadorConexao />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("não mostra nada no navegador, onde não há contingência", () => {
    instalarPonte(undefined);

    const { container } = render(<IndicadorConexao />);

    expect(container).toBeEmptyDOMElement();
  });

  it("🔑 offline avisa que a venda continua funcionando", async () => {
    // Pintar de vermelho ensinaria o operador a parar de vender e chamar o
    // suporte — o oposto do comportamento correto.
    instalarPonte({ tipo: "OFFLINE", pendentes: 3 });

    render(<IndicadorConexao />);

    const aviso = await screen.findByRole("status");

    expect(aviso).toHaveTextContent("Sem conexão com o servidor");
    expect(aviso).toHaveTextContent("3 vendas aguardando envio");
    expect(aviso).toHaveTextContent("continuam sendo registradas normalmente");
  });

  it("concorda em número com uma venda só", async () => {
    instalarPonte({ tipo: "OFFLINE", pendentes: 1 });

    render(<IndicadorConexao />);

    expect(await screen.findByRole("status")).toHaveTextContent("1 venda aguardando");
  });

  it("offline sem nada na fila não conta vendas fantasmas", async () => {
    instalarPonte({ tipo: "OFFLINE", pendentes: 0 });

    render(<IndicadorConexao />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "nenhuma venda aguardando envio",
    );
  });

  it("🔑 passadas horas, chama o responsável pela loja", async () => {
    // Aqui o problema deixou de ser do caixa: alguém precisa olhar a rede antes
    // que o fechamento do dia chegue com dezenas de vendas presas.
    instalarPonte({
      tipo: "OFFLINE_CRITICO",
      pendentes: 41,
      desdeMs: 5 * 60 * 60 * 1000,
    });

    render(<IndicadorConexao />);

    const aviso = await screen.findByRole("status");

    expect(aviso).toHaveTextContent("Sem servidor há horas");
    expect(aviso).toHaveTextContent("Avise o responsável pela loja");
  });

  it("ponte que quebra não derruba a tela de venda", async () => {
    const estadoConexao = vi.fn().mockRejectedValue(new Error("IPC morreu"));

    Object.defineProperty(globalThis.window, "balcao", {
      value: { estadoConexao },
      configurable: true,
      writable: true,
    });

    const { container } = render(<IndicadorConexao />);

    await waitFor(() => {
      expect(estadoConexao).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });
});
