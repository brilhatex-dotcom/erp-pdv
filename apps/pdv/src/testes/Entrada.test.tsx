import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { definirAgenteParaTeste } from "../balcao.js";
import { bipar, campoDeCodigo, montar, pularOrientacao } from "./servidorFalso.js";

/**
 * A entrada no caixa, do ponto de vista de quem opera.
 *
 * O que se verifica é o **fluxo em teclas**: o CLAUDE.md dá veto ao papel UX
 * sobre qualquer fluxo que exija mouse no PDV, e a única forma de garantir isso
 * é exercitar a entrada pelo teclado, como o operador faz com a fila esperando.
 */

beforeEach(() => {
  globalThis.localStorage.clear();
  pularOrientacao();
  definirAgenteParaTeste(undefined);
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
});

describe("entrada no caixa", () => {
  it("🔑 pede PIN, não senha longa", async () => {
    // O balcão troca de operador com fila esperando. Senha de doze caracteres
    // aqui faz a equipe compartilhar login, e a auditoria deixa de valer
    // (ADR-0011).
    montar({ autenticado: false });

    await waitFor(() => {
      expect(screen.getByLabelText(/PIN/)).toBeVisible();
    });
    expect(screen.queryByLabelText(/Senha/)).not.toBeInTheDocument();
  });

  it("🔑 o login declara contexto PDV — é o que faz o PIN ser conferido", async () => {
    const { servidor, usuario } = montar({ autenticado: false });

    await usuario.type(await screen.findByLabelText(/Matrícula/), "42");
    await usuario.type(screen.getByLabelText(/PIN/), "419273{Enter}");
    await campoDeCodigo();

    expect(servidor.chamadasA("POST /api/acesso/login")[0]?.corpo).toMatchObject({
      matricula: "42",
      contexto: "PDV",
    });
  });

  it("🔑 PIN incompleto não vira tentativa — o bloqueio não pode ser gasto à toa", async () => {
    const { servidor, usuario } = montar({ autenticado: false });

    await usuario.type(await screen.findByLabelText(/Matrícula/), "42");
    await usuario.type(screen.getByLabelText(/PIN/), "419{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("O PIN tem 6 números");
    });
    expect(servidor.chamadasA("POST /api/acesso/login")).toHaveLength(0);
    expect(screen.getByLabelText(/PIN/)).toHaveFocus();
  });

  it("sem matrícula, o PIN completo também não vai ao servidor", async () => {
    const { servidor, usuario } = montar({ autenticado: false });

    await usuario.type(await screen.findByLabelText(/PIN/), "419273{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Informe a matrícula");
    });
    expect(servidor.chamadasA("POST /api/acesso/login")).toHaveLength(0);
    expect(screen.getByLabelText(/Matrícula/)).toHaveFocus();
  });

  it("🔑 não pisca o login para quem já está autenticado", async () => {
    montar();

    expect(screen.getByRole("status")).toHaveTextContent("Carregando sua sessão…");
    expect(screen.queryByLabelText(/PIN/)).not.toBeInTheDocument();

    await campoDeCodigo();
  });

  it("PIN errado mostra a mensagem do servidor e mantém a matrícula", async () => {
    const { usuario } = montar({ autenticado: false });

    await usuario.type(await screen.findByLabelText(/Matrícula/), "42");
    await usuario.type(screen.getByLabelText(/PIN/), "482913{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Matrícula ou PIN incorreto.");
    });
    expect(screen.getByLabelText(/Matrícula/)).toHaveValue("42");
    expect(screen.getByLabelText(/PIN/)).toHaveValue("");
  });

  it("🔑 entra com matrícula, Tab, PIN e Enter, e cai direto no balcão", async () => {
    const { usuario } = montar({ autenticado: false });

    await waitFor(() => {
      expect(screen.getByLabelText(/Matrícula/)).toHaveFocus();
    });

    await usuario.keyboard("42");
    await usuario.tab();
    await usuario.keyboard("419273{Enter}");

    expect(await campoDeCodigo()).toHaveFocus();
    expect(screen.getByText(/Maria da Silva/)).toBeVisible();
  });
});

describe("troca de operador", () => {
  it("encerra a sessão pelo menu do caixa e volta para a tela de PIN", async () => {
    // Troca de turno: o operador sai, o próximo entra com a matrícula dele — é
    // o que mantém cada venda atribuída a uma pessoa real.
    const { servidor, usuario } = montar();

    await campoDeCodigo();
    await usuario.click(screen.getByRole("button", { name: /Caixa: sangria/ }));
    await usuario.keyboard("7");

    await waitFor(() => {
      expect(screen.getByLabelText(/PIN/)).toBeVisible();
    });
    expect(servidor.chamadasA("POST /api/acesso/sair")).toHaveLength(1);
  });
});

describe("estação", () => {
  it("🔑 manda sempre a mesma estação, porque o caixa é por estação", async () => {
    // Só pode haver um caixa aberto por estação, e a série fiscal é por estação.
    // Identificador novo a cada venda faria a conferência do dia não fechar.
    const { servidor, usuario } = montar();

    await bipar(usuario, "7891000315507");
    await waitFor(() => {
      expect(screen.getAllByText("REFRI COLA 2L").length).toBeGreaterThan(0);
    });

    const estacao = servidor.chamadasA("POST /api/vendas")[0]?.corpo["estacaoId"];

    expect(estacao).toMatch(/^[0-9a-f-]{36}$/);
    expect(globalThis.localStorage.getItem("erp.estacao")).toBe(estacao);
    expect(
      servidor.chamadasA("GET /api/caixa/aberto")[0]?.consulta.get("estacaoId"),
    ).toBe(estacao);
  });
});
