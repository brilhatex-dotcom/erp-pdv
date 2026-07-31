import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";

import { App } from "../App.js";

/** Respostas indexadas por caminho, como o servidor devolveria. */
type Rotas = Record<string, () => Response>;

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const USUARIO_GERENTE = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
  nome: "Ana Gerente",
  matricula: "1",
  papel: "GERENTE",
  permissoes: ["venda:criar", "produto:ver_custo", "relatorio:margem"],
  precisaTrocarCredencial: false,
};

const USUARIO_OPERADOR = {
  ...USUARIO_GERENTE,
  nome: "Maria da Silva",
  matricula: "42",
  papel: "OPERADOR_CAIXA",
  permissoes: ["venda:criar"],
};

const PRODUTO = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002",
  sku: "REF001",
  descricao: "Refrigerante Cola 2 Litros",
  descricaoPdv: "REFRI COLA 2L",
  tipo: "UNITARIO" as const,
  unidade: "UN",
  precoVenda: "990",
  ativo: true,
};

function montarApp(rotas: Rotas) {
  const chamadas: string[] = [];

  const buscar = vi.fn((url: string) => {
    chamadas.push(url);
    const rota = rotas[url.split("?")[0] ?? url];
    return Promise.resolve(
      rota?.() ?? json(404, { erro: { codigo: "X", mensagem: "x" } }),
    );
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

  function Envolvido(): ReactNode {
    return (
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <App />
      </ProvedorSessao>
    );
  }

  return { ...render(<Envolvido />), chamadas };
}

/** Sem sessão para restaurar: cai no login. */
const SEM_SESSAO: Rotas = {
  "/api/acesso/eu": () => json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
  "/api/acesso/renovar": () =>
    json(401, { erro: { codigo: "SESSAO_INVALIDA", mensagem: "x" } }),
};

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("Restauração de sessão", () => {
  it("🔑 não pisca o login para quem já está autenticado", async () => {
    // O defeito clássico de SPA com token em memória: mostra o login por um
    // instante, assusta o usuário e o faz digitar a senha sem precisar.
    montarApp({ "/api/acesso/eu": () => json(200, USUARIO_GERENTE) });

    expect(screen.getByRole("status")).toHaveTextContent("Carregando sua sessão…");
    expect(screen.queryByRole("button", { name: "Entrar" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Ana Gerente/)).toBeVisible();
    });
  });

  it("cai no login quando não há sessão para restaurar", async () => {
    montarApp(SEM_SESSAO);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });
  });
});

describe("Login da retaguarda", () => {
  it("🔑 entra com matrícula e senha, e a tela passa a ser a retaguarda", async () => {
    montarApp({
      ...SEM_SESSAO,
      "/api/acesso/login": () => json(200, { token: "abc", usuario: USUARIO_GERENTE }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Matrícula/), "1");
    await userEvent.type(screen.getByLabelText(/Senha/), "cavalo bateria grampo");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Consultar produto" })).toBeVisible();
    });
  });

  it("🔑 dá para entrar só com o teclado, terminando em Enter", async () => {
    montarApp({
      ...SEM_SESSAO,
      "/api/acesso/login": () => json(200, { token: "abc", usuario: USUARIO_GERENTE }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Matrícula/)).toHaveFocus();
    });

    await userEvent.keyboard("1");
    await userEvent.tab();
    await userEvent.keyboard("cavalo bateria grampo{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Consultar produto" })).toBeVisible();
    });
  });

  it("🔑 credencial errada mostra a mensagem do servidor e limpa só a senha", async () => {
    // Quem errou a senha redigita só ela; quem errou a matrícula a corrige sem
    // apagar tudo.
    montarApp({
      ...SEM_SESSAO,
      "/api/acesso/login": () =>
        json(401, {
          erro: {
            codigo: "CREDENCIAL_INVALIDA",
            mensagem: "Matrícula ou senha incorreta.",
          },
        }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Matrícula/), "1");
    await userEvent.type(screen.getByLabelText(/Senha/), "errada-mas-longa");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Matrícula ou senha incorreta.",
      );
    });

    expect(screen.getByLabelText(/Matrícula/)).toHaveValue("1");
    expect(screen.getByLabelText(/Senha/)).toHaveValue("");
    expect(screen.getByLabelText(/Matrícula/)).toHaveFocus();
  });

  it("🔑 bloqueio chega como mensagem acionável, não como código", async () => {
    montarApp({
      ...SEM_SESSAO,
      "/api/acesso/login": () =>
        json(429, {
          erro: {
            codigo: "USUARIO_BLOQUEADO",
            mensagem: "Acesso bloqueado por mais 12 minutos. Chame o supervisor.",
          },
        }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Matrícula/), "1");
    await userEvent.type(screen.getByLabelText(/Senha/), "qualquer-coisa-longa");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Chame o supervisor");
    });
    expect(screen.getByRole("alert").textContent).not.toMatch(/429|USUARIO_BLOQUEADO/);
  });

  it("🔑 rede caída não mostra 'Failed to fetch'", async () => {
    const buscar = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const cliente = new ClienteApi(new Sessao(), "", buscar);

    render(
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <App />
      </ProvedorSessao>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Matrícula/), "1");
    await userEvent.type(screen.getByLabelText(/Senha/), "senha-bem-longa-aqui");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Sem conexão com o servidor");
    });
  });
});

describe("Consulta de produto", () => {
  async function entrarComo(usuario: typeof USUARIO_GERENTE, extras: Rotas = {}) {
    const app = montarApp({ "/api/acesso/eu": () => json(200, usuario), ...extras });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Consultar produto" })).toBeVisible();
    });

    return app;
  }

  it("🔑 mostra o produto encontrado com o preço formatado", async () => {
    await entrarComo(USUARIO_GERENTE, {
      "/api/produtos/buscar": () => json(200, { ...PRODUTO, custo: "650" }),
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "7891000315507");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(screen.getByText("R$ 9,90")).toBeVisible();
  });

  it("🔑 o operador não vê custo; o gerente vê", async () => {
    // O servidor é quem decide: para o operador, o campo nem vem na resposta.
    const semCusto = await entrarComo(USUARIO_OPERADOR, {
      "/api/produtos/buscar": () => json(200, PRODUTO),
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "REF001");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("R$ 9,90")).toBeVisible();
    });
    expect(screen.queryByText("Custo")).not.toBeInTheDocument();

    semCusto.unmount();

    await entrarComo(USUARIO_GERENTE, {
      "/api/produtos/buscar": () => json(200, { ...PRODUTO, custo: "650" }),
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "REF001");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Custo")).toBeVisible();
    });
    expect(screen.getByText("R$ 6,50")).toBeVisible();
  });

  it("🔑 produto inexistente é estado vazio, não erro", async () => {
    // Tratar 404 como falha faria a tela oferecer "tentar de novo" para um
    // código que simplesmente não existe.
    await entrarComo(USUARIO_GERENTE, {
      "/api/produtos/buscar": () =>
        json(404, {
          erro: { codigo: "PRODUTO_NAO_ENCONTRADO", mensagem: "Produto não encontrado." },
        }),
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "0000000000000");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Produto não encontrado")).toBeVisible();
    });
    expect(screen.getByText(/0000000000000/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Tentar de novo" }),
    ).not.toBeInTheDocument();
  });

  it("🔑 falha de verdade oferece repetir", async () => {
    await entrarComo(USUARIO_GERENTE, {
      "/api/produtos/buscar": () =>
        json(500, {
          erro: {
            codigo: "FALHA_INTERNA",
            mensagem: "Não foi possível concluir a operação.",
          },
        }),
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "REF001");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível concluir");
    });
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  });

  it("🔑 o botão de repetir busca de novo, sem redigitar o código", async () => {
    // O caminho de mouse da tela de falha. Oferecer "Tentar de novo" e não
    // repetir a busca é pior que não oferecer: o operador clica, nada muda, e
    // ele conclui que o sistema travou. O código bipado continua no campo, e é
    // ele que a segunda tentativa usa.
    let tentativas = 0;

    await entrarComo(USUARIO_GERENTE, {
      "/api/produtos/buscar": () => {
        tentativas += 1;
        return tentativas === 1
          ? json(500, { erro: { codigo: "FALHA_INTERNA", mensagem: "Falhou." } })
          : json(200, PRODUTO);
      },
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "REF001");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(tentativas).toBe(2);
  });

  it("identifica o pesável, que é vendido por peso e não por unidade", async () => {
    // Confundir pesável com unitário no balcão significa cobrar o preço do
    // quilo por uma peça — ou o contrário.
    await entrarComo(USUARIO_GERENTE, {
      "/api/produtos/buscar": () =>
        json(200, { ...PRODUTO, tipo: "PESAVEL", unidade: "KG" }),
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "REF001");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText(/Pesável/)).toBeVisible();
    });
  });

  it("marca produto inativo com texto, não só com cor", async () => {
    await entrarComo(USUARIO_GERENTE, {
      "/api/produtos/buscar": () => json(200, { ...PRODUTO, ativo: false }),
    });

    await userEvent.type(screen.getByLabelText("Código do produto"), "REF001");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Inativo")).toBeVisible();
    });
  });

  it("não busca com o campo vazio", async () => {
    const { chamadas } = await entrarComo(USUARIO_GERENTE);
    const antes = chamadas.length;

    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));

    expect(chamadas).toHaveLength(antes);
  });
});

describe("Sair", () => {
  it("encerra a sessão e volta para o login", async () => {
    montarApp({
      "/api/acesso/eu": () => json(200, USUARIO_GERENTE),
      "/api/acesso/sair": () => new Response(null, { status: 204 }),
    });

    await waitFor(() => {
      expect(screen.getByText(/Ana Gerente/)).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });
  });

  it("🔑 a sessão local cai mesmo se o servidor não responder", async () => {
    // Deixar o usuário "logado" numa tela cuja sessão já não vale é pior do
    // que pedir o login de novo.
    montarApp({
      "/api/acesso/eu": () => json(200, USUARIO_GERENTE),
      "/api/acesso/sair": () => json(500, { erro: { codigo: "X", mensagem: "falhou" } }),
      "/api/acesso/renovar": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByText(/Ana Gerente/)).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });
  });
});
