import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Caixas } from "../telas/Caixas.js";

/**
 * A conferência dos caixas, do ponto de vista do gerente.
 *
 * O que se verifica aqui é o que ele precisa achar de relance: **qual linha tem
 * diferença**. E o oposto, que custa a confiança no sistema: caixa ainda aberto
 * não pode aparecer como se tivesse batido.
 */

const ABERTA = {
  id: "s1",
  estacaoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
  operadorNome: "Maria da Silva",
  status: "ABERTA" as const,
  abertaEm: "2026-08-01T11:00:00.000Z",
  fundoTroco: "10000",
  recebidoEmDinheiro: "30000",
  trocoDevolvido: "5000",
  suprimentos: "0",
  sangrias: "0",
  esperadoEmDinheiro: "35000",
  totalVendido: "25000",
  quantidadeVendas: 1,
};

const COM_FALTA = {
  ...ABERTA,
  id: "s2",
  operadorNome: "João Souza",
  status: "FECHADA" as const,
  fechadaEm: "2026-08-01T21:00:00.000Z",
  contadoEmDinheiro: "33000",
  divergenciaEmDinheiro: "-2000",
};

const BATEU = {
  ...COM_FALTA,
  id: "s3",
  operadorNome: "Ana Lima",
  contadoEmDinheiro: "35000",
  divergenciaEmDinheiro: "0",
};

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function montar(sessoes: unknown[]): { readonly urls: string[] } {
  const urls: string[] = [];

  const buscar = vi.fn((url: string) => {
    urls.push(url);

    if (url.includes("/api/caixa/sessoes")) {
      return Promise.resolve(json(200, { sessoes }));
    }

    return Promise.resolve(json(200, { id: "u1", nome: "Ana", permissoes: [] }));
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

  function Envolvido(): ReactNode {
    return (
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <Caixas />
      </ProvedorSessao>
    );
  }

  render(<Envolvido />);

  return { urls };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("lista de caixas", () => {
  it("🔑 caixa aberto não aparece como se tivesse batido", async () => {
    // Um zero na coluna de diferença seria lido como "conferido e certo".
    montar([ABERTA]);

    expect(await screen.findByText("Ainda não conferido")).toBeInTheDocument();
    expect(screen.queryByText("Bateu")).not.toBeInTheDocument();
  });

  it("🔑 falta é nomeada, não só sinalizada", async () => {
    montar([COM_FALTA]);

    expect(await screen.findByText("Falta de R$ 20,00")).toBeInTheDocument();
  });

  it("sobra é distinguida de falta", async () => {
    montar([{ ...COM_FALTA, contadoEmDinheiro: "37000", divergenciaEmDinheiro: "2000" }]);

    expect(await screen.findByText("Sobra de R$ 20,00")).toBeInTheDocument();
  });

  it("caixa que bateu é dito com todas as letras", async () => {
    montar([BATEU]);

    expect(await screen.findByText("Bateu")).toBeInTheDocument();
  });

  it("mostra as parcelas que explicam o esperado", async () => {
    montar([COM_FALTA]);

    expect(await screen.findByText("Fundo")).toBeInTheDocument();
    expect(screen.getByText("Recebido em dinheiro")).toBeInTheDocument();
    expect(screen.getByText("Sangrias")).toBeInTheDocument();
    expect(screen.getByText("Esperado")).toBeInTheDocument();
  });

  it("concorda em número com uma venda só", async () => {
    montar([COM_FALTA]);

    expect(await screen.findByText(/1 venda ·/)).toBeInTheDocument();
  });

  it("período sem caixa não é erro", async () => {
    montar([]);

    expect(await screen.findByText("Nenhum caixa no período")).toBeInTheDocument();
  });
});

describe("período", () => {
  it("🔑 abre no dia de hoje, não no histórico inteiro", async () => {
    // Numa loja com dois anos de operação, o padrão aberto traria centenas de
    // sessões para a tela montar.
    const hoje = new Date().toISOString().slice(0, 10);
    const { urls } = montar([]);

    await screen.findByText("Nenhum caixa no período");

    expect(urls.some((url) => url.includes(`de=${hoje}&ate=${hoje}`))).toBe(true);
  });

  it("buscar usa as datas escolhidas", async () => {
    const { urls } = montar([]);
    await screen.findByText("Nenhum caixa no período");

    const usuario = userEvent.setup();
    await usuario.clear(screen.getByLabelText(/^De/));
    await usuario.type(screen.getByLabelText(/^De/), "2026-07-01");
    await usuario.click(screen.getByRole("button", { name: "Buscar" }));

    await screen.findByText("Nenhum caixa no período");

    expect(urls.some((url) => url.includes("de=2026-07-01"))).toBe(true);
  });

  it("falha do servidor vira mensagem, não tela em branco", async () => {
    const buscar = vi.fn((url: string) =>
      Promise.resolve(
        url.includes("/api/caixa/sessoes")
          ? json(403, { erro: { codigo: "NEGADO", mensagem: "Sem permissão." } })
          : json(200, { id: "u1", nome: "Ana", permissoes: [] }),
      ),
    );

    const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

    render(
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <Caixas />
      </ProvedorSessao>,
    );

    expect(await screen.findByText("Sem permissão.")).toBeInTheDocument();
  });
});
