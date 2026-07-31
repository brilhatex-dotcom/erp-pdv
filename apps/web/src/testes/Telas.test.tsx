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

const CLIENTE = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0003",
  nome: "Ana Maria de Souza",
  exibicao: "Ana Maria de Souza",
  documento: "52998224725",
  telefone: "19998887766",
  limiteCredito: "50000",
  vendeAPrazo: true,
  ativo: true,
};

const GERENTE_COM_LIMITE = {
  ...USUARIO_GERENTE,
  permissoes: [
    ...USUARIO_GERENTE.permissoes,
    "cliente:consultar",
    "cliente:cadastrar",
    "cliente:editar",
    "cliente:definir_limite",
  ],
};

const OPERADOR_BALCAO = {
  ...USUARIO_OPERADOR,
  permissoes: ["venda:criar", "cliente:consultar", "cliente:cadastrar"],
};

/**
 * Arnês que distingue o método.
 *
 * `montarApp` indexa só por caminho, e `GET /api/clientes` e `POST
 * /api/clientes` têm o mesmo — sem isto, um cadastro recusado pelo servidor
 * seria contado como sucesso pelo teste.
 */
function montarComMetodo(rotas: Record<string, () => Response>) {
  const corpos: Array<{ url: string; metodo: string; corpo: unknown }> = [];

  const buscar = vi.fn((url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const caminho = url.split("?")[0] ?? url;

    corpos.push({
      url: caminho,
      metodo,
      corpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });

    const rota = rotas[`${metodo} ${caminho}`];
    return Promise.resolve(
      rota?.() ?? json(404, { erro: { codigo: "X", mensagem: "Não encontrado." } }),
    );
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

  render(
    <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
      <App />
    </ProvedorSessao>,
  );

  return { corpos };
}

async function irParaNovoCliente(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Clientes" })).toBeVisible();
  });
  await userEvent.click(screen.getByRole("button", { name: "Clientes" }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Novo cliente" })).toBeVisible();
  });
  await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
}

async function abrirClientes(usuario: typeof USUARIO_GERENTE, extras: Rotas = {}) {
  const app = montarApp({ "/api/acesso/eu": () => json(200, usuario), ...extras });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Clientes" })).toBeVisible();
  });

  await userEvent.click(screen.getByRole("button", { name: "Clientes" }));

  return app;
}

describe("Cadastro de clientes", () => {
  it("🔑 abre listando, não com o formulário em branco", async () => {
    // É o que empurra o usuário a procurar antes de cadastrar. Formulário em
    // branco na abertura convida ao cadastro em duplicidade — e aí o histórico
    // de compra fica dividido entre dois registros.
    await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () => json(200, { itens: [CLIENTE] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Ana Maria de Souza")).toBeVisible();
    });

    expect(screen.getByLabelText(/Procurar por nome/)).toBeVisible();
    expect(screen.queryByLabelText(/^Nome/)).not.toBeInTheDocument();
  });

  it("mostra o limite formatado de quem vende a prazo, e traço de quem não vende", async () => {
    await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () =>
        json(200, {
          itens: [
            CLIENTE,
            {
              ...CLIENTE,
              id: "outro",
              exibicao: "Bruno Alves",
              limiteCredito: "0",
              vendeAPrazo: false,
            },
          ],
        }),
    });

    await waitFor(() => {
      expect(screen.getByText("R$ 500,00")).toBeVisible();
    });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("lista vazia é estado vazio, com o texto certo para busca sem resultado", async () => {
    await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () => json(200, { itens: [] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Nenhum cliente encontrado")).toBeVisible();
    });
    expect(screen.getByText(/Ainda não há clientes/)).toBeVisible();

    await userEvent.type(screen.getByLabelText(/Procurar por nome/), "zzz{Enter}");

    await waitFor(() => {
      expect(screen.getByText(/Nada para "zzz"/)).toBeVisible();
    });
  });

  it("🔑 falha ao listar oferece repetir, sem tela branca", async () => {
    let falhar = true;

    await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () =>
        falhar
          ? json(500, { erro: { codigo: "X", mensagem: "Servidor indisponível." } })
          : json(200, { itens: [CLIENTE] }),
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Servidor indisponível.");
    });

    falhar = false;
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => {
      expect(screen.getByText("Ana Maria de Souza")).toBeVisible();
    });
  });

  it("🔑 o operador não vê o campo de limite de crédito", async () => {
    // Esconder é experiência, não segurança: o servidor recusa o limite de quem
    // não tem a permissão. O campo some para não oferecer algo que seria
    // recusado depois de preenchido.
    await abrirClientes(OPERADOR_BALCAO, {
      "/api/clientes": () => json(200, { itens: [] }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo cliente" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));

    expect(screen.getByLabelText(/^Nome/)).toBeVisible();
    expect(screen.queryByLabelText(/Limite de crédito/)).not.toBeInTheDocument();
  });

  it("🔑 o gerente vê o campo, e o limite vai em centavos — nunca em reais", async () => {
    // Mandar "500,00" faria o servidor gravar R$ 5,00 de teto, e o erro só
    // apareceria quando a venda a prazo fosse recusada no balcão.
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_COM_LIMITE),
      "GET /api/clientes": () => json(200, { itens: [] }),
      "POST /api/clientes": () => json(201, CLIENTE),
    });

    await irParaNovoCliente();

    await userEvent.type(screen.getByLabelText(/^Nome/), "Ana Maria de Souza");
    await userEvent.clear(screen.getByLabelText(/Limite de crédito/));
    await userEvent.type(screen.getByLabelText(/Limite de crédito/), "500,00");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      nome: "Ana Maria de Souza",
      limiteCredito: "50000",
    });
  });

  it("🔑 o tipo de pessoa vem do documento, não de uma pergunta a mais", async () => {
    // Onze dígitos é CPF, catorze é CNPJ. Pedir que o usuário classifique o que
    // o próprio número já diz é atrito sem informação nova.
    const corpos: unknown[] = [];

    const buscar = vi.fn((url: string, init?: RequestInit) => {
      if (typeof init?.body === "string") corpos.push(JSON.parse(init.body));
      if (url === "/api/acesso/eu") return Promise.resolve(json(200, GERENTE_COM_LIMITE));
      return Promise.resolve(json(200, { itens: [] }));
    });

    const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

    render(
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <App />
      </ProvedorSessao>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clientes" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Clientes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo cliente" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));

    await userEvent.type(screen.getByLabelText(/^Nome/), "Padaria do Bairro");
    await userEvent.type(screen.getByLabelText(/CPF ou CNPJ/), "11222333000181");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(
        corpos.some((c) => (c as { tipoPessoa?: string }).tipoPessoa === "JURIDICA"),
      ).toBe(true);
    });
  });

  it("nome vazio é recusado antes de chamar o servidor", async () => {
    const { chamadas } = await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () => json(200, { itens: [] }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo cliente" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));

    const antes = chamadas.length;
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Informe o nome");
    });
    expect(chamadas).toHaveLength(antes);
  });

  it("limite malformado é recusado antes de chamar o servidor", async () => {
    const { chamadas } = await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () => json(200, { itens: [] }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo cliente" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo cliente" }));

    await userEvent.type(screen.getByLabelText(/^Nome/), "Ana");
    await userEvent.clear(screen.getByLabelText(/Limite de crédito/));
    await userEvent.type(screen.getByLabelText(/Limite de crédito/), "abc");

    const antes = chamadas.length;
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Limite de crédito inválido");
    });
    expect(chamadas).toHaveLength(antes);
  });

  it("🔑 recusa do servidor aparece na tela sem perder o que foi digitado", async () => {
    // Refazer o formulário inteiro porque o CPF já existia é o tipo de atrito
    // que faz o usuário cadastrar de novo com o campo em branco — exatamente a
    // duplicidade que a tela tenta evitar.
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_COM_LIMITE),
      "GET /api/clientes": () => json(200, { itens: [] }),
      "POST /api/clientes": () =>
        json(409, {
          erro: {
            codigo: "CLIENTE_DOCUMENTO_DUPLICADO",
            mensagem: "Já existe cliente com este documento.",
          },
        }),
    });

    await irParaNovoCliente();
    await userEvent.type(screen.getByLabelText(/^Nome/), "Ana Maria de Souza");
    await userEvent.type(screen.getByLabelText(/CPF ou CNPJ/), "52998224725");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Já existe cliente com este documento.",
      );
    });

    expect(screen.getByLabelText(/^Nome/)).toHaveValue("Ana Maria de Souza");
    expect(screen.getByLabelText(/CPF ou CNPJ/)).toHaveValue("52998224725");
  });

  it("editar abre o formulário preenchido e volta com Cancelar", async () => {
    await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () => json(200, { itens: [CLIENTE] }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText(/^Nome/)).toHaveValue("Ana Maria de Souza");
    expect(screen.getByLabelText(/Limite de crédito/)).toHaveValue("500,00");

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Procurar por nome/)).toBeVisible();
    });
  });

  it("🔑 quem não pode consultar cliente não vê a aba", async () => {
    montarApp({ "/api/acesso/eu": () => json(200, USUARIO_OPERADOR) });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Produtos" })).toBeVisible();
    });

    expect(screen.queryByRole("button", { name: "Clientes" })).not.toBeInTheDocument();
  });

  it("cliente inativo é marcado com texto, não só com cor", async () => {
    await abrirClientes(GERENTE_COM_LIMITE, {
      "/api/clientes": () => json(200, { itens: [{ ...CLIENTE, ativo: false }] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Inativo")).toBeVisible();
    });
  });
});

describe("Edição de cliente", () => {
  it("🔑 salvar manda PUT com o estado completo e volta para a lista", async () => {
    // `PUT` com o registro inteiro, não `PATCH` campo a campo: mandar só o que
    // mudou exigiria que a tela controlasse o que está sujo, e o primeiro erro
    // nesse controle apaga um campo sem ninguém perceber.
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_COM_LIMITE),
      "GET /api/clientes": () => json(200, { itens: [CLIENTE] }),
      "PUT /api/clientes/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0003": () => json(200, CLIENTE),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clientes" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Clientes" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    await userEvent.clear(screen.getByLabelText(/^Nome/));
    await userEvent.type(screen.getByLabelText(/^Nome/), "Ana Maria de Souza Lima");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Procurar por nome/)).toBeVisible();
    });

    const enviado = corpos.find((c) => c.metodo === "PUT");
    expect(enviado?.corpo).toMatchObject({
      nome: "Ana Maria de Souza Lima",
      documento: "52998224725",
      telefone: "19998887766",
      limiteCredito: "50000",
      ativo: true,
    });
  });

  it("cliente sem documento nem telefone aparece com traço e é salvo sem os campos", async () => {
    const semDados = {
      ...CLIENTE,
      documento: undefined,
      telefone: undefined,
      limiteCredito: "0",
      vendeAPrazo: false,
    };

    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_COM_LIMITE),
      "GET /api/clientes": () => json(200, { itens: [semDados] }),
      "PUT /api/clientes/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0003": () => json(200, semDados),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clientes" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Clientes" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });
    // Duas colunas com traço: documento e limite.
    expect(screen.getAllByText("—")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "PUT")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado).not.toHaveProperty("documento");
    expect(enviado).not.toHaveProperty("telefone");
    // Limite zero **vai**: é a diferença entre "não mexer" e "não vende a prazo".
    expect(enviado["limiteCredito"]).toBe("0");
  });

  it("🔑 limite sem casas decimais é reais, não centavos", async () => {
    // "500" é R$ 500,00. A leitura inversa daria ao cliente um teto de R$ 5,00,
    // e o erro só apareceria quando a venda a prazo fosse recusada no balcão.
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_COM_LIMITE),
      "GET /api/clientes": () => json(200, { itens: [] }),
      "POST /api/clientes": () => json(201, CLIENTE),
    });

    await irParaNovoCliente();

    await userEvent.type(screen.getByLabelText(/^Nome/), "Ana");
    await userEvent.clear(screen.getByLabelText(/Limite de crédito/));
    await userEvent.type(screen.getByLabelText(/Limite de crédito/), "500");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      limiteCredito: "50000",
    });
  });
});
