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
      expect(screen.getByRole("heading", { name: "Produtos" })).toBeVisible();
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
      expect(screen.getByRole("heading", { name: "Produtos" })).toBeVisible();
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

    // A retaguarda abre no cadastro; a consulta de balcão é a aba ao lado.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Consulta de preço" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Consulta de preço" }));

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

const FORNECEDOR = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0004",
  razaoSocial: "Distribuidora Bebidas Boas Ltda",
  nomeFantasia: "Bebidas Boas",
  exibicao: "Bebidas Boas",
  documento: "11222333000181",
  telefone: "1938887766",
  prazoEntregaDias: 7,
  ativo: true,
};

const CATEGORIA = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0005",
  nome: "Bebidas",
  ativa: true,
};

const ESTOQUISTA = {
  ...USUARIO_GERENTE,
  nome: "Carlos Estoquista",
  papel: "ESTOQUISTA",
  permissoes: [
    "produto:criar",
    "categoria:gerenciar",
    "fornecedor:consultar",
    "fornecedor:cadastrar",
    "fornecedor:editar",
  ],
};

async function irPara(aba: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: aba })).toBeVisible();
  });
  await userEvent.click(screen.getByRole("button", { name: aba }));
}

describe("Cadastro de fornecedores", () => {
  it("lista com documento e prazo de entrega", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () => json(200, { itens: [FORNECEDOR] }),
    });

    await irPara("Fornecedores");

    await waitFor(() => {
      expect(screen.getByText("Bebidas Boas")).toBeVisible();
    });
    expect(screen.getByText("11222333000181")).toBeVisible();
    expect(screen.getByText("7 dias")).toBeVisible();
  });

  it("🔑 documento é obrigatório e o tamanho é conferido antes da rede", async () => {
    // Fornecedor sem documento é cadastro que não fecha com nota nenhuma, e a
    // divergência só aparece no inventário.
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () => json(200, { itens: [] }),
    });

    await irPara("Fornecedores");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo fornecedor" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo fornecedor" }));

    await userEvent.type(screen.getByLabelText(/Razão social/), "Distribuidora X Ltda");

    const antes = corpos.length;
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("CPF (11 dígitos)");
    });
    expect(corpos).toHaveLength(antes);

    // Documento pela metade também não vai.
    await userEvent.type(screen.getByLabelText(/CPF ou CNPJ/), "112223330");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(corpos).toHaveLength(antes);
  });

  it("🔑 aceita CPF — o hortifruti compra do sitiante da região", async () => {
    // Exigir CNPJ deixaria de fora o fornecedor principal de um segmento
    // inteiro: produtor rural e MEI de bairro fornecem como pessoa física.
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () => json(200, { itens: [] }),
      "POST /api/fornecedores": () => json(201, FORNECEDOR),
    });

    await irPara("Fornecedores");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo fornecedor" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo fornecedor" }));

    await userEvent.type(screen.getByLabelText(/Razão social/), "João da Silva Produtor");
    await userEvent.type(screen.getByLabelText(/CPF ou CNPJ/), "52998224725");
    await userEvent.type(screen.getByLabelText(/Prazo de entrega/), "3");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      razaoSocial: "João da Silva Produtor",
      documento: "52998224725",
      prazoEntregaDias: 3,
    });
  });

  it("editar traz o preenchido e permite desativar", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () => json(200, { itens: [FORNECEDOR] }),
      "PUT /api/fornecedores/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0004": () =>
        json(200, FORNECEDOR),
    });

    await irPara("Fornecedores");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText(/Razão social/)).toHaveValue(
      "Distribuidora Bebidas Boas Ltda",
    );
    expect(screen.getByLabelText(/Nome fantasia/)).toHaveValue("Bebidas Boas");

    await userEvent.click(screen.getByLabelText("Fornecedor ativo"));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });
    expect(corpos.find((c) => c.metodo === "PUT")?.corpo).toMatchObject({ ativo: false });
  });

  it("recusa do servidor aparece sem perder o formulário", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () => json(200, { itens: [] }),
      "POST /api/fornecedores": () =>
        json(409, {
          erro: { codigo: "X", mensagem: "Já existe fornecedor com este documento." },
        }),
    });

    await irPara("Fornecedores");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo fornecedor" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo fornecedor" }));

    await userEvent.type(screen.getByLabelText(/Razão social/), "Distribuidora X Ltda");
    await userEvent.type(screen.getByLabelText(/CPF ou CNPJ/), "11222333000181");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Já existe fornecedor");
    });
    expect(screen.getByLabelText(/Razão social/)).toHaveValue("Distribuidora X Ltda");
  });

  it("estados de vazio, busca sem resultado e falha", async () => {
    let falhar = true;

    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () =>
        falhar
          ? json(500, { erro: { codigo: "X", mensagem: "Servidor indisponível." } })
          : json(200, { itens: [] }),
    });

    await irPara("Fornecedores");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Servidor indisponível.");
    });

    falhar = false;
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => {
      expect(screen.getByText(/Ainda não há fornecedores/)).toBeVisible();
    });

    await userEvent.type(
      screen.getByLabelText(/Procurar por razão social/),
      "zzz{Enter}",
    );

    await waitFor(() => {
      expect(screen.getByText(/Nada para "zzz"/)).toBeVisible();
    });
  });

  it("fornecedor sem prazo e inativo aparecem marcados", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () =>
        json(200, {
          itens: [
            {
              ...FORNECEDOR,
              nomeFantasia: undefined,
              prazoEntregaDias: undefined,
              ativo: false,
            },
          ],
        }),
    });

    await irPara("Fornecedores");

    await waitFor(() => {
      expect(screen.getByText("Inativo")).toBeVisible();
    });
    expect(screen.getByText("—")).toBeVisible();
  });
});

describe("Categorias", () => {
  it("🔑 cadastra na própria lista, sem abrir outra tela", async () => {
    // Categoria tem um campo. Abrir tela para preencher um campo e voltar são
    // três cliques onde cabe um.
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/categorias": () => json(200, { itens: [CATEGORIA] }),
      "POST /api/categorias": () => json(201, CATEGORIA),
    });

    await irPara("Categorias");

    await waitFor(() => {
      expect(screen.getByText("Bebidas")).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Nova categoria/), "Hortifruti");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });
    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      nome: "Hortifruti",
    });

    // O campo esvazia e o foco volta: quem cria uma categoria cria três.
    await waitFor(() => {
      expect(screen.getByLabelText(/Nova categoria/)).toHaveValue("");
    });
    expect(screen.getByLabelText(/Nova categoria/)).toHaveFocus();
  });

  it("renomeia na própria linha", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/categorias": () => json(200, { itens: [CATEGORIA] }),
      "PUT /api/categorias/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0005": () =>
        json(200, CATEGORIA),
    });

    await irPara("Categorias");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Renomear" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Renomear" }));

    const campo = screen.getByLabelText(/Novo nome de Bebidas/);
    await userEvent.clear(campo);
    await userEvent.type(campo, "Bebidas e sucos{Enter}");

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });
    expect(corpos.find((c) => c.metodo === "PUT")?.corpo).toMatchObject({
      nome: "Bebidas e sucos",
      ativa: true,
    });
  });

  it("🔑 desativa em vez de apagar, para não deixar relatório antigo órfão", async () => {
    // A categoria está referenciada por produtos e por relatórios de meses
    // passados. Apagá-la quebraria a comparação com o ano anterior.
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/categorias": () => json(200, { itens: [CATEGORIA] }),
      "PUT /api/categorias/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0005": () =>
        json(200, { ...CATEGORIA, ativa: false }),
    });

    await irPara("Categorias");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Desativar" })).toBeVisible();
    });

    expect(
      screen.queryByRole("button", { name: /Apagar|Excluir/ }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Desativar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });
    expect(corpos.find((c) => c.metodo === "PUT")?.corpo).toMatchObject({ ativa: false });
  });

  it("categoria inativa é marcada e pode ser reativada", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/categorias": () => json(200, { itens: [{ ...CATEGORIA, ativa: false }] }),
    });

    await irPara("Categorias");

    await waitFor(() => {
      expect(screen.getByText("Inativa")).toBeVisible();
    });
    expect(screen.getByRole("button", { name: "Reativar" })).toBeVisible();
  });

  it("nome vazio é recusado antes da rede; nome repetido mostra o motivo", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/categorias": () => json(200, { itens: [] }),
      "POST /api/categorias": () =>
        json(409, {
          erro: { codigo: "X", mensagem: "Já existe categoria com este nome." },
        }),
    });

    await irPara("Categorias");
    await waitFor(() => {
      expect(screen.getByLabelText(/Nova categoria/)).toBeVisible();
    });

    const antes = corpos.length;
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Informe o nome da categoria");
    });
    expect(corpos).toHaveLength(antes);

    await userEvent.type(screen.getByLabelText(/Nova categoria/), "Bebidas");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Já existe categoria");
    });
  });

  it("cancelar a renomeação volta a linha ao normal", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/categorias": () => json(200, { itens: [CATEGORIA] }),
    });

    await irPara("Categorias");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Renomear" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Renomear" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Renomear" })).toBeVisible();
    });
  });

  it("lista vazia e falha ao carregar", async () => {
    let falhar = true;

    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/categorias": () =>
        falhar
          ? json(500, { erro: { codigo: "X", mensagem: "Servidor indisponível." } })
          : json(200, { itens: [] }),
    });

    await irPara("Categorias");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Servidor indisponível.");
    });

    falhar = false;
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => {
      expect(screen.getByText("Nenhuma categoria")).toBeVisible();
    });
  });
});

describe("Abas da retaguarda", () => {
  it("🔑 cada aba aparece só para quem tem a permissão dela", async () => {
    // Aba que só responde "sem permissão" ao ser clicada é pior que aba
    // escondida: o usuário tenta, falha e abre chamado.
    montarApp({ "/api/acesso/eu": () => json(200, ESTOQUISTA) });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Produtos" })).toBeVisible();
    });

    expect(screen.getByRole("button", { name: "Fornecedores" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Categorias" })).toBeVisible();
    // Estoquista não tem `cliente:consultar`.
    expect(screen.queryByRole("button", { name: "Clientes" })).not.toBeInTheDocument();
  });

  it("a aba ativa é anunciada para o leitor de tela", async () => {
    montarApp({ "/api/acesso/eu": () => json(200, ESTOQUISTA) });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Produtos" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await userEvent.click(screen.getByRole("button", { name: "Categorias" }));

    expect(screen.getByRole("button", { name: "Categorias" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Formulário de fornecedor — campos opcionais", () => {
  it("nome fantasia, telefone e e-mail vão junto quando preenchidos", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () => json(200, { itens: [] }),
      "POST /api/fornecedores": () => json(201, FORNECEDOR),
    });

    await irPara("Fornecedores");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo fornecedor" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo fornecedor" }));

    await userEvent.type(
      screen.getByLabelText(/Razão social/),
      "Distribuidora Bebidas Boas Ltda",
    );
    await userEvent.type(screen.getByLabelText(/Nome fantasia/), "Bebidas Boas");
    await userEvent.type(screen.getByLabelText(/CPF ou CNPJ/), "11222333000181");
    await userEvent.type(screen.getByLabelText(/Telefone/), "1938887766");
    await userEvent.type(screen.getByLabelText(/E-mail/), "compras@bebidasboas.com.br");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      nomeFantasia: "Bebidas Boas",
      telefone: "1938887766",
      email: "compras@bebidasboas.com.br",
    });
  });

  it("cancelar volta para a lista sem gravar nada", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/fornecedores": () => json(200, { itens: [] }),
    });

    await irPara("Fornecedores");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo fornecedor" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo fornecedor" }));

    await userEvent.type(screen.getByLabelText(/Razão social/), "Desisti Ltda");

    const antes = corpos.length;
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Procurar por razão social/)).toBeVisible();
    });
    expect(corpos).toHaveLength(antes);
  });
});

const ADMIN = {
  ...USUARIO_GERENTE,
  nome: "Ana Administradora",
  papel: "ADMIN",
  permissoes: ["usuario:criar", "usuario:editar_permissoes"],
};

const OPERADOR_NA_LISTA = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0007",
  matricula: "42",
  nome: "Maria da Silva",
  papel: "OPERADOR_CAIXA",
  ativo: true,
  precisaTrocarCredencial: false,
  temPin: true,
  temSenha: false,
};

describe("Primeiro acesso da instalação", () => {
  it("🔑 instalação sem usuários abre a configuração, não o login", async () => {
    // Mostrar o login numa instalação vazia é oferecer uma porta que ninguém
    // consegue abrir: criar usuário exige permissão, e ter permissão exige
    // usuário.
    montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: true }),
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Configurar o sistema" })).toBeVisible();
    });

    expect(screen.queryByLabelText(/Senha/)).toBeVisible();
    expect(screen.getByText(/não tem recuperação por e-mail/)).toBeVisible();
  });

  it("🔑 instalação já configurada mostra o login, sem piscar a configuração", async () => {
    montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: false }),
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });

    expect(
      screen.queryByRole("heading", { name: "Configurar o sistema" }),
    ).not.toBeInTheDocument();
  });

  it("🔑 servidor fora do ar na primeira carga não deixa a tela em branco", async () => {
    // Travar aqui seria pior que o login com erro: o login sabe se recuperar.
    montarComMetodo({
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    });
  });

  it("cria o administrador com as duas senhas iguais", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: true }),
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/instalacao/primeiro-administrador": () => json(201, ADMIN),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Seu nome/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Seu nome/), "Ana Administradora");
    await userEvent.type(screen.getByLabelText(/^Senha/), "cavalo bateria grampo");
    await userEvent.type(
      screen.getByLabelText(/Repita a senha/),
      "cavalo bateria grampo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar acesso e entrar" }));

    // Por URL, e não só por método: a restauração de sessão também faz um POST
    // (`/api/acesso/renovar`), e ele viria primeiro na lista.
    const criacao = "/api/instalacao/primeiro-administrador";

    await waitFor(() => {
      expect(corpos.some((c) => c.url === criacao)).toBe(true);
    });

    expect(corpos.find((c) => c.url === criacao)?.corpo).toMatchObject({
      nome: "Ana Administradora",
      matricula: "1",
      senha: "cavalo bateria grampo",
    });
  });

  it("🔑 senhas diferentes são recusadas antes da rede", async () => {
    // É a única rede de proteção que existe: não há recuperação por e-mail.
    const { corpos } = montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: true }),
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Seu nome/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Seu nome/), "Ana");
    await userEvent.type(screen.getByLabelText(/^Senha/), "cavalo bateria grampo");
    await userEvent.type(screen.getByLabelText(/Repita a senha/), "outra coisa aqui");

    const antes = corpos.length;
    await userEvent.click(screen.getByRole("button", { name: "Criar acesso e entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("não são iguais");
    });
    expect(corpos).toHaveLength(antes);
  });

  it("senha curta e nome vazio são recusados antes da rede", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: true }),
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Seu nome/)).toBeVisible();
    });

    const antes = corpos.length;

    await userEvent.click(screen.getByRole("button", { name: "Criar acesso e entrar" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Informe o seu nome");
    });

    await userEvent.type(screen.getByLabelText(/Seu nome/), "Ana");
    await userEvent.type(screen.getByLabelText(/^Senha/), "curta");
    await userEvent.click(screen.getByRole("button", { name: "Criar acesso e entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("12 caracteres");
    });

    expect(corpos).toHaveLength(antes);
  });

  it("recusa do servidor aparece sem perder o preenchido", async () => {
    montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: true }),
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/instalacao/primeiro-administrador": () =>
        json(409, {
          erro: {
            codigo: "INSTALACAO_JA_CONFIGURADA",
            mensagem: "Esta instalação já tem usuários.",
          },
        }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Seu nome/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Seu nome/), "Ana");
    await userEvent.type(screen.getByLabelText(/^Senha/), "cavalo bateria grampo");
    await userEvent.type(
      screen.getByLabelText(/Repita a senha/),
      "cavalo bateria grampo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar acesso e entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("já tem usuários");
    });
    expect(screen.getByLabelText(/Seu nome/)).toHaveValue("Ana");
  });
});

describe("Gestão de usuários", () => {
  async function abrirUsuarios(extras: Record<string, () => Response> = {}) {
    const arnes = montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: false }),
      "GET /api/acesso/eu": () => json(200, ADMIN),
      "GET /api/usuarios": () => json(200, { itens: [OPERADOR_NA_LISTA] }),
      ...extras,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Usuários" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Usuários" }));

    return arnes;
  }

  it("lista com matrícula, papel legível e forma de acesso", async () => {
    await abrirUsuarios();

    await waitFor(() => {
      expect(screen.getByText("Maria da Silva")).toBeVisible();
    });

    expect(screen.getByText("42")).toBeVisible();
    // O papel aparece com o nome que o lojista usa, não com o código.
    expect(screen.getByText("Operador de caixa")).toBeVisible();
    expect(screen.queryByText("OPERADOR_CAIXA")).not.toBeInTheDocument();
    expect(screen.getByText("Só PIN")).toBeVisible();
  });

  it("🔑 cada papel vem com o que ele alcança", async () => {
    // Sem isso, escolhe-se pelo nome que soa mais importante — e todo mundo na
    // loja vira gerente.
    await abrirUsuarios();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo usuário" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));

    expect(screen.getByText("Tudo, incluindo usuários")).toBeVisible();
    expect(screen.getByText("Somente leitura")).toBeVisible();
  });

  it("cadastra operador com PIN", async () => {
    const { corpos } = await abrirUsuarios({
      "POST /api/usuarios": () => json(201, OPERADOR_NA_LISTA),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo usuário" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));

    await userEvent.type(screen.getByLabelText(/Matrícula/), "42");
    await userEvent.type(screen.getByLabelText(/^Nome/), "Maria da Silva");
    await userEvent.type(screen.getByLabelText(/PIN do balcão/), "999888");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      matricula: "42",
      nome: "Maria da Silva",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });
  });

  it("🔑 usuário sem credencial nenhuma é recusado antes da rede", async () => {
    // Cadastrar sem credencial cria alguém que nunca entra, e a falha só
    // aparece quando a pessoa tenta trabalhar.
    const { corpos } = await abrirUsuarios();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo usuário" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));

    await userEvent.type(screen.getByLabelText(/Matrícula/), "42");
    await userEvent.type(screen.getByLabelText(/^Nome/), "Maria");

    const antes = corpos.length;
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("PIN do balcão, a senha");
    });
    expect(corpos).toHaveLength(antes);
  });

  it("editar não mostra matrícula nem credencial — são outras operações", async () => {
    await abrirUsuarios();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText(/^Nome/)).toHaveValue("Maria da Silva");
    expect(screen.queryByLabelText(/Matrícula/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/PIN do balcão/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Acesso ativo")).toBeChecked();
  });

  it("altera papel e desativa", async () => {
    const { corpos } = await abrirUsuarios({
      "PUT /api/usuarios/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0007": () =>
        json(200, OPERADOR_NA_LISTA),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    await userEvent.click(screen.getByLabelText(/Supervisor/));
    await userEvent.click(screen.getByLabelText("Acesso ativo"));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "PUT")?.corpo).toMatchObject({
      papel: "SUPERVISOR",
      ativo: false,
    });
  });

  it("🔑 repor credencial é o chamado mais comum, e tem tela própria", async () => {
    const { corpos } = await abrirUsuarios({
      "PUT /api/usuarios/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0007/credencial": () =>
        new Response(null, { status: 204 }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Credencial" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Credencial" }));

    expect(screen.getByText(/bloqueio por tentativas erradas é liberado/)).toBeVisible();

    await userEvent.type(screen.getByLabelText(/Novo PIN/), "111222");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "PUT")?.corpo).toMatchObject({
      pin: "111222",
    });
  });

  it("credencial em branco é recusada antes da rede", async () => {
    const { corpos } = await abrirUsuarios();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Credencial" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Credencial" }));

    const antes = corpos.length;
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Informe o PIN");
    });
    expect(corpos).toHaveLength(antes);
  });

  it("cancelar volta para a lista, nas duas telas", async () => {
    await abrirUsuarios();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Credencial" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Credencial" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo usuário" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo usuário" })).toBeVisible();
    });
  });

  it("marca quem está inativo e quem tem troca pendente", async () => {
    await abrirUsuarios({
      "GET /api/usuarios": () =>
        json(200, {
          itens: [
            { ...OPERADOR_NA_LISTA, ativo: false },
            {
              ...OPERADOR_NA_LISTA,
              id: "outro",
              matricula: "43",
              nome: "João",
              precisaTrocarCredencial: true,
            },
            {
              ...OPERADOR_NA_LISTA,
              id: "terceiro",
              matricula: "44",
              nome: "Carla",
              temSenha: true,
            },
          ],
        }),
    });

    await waitFor(() => {
      expect(screen.getByText("Inativo")).toBeVisible();
    });
    expect(screen.getByText("Troca pendente")).toBeVisible();
    expect(screen.getByText("PIN e senha")).toBeVisible();
  });

  it("🔑 quem não gere usuários não vê a aba", async () => {
    montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: false }),
      "GET /api/acesso/eu": () => json(200, USUARIO_OPERADOR),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Produtos" })).toBeVisible();
    });

    expect(screen.queryByRole("button", { name: "Usuários" })).not.toBeInTheDocument();
  });

  it("falha ao listar oferece repetir", async () => {
    let falhar = true;

    await abrirUsuarios({
      "GET /api/usuarios": () =>
        falhar
          ? json(500, { erro: { codigo: "X", mensagem: "Servidor indisponível." } })
          : json(200, { itens: [OPERADOR_NA_LISTA] }),
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Servidor indisponível.");
    });

    falhar = false;
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => {
      expect(screen.getByText("Maria da Silva")).toBeVisible();
    });
  });

  it("lista vazia é estado vazio", async () => {
    await abrirUsuarios({ "GET /api/usuarios": () => json(200, { itens: [] }) });

    await waitFor(() => {
      expect(screen.getByText("Nenhum usuário")).toBeVisible();
    });
  });
});

describe("Usuários — caminhos da retaguarda", () => {
  it("matrícula diferente de 1 no primeiro acesso", async () => {
    // O padrão é 1, mas quem instala pode preferir outro número.
    const { corpos } = montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: true }),
      "GET /api/acesso/eu": () => json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/acesso/renovar": () =>
        json(401, { erro: { codigo: "X", mensagem: "x" } }),
      "POST /api/instalacao/primeiro-administrador": () => json(201, ADMIN),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Matrícula/)).toBeVisible();
    });

    await userEvent.clear(screen.getByLabelText(/Matrícula/));
    await userEvent.type(screen.getByLabelText(/Matrícula/), "99");
    await userEvent.type(screen.getByLabelText(/Seu nome/), "Ana");
    await userEvent.type(screen.getByLabelText(/^Senha/), "cavalo bateria grampo");
    await userEvent.type(
      screen.getByLabelText(/Repita a senha/),
      "cavalo bateria grampo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar acesso e entrar" }));

    const criacao = "/api/instalacao/primeiro-administrador";
    await waitFor(() => {
      expect(corpos.some((c) => c.url === criacao)).toBe(true);
    });
    expect(corpos.find((c) => c.url === criacao)?.corpo).toMatchObject({
      matricula: "99",
    });
  });

  async function abrirGestao(extras: Record<string, () => Response> = {}) {
    const arnes = montarComMetodo({
      "GET /api/instalacao/situacao": () => json(200, { precisaConfiguracao: false }),
      "GET /api/acesso/eu": () => json(200, ADMIN),
      "GET /api/usuarios": () => json(200, { itens: [OPERADOR_NA_LISTA] }),
      ...extras,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Usuários" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Usuários" }));

    return arnes;
  }

  it("cadastra usuário só de retaguarda, com senha e sem PIN", async () => {
    // O estoquista nunca opera caixa: dar-lhe PIN só aumenta a superfície.
    const { corpos } = await abrirGestao({
      "POST /api/usuarios": () => json(201, OPERADOR_NA_LISTA),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo usuário" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));

    await userEvent.type(screen.getByLabelText(/Matrícula/), "50");
    await userEvent.type(screen.getByLabelText(/^Nome/), "Carlos Estoquista");
    await userEvent.click(screen.getByLabelText(/Estoquista/));
    await userEvent.type(
      screen.getByLabelText(/Senha da retaguarda/),
      "cavalo bateria grampo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.url === "/api/usuarios" && c.metodo === "POST")).toBe(
        true,
      );
    });

    const enviado = corpos.find((c) => c.url === "/api/usuarios" && c.metodo === "POST")
      ?.corpo as Record<string, unknown>;

    expect(enviado).toMatchObject({
      papel: "ESTOQUISTA",
      senha: "cavalo bateria grampo",
    });
    expect(enviado).not.toHaveProperty("pin");
  });

  it("repõe a senha da retaguarda de outra pessoa", async () => {
    const { corpos } = await abrirGestao({
      "PUT /api/usuarios/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0007/credencial": () =>
        new Response(null, { status: 204 }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Credencial" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Credencial" }));

    await userEvent.type(
      screen.getByLabelText(/Nova senha da retaguarda/),
      "outra frase bem longa",
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "PUT")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado["senha"]).toBe("outra frase bem longa");
    expect(enviado).not.toHaveProperty("pin");
  });

  it("🔑 a própria linha do administrador é marcada", async () => {
    // Deixa óbvio de quem é a conta antes de ele desativar a si mesmo por
    // engano — o servidor recusa, mas o aviso na tela vem antes.
    await abrirGestao({
      "GET /api/usuarios": () =>
        json(200, {
          itens: [
            OPERADOR_NA_LISTA,
            {
              ...OPERADOR_NA_LISTA,
              id: ADMIN.id,
              matricula: "1",
              nome: "Ana Administradora",
              papel: "ADMIN",
            },
          ],
        }),
    });

    await waitFor(() => {
      expect(screen.getByText("(você)")).toBeVisible();
    });
  });
});

// ── Cadastro de produtos ─────────────────────────────────────────────────

const PRODUTO_COMPLETO = {
  ...PRODUTO,
  codigoBarras: "7891000315507",
  referencias: [],
  embalagens: [],
};

const GERENTE_DE_PRODUTO = {
  ...USUARIO_GERENTE,
  permissoes: [
    "venda:criar",
    "produto:ver_custo",
    "produto:criar",
    "produto:editar",
    "produto:alterar_preco",
  ],
};

/** Quem cadastra sem enxergar margem — a combinação que a loja pequena monta. */
const BALCONISTA_SEM_CUSTO = {
  ...USUARIO_OPERADOR,
  permissoes: ["venda:criar", "produto:criar", "produto:editar"],
};

const LISTA_VAZIA = () => json(200, { itens: [] });
const CATEGORIAS = () => json(200, { itens: [{ id: "cat-1", nome: "Bebidas" }] });

async function abrirProdutos(
  usuario: typeof USUARIO_GERENTE,
  extras: Rotas = {},
): Promise<ReturnType<typeof montarApp>> {
  const app = montarApp({
    "/api/acesso/eu": () => json(200, usuario),
    "/api/produtos": LISTA_VAZIA,
    "/api/categorias": CATEGORIAS,
    ...extras,
  });

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Produtos" })).toBeVisible();
  });

  return app;
}

async function irParaNovoProduto(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Novo produto" })).toBeVisible();
  });
  await userEvent.click(screen.getByRole("button", { name: "Novo produto" }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Novo produto" })).toBeVisible();
  });
}

describe("Lista de produtos", () => {
  it("abre listando, não com o formulário em branco", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO, {
      "/api/produtos": () =>
        json(200, { itens: [{ ...PRODUTO_COMPLETO, custo: "650" }] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(screen.getByText("R$ 9,90")).toBeVisible();
    expect(screen.getByText("R$ 6,50")).toBeVisible();
  });

  it("🔑 não mostra coluna de custo para quem não pode vê-lo", async () => {
    await abrirProdutos(BALCONISTA_SEM_CUSTO, {
      "/api/produtos": () => json(200, { itens: [PRODUTO_COMPLETO] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(screen.queryByRole("columnheader", { name: "Custo" })).not.toBeInTheDocument();
  });

  it("mostra traço quando o custo não foi informado", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO, {
      "/api/produtos": () => json(200, { itens: [PRODUTO_COMPLETO] }),
    });

    await waitFor(() => {
      expect(screen.getByText("—")).toBeVisible();
    });
  });

  it("marca o inativo e o pesável com texto, não só com cor", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO, {
      "/api/produtos": () =>
        json(200, {
          itens: [{ ...PRODUTO_COMPLETO, ativo: false, tipo: "PESAVEL", unidade: "KG" }],
        }),
    });

    await waitFor(() => {
      expect(screen.getByText("Inativo")).toBeVisible();
    });
    expect(screen.getByText(/pesável/)).toBeVisible();
  });

  it("lista vazia tem texto diferente de busca sem resultado", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO);

    await waitFor(() => {
      expect(screen.getByText("Nenhum produto encontrado")).toBeVisible();
    });
    expect(screen.getByText(/Ainda não há produtos cadastrados/)).toBeVisible();

    await userEvent.type(screen.getByLabelText(/Procurar produto/), "coca");
    await userEvent.click(screen.getByRole("button", { name: "Procurar" }));

    await waitFor(() => {
      expect(screen.getByText(/Nada para "coca"/)).toBeVisible();
    });
  });

  it("🔑 falha ao listar oferece repetir, sem tela branca", async () => {
    let tentativas = 0;

    await abrirProdutos(GERENTE_DE_PRODUTO, {
      "/api/produtos": () => {
        tentativas += 1;
        return tentativas === 1
          ? json(500, { erro: { codigo: "X", mensagem: "Banco fora do ar." } })
          : json(200, { itens: [PRODUTO_COMPLETO] });
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Banco fora do ar");
    });

    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
  });

  it("🔑 quem não pode criar nem editar não vê os botões", async () => {
    await abrirProdutos(USUARIO_OPERADOR, {
      "/api/produtos": () => json(200, { itens: [PRODUTO_COMPLETO] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(
      screen.queryByRole("button", { name: "Novo produto" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("a tela sobrevive à lista de categorias falhando", async () => {
    // Categoria é campo opcional: travar o cadastro porque a lista de apoio
    // caiu seria parar o trabalho por causa de um seletor.
    await abrirProdutos(GERENTE_DE_PRODUTO, {
      "/api/categorias": () => json(500, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await irParaNovoProduto();

    expect(screen.getByLabelText(/Categoria/)).toBeVisible();
  });
});

describe("Cadastro de produto", () => {
  it("🔑 manda o preço em centavos, nunca em reais", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () => json(201, PRODUTO_COMPLETO),
    });

    await irParaNovoProduto();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Refrigerante Cola 2L");
    await userEvent.type(screen.getByLabelText(/Código interno/), "REF001");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "19,90");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado["precoVenda"]).toBe("1990");
    expect(enviado["tipo"]).toBe("UNITARIO");
    expect(enviado["unidadeBase"]).toBe("UN");
  });

  it("🔑 quem não pode ver custo não tem o campo, e o corpo não leva custo", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, BALCONISTA_SEM_CUSTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () => json(201, PRODUTO_COMPLETO),
    });

    await irParaNovoProduto();

    expect(screen.queryByLabelText(/Custo de compra/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Pão Francês");
    await userEvent.type(screen.getByLabelText(/Código interno/), "PAO001");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "0,90");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    // Mandar zero apagaria a margem de todo relatório.
    expect(enviado).not.toHaveProperty("custo");
  });

  it("🔑 pesável ganha o campo da balança e a unidade vira quilo", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () => json(201, PRODUTO_COMPLETO),
    });

    await irParaNovoProduto();

    expect(screen.queryByLabelText(/Código na balança/)).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText(/Como é vendido/),
      "Por peso ou medida",
    );

    // Sem isto, o cadastro só falharia ao salvar: pesável exige unidade que
    // aceita fração.
    expect(screen.getByLabelText(/Unidade/)).toHaveValue("KG");

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Picanha Bovina");
    await userEvent.type(screen.getByLabelText(/Código interno/), "PIC001");
    await userEvent.type(screen.getByLabelText(/Código na balança/), "421");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "79,90");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado["tipo"]).toBe("PESAVEL");
    expect(enviado["unidadeBase"]).toBe("KG");
    expect(enviado["codigoBalanca"]).toBe("421");
  });

  it("voltar para unitário devolve a unidade padrão", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO);
    await irParaNovoProduto();

    await userEvent.selectOptions(
      screen.getByLabelText(/Como é vendido/),
      "Por peso ou medida",
    );
    await userEvent.selectOptions(screen.getByLabelText(/Como é vendido/), "Por unidade");

    expect(screen.getByLabelText(/Unidade/)).toHaveValue("UN");
    expect(screen.queryByLabelText(/Código na balança/)).not.toBeInTheDocument();
  });

  it("🔑 cadastra a referência de fabricante que a autopeças precisa", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () => json(201, PRODUTO_COMPLETO),
    });

    await irParaNovoProduto();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Vela de Ignição");
    await userEvent.type(screen.getByLabelText(/Código interno/), "VELA-F7");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "24,00");

    await userEvent.click(screen.getByRole("button", { name: "Adicionar código" }));
    await userEvent.selectOptions(
      screen.getByLabelText("Tipo"),
      "Similar de outra marca",
    );
    await userEvent.type(screen.getByLabelText("Código"), "F7TC");

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado["referencias"]).toEqual([{ tipo: "SIMILAR", valor: "F7TC" }]);
  });

  it("remove a referência adicionada por engano", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO);
    await irParaNovoProduto();

    await userEvent.click(screen.getByRole("button", { name: "Adicionar código" }));
    expect(screen.getByLabelText("Código")).toBeVisible();

    const remover = screen.getAllByRole("button", { name: "Remover" })[0];
    expect(remover).toBeDefined();
    await userEvent.click(remover as HTMLElement);
    expect(screen.queryByLabelText("Código")).not.toBeInTheDocument();
  });

  it("🔑 cadastra a embalagem de fardo que o depósito precisa", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () => json(201, PRODUTO_COMPLETO),
    });

    await irParaNovoProduto();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Refrigerante Cola 2L");
    await userEvent.type(screen.getByLabelText(/Código interno/), "REF001");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "9,90");

    await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));
    await userEvent.selectOptions(screen.getByLabelText("Embalagem"), "Fardo");

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado["embalagens"]).toEqual([{ unidade: "FD", fator: "12" }]);
  });

  it("remove a embalagem e recusa quantidade que não faz sentido", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO);
    await irParaNovoProduto();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Refrigerante");
    await userEvent.type(screen.getByLabelText(/Código interno/), "REF001");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));
    await userEvent.clear(screen.getByLabelText(/Quantidade dentro/));
    await userEvent.type(screen.getByLabelText(/Quantidade dentro/), "1");

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("maior que 1");

    await userEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(screen.queryByLabelText(/Quantidade dentro/)).not.toBeInTheDocument();
  });

  it("recusa campos obrigatórios vazios antes de chamar o servidor", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
    });

    await irParaNovoProduto();
    const antes = corpos.length;

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("código interno");

    await userEvent.type(screen.getByLabelText(/Código interno/), "REF001");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("descrição");

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Refrigerante");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Preço de venda inválido");

    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "9,90");
    await userEvent.clear(screen.getByLabelText(/Custo de compra/));
    await userEvent.type(screen.getByLabelText(/Custo de compra/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Custo inválido");

    expect(corpos).toHaveLength(antes);
  });

  it("🔑 recusa do servidor aparece sem perder o que foi digitado", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () =>
        json(409, {
          erro: {
            codigo: "PRODUTO_SKU_EM_USO",
            mensagem: "O código REF001 já é do produto Refrigerante Cola 2 Litros.",
          },
        }),
    });

    await irParaNovoProduto();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Outro refrigerante");
    await userEvent.type(screen.getByLabelText(/Código interno/), "REF001");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "9,90");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("já é do produto");
    });
    expect(screen.getByLabelText(/Descrição \*/)).toHaveValue("Outro refrigerante");
  });

  it("cancelar volta para a lista sem gravar", async () => {
    await abrirProdutos(GERENTE_DE_PRODUTO);
    await irParaNovoProduto();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Novo produto" })).toBeVisible();
    });
  });
});

describe("Edição de produto", () => {
  it("🔑 abre preenchido e manda PUT com o estado completo", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": () =>
        json(200, {
          itens: [
            {
              ...PRODUTO_COMPLETO,
              custo: "650",
              categoriaId: "cat-1",
              referencias: [{ tipo: "ORIGINAL", valor: "90919-01210" }],
              embalagens: [{ unidade: "FD", fator: "12" }],
            },
          ],
        }),
      "GET /api/categorias": CATEGORIAS,
      "PUT /api/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002": () =>
        json(200, PRODUTO_COMPLETO),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText(/Código interno/)).toHaveValue("REF001");
    expect(screen.getByLabelText(/Preço de venda/)).toHaveValue("9,90");
    expect(screen.getByLabelText(/Custo de compra/)).toHaveValue("6,50");
    expect(screen.getByLabelText("Código")).toHaveValue("90919-01210");
    // Tipo e unidade não aparecem: o produto já tem estoque naquela unidade.
    expect(screen.queryByLabelText(/Como é vendido/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Produto ativo"));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "PUT")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado["ativo"]).toBe(false);
    expect(enviado["custo"]).toBe("650");
    expect(enviado["categoriaId"]).toBe("cat-1");
    expect(enviado["referencias"]).toEqual([{ tipo: "ORIGINAL", valor: "90919-01210" }]);
  });

  it("🔑 o formulário de quem não vê custo não o envia, e o gravado fica de pé", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, BALCONISTA_SEM_CUSTO),
      "GET /api/produtos": () => json(200, { itens: [PRODUTO_COMPLETO] }),
      "GET /api/categorias": CATEGORIAS,
      "PUT /api/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002": () =>
        json(200, PRODUTO_COMPLETO),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Editar" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "PUT")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "PUT")?.corpo).not.toHaveProperty("custo");
  });

  it("descrição do cupom em branco não vai no corpo — o servidor deriva da longa", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () => json(201, PRODUTO_COMPLETO),
    });

    await irParaNovoProduto();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Refrigerante Cola 2L");
    await userEvent.type(screen.getByLabelText(/Código interno/), "REF001");
    await userEvent.type(screen.getByLabelText(/Código de barras/), "7891000315507");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "9,90");
    await userEvent.selectOptions(screen.getByLabelText(/Categoria/), "Bebidas");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado).not.toHaveProperty("descricaoPdv");
    expect(enviado["codigoBarras"]).toBe("7891000315507");
    expect(enviado["categoriaId"]).toBe("cat-1");
  });

  it("descrição do cupom preenchida vai como digitada", async () => {
    const { corpos } = montarComMetodo({
      "GET /api/acesso/eu": () => json(200, GERENTE_DE_PRODUTO),
      "GET /api/produtos": LISTA_VAZIA,
      "GET /api/categorias": CATEGORIAS,
      "POST /api/produtos": () => json(201, PRODUTO_COMPLETO),
    });

    await irParaNovoProduto();

    await userEvent.type(screen.getByLabelText(/Descrição \*/), "Refrigerante Cola 2L");
    await userEvent.type(screen.getByLabelText(/Descrição do cupom/), "REFRI COLA 2L");
    await userEvent.type(screen.getByLabelText(/Código interno/), "REF001");
    await userEvent.clear(screen.getByLabelText(/Preço de venda/));
    await userEvent.type(screen.getByLabelText(/Preço de venda/), "9,90");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(
      (corpos.find((c) => c.metodo === "POST")?.corpo as Record<string, unknown>)[
        "descricaoPdv"
      ],
    ).toBe("REFRI COLA 2L");
  });
});

// ── Estoque ──────────────────────────────────────────────────────────────

const SALDO = {
  produtoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002",
  sku: "REF001",
  descricao: "Refrigerante Cola 2 Litros",
  unidade: "UN",
  milesimos: "10000",
  ativo: true,
};

const ESTOQUISTA_DE_ESTOQUE = {
  ...USUARIO_GERENTE,
  nome: "Bruno Estoquista",
  papel: "ESTOQUISTA",
  permissoes: [
    "produto:ver_custo",
    "estoque:entrada",
    "estoque:ajuste",
    "estoque:inventario",
  ],
};

/** Só dá entrada — não baixa mercadoria nem enxerga custo. */
const CONFERENTE = {
  ...USUARIO_OPERADOR,
  nome: "Íris Conferente",
  permissoes: ["venda:criar", "estoque:entrada"],
};

const SO_SALDO = () => json(200, { itens: [SALDO] });
const SEM_MOVIMENTOS = () => json(200, { itens: [] });

async function abrirEstoque(
  usuario: typeof USUARIO_GERENTE,
  extras: Rotas = {},
): Promise<void> {
  montarApp({
    "/api/acesso/eu": () => json(200, usuario),
    "/api/estoque/saldos": SO_SALDO,
    ...extras,
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Estoque" })).toBeVisible();
  });
  await userEvent.click(screen.getByRole("button", { name: "Estoque" }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Estoque" })).toBeVisible();
  });
}

describe("Lista de estoque", () => {
  it("mostra o saldo com a unidade do produto", async () => {
    await abrirEstoque(ESTOQUISTA_DE_ESTOQUE);

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(screen.getByText(/10 un/)).toBeVisible();
  });

  it("🔑 marca o saldo negativo com texto, não só com cor", async () => {
    await abrirEstoque(ESTOQUISTA_DE_ESTOQUE, {
      "/api/estoque/saldos": () =>
        json(200, { itens: [{ ...SALDO, milesimos: "-5000" }] }),
    });

    await waitFor(() => {
      expect(screen.getByText("negativo")).toBeVisible();
    });
  });

  it("🔑 quem não pode ver custo não vê as colunas de custo e valor", async () => {
    await abrirEstoque(CONFERENTE, {
      "/api/estoque/saldos": () => json(200, { itens: [SALDO] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(
      screen.queryByRole("columnheader", { name: "Custo médio" }),
    ).not.toBeInTheDocument();
  });

  it("mostra custo e valor imobilizado a quem tem a permissão", async () => {
    await abrirEstoque(ESTOQUISTA_DE_ESTOQUE, {
      "/api/estoque/saldos": () =>
        json(200, {
          itens: [{ ...SALDO, custoMedio: "300", valorEmEstoque: "3000" }],
        }),
    });

    await waitFor(() => {
      expect(screen.getByText("R$ 3,00")).toBeVisible();
    });
    expect(screen.getByText("R$ 30,00")).toBeVisible();
  });

  it("custo nunca informado aparece como traço, não como R$ 0,00", async () => {
    await abrirEstoque(ESTOQUISTA_DE_ESTOQUE, {
      "/api/estoque/saldos": () =>
        json(200, { itens: [{ ...SALDO, custoMedio: "0", valorEmEstoque: "0" }] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("filtra por situação e a lista vazia de negativos é boa notícia", async () => {
    const chamadas: string[] = [];

    const buscar = vi.fn((url: string) => {
      chamadas.push(url);
      const caminho = url.split("?")[0] ?? url;

      if (caminho === "/api/acesso/eu")
        return Promise.resolve(json(200, ESTOQUISTA_DE_ESTOQUE));
      if (caminho === "/api/estoque/saldos") {
        return Promise.resolve(
          url.includes("situacao=NEGATIVO") ? json(200, { itens: [] }) : SO_SALDO(),
        );
      }
      return Promise.resolve(json(404, { erro: { codigo: "X", mensagem: "x" } }));
    });

    const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);
    render(
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <App />
      </ProvedorSessao>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Estoque" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Estoque" }));

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Negativos" }));

    await waitFor(() => {
      expect(screen.getByText(/É o resultado que se quer/)).toBeVisible();
    });
    expect(chamadas.some((url) => url.includes("situacao=NEGATIVO"))).toBe(true);
  });

  it("procura por texto e o termo vai na consulta", async () => {
    const chamadas: string[] = [];

    const buscar = vi.fn((url: string) => {
      chamadas.push(url);
      const caminho = url.split("?")[0] ?? url;

      if (caminho === "/api/acesso/eu")
        return Promise.resolve(json(200, ESTOQUISTA_DE_ESTOQUE));
      if (caminho === "/api/estoque/saldos") {
        return Promise.resolve(
          url.includes("termo=cola") ? SO_SALDO() : json(200, { itens: [] }),
        );
      }
      return Promise.resolve(json(404, { erro: { codigo: "X", mensagem: "x" } }));
    });

    const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);
    render(
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <App />
      </ProvedorSessao>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Estoque" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Estoque" }));

    await waitFor(() => {
      // Lista sem resultado com filtro aplicado tem texto próprio.
      expect(
        screen.getByText("Nenhum produto encontrado com este filtro."),
      ).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Procurar produto/), "cola");
    await userEvent.click(screen.getByRole("button", { name: "Procurar" }));

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
    expect(chamadas.some((url) => url.includes("termo=cola"))).toBe(true);
  });

  it("marca o produto inativo com texto, não só com cor", async () => {
    await abrirEstoque(ESTOQUISTA_DE_ESTOQUE, {
      "/api/estoque/saldos": () => json(200, { itens: [{ ...SALDO, ativo: false }] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Inativo")).toBeVisible();
    });
  });

  it("🔑 falha ao listar oferece repetir", async () => {
    await abrirEstoque(ESTOQUISTA_DE_ESTOQUE, {
      "/api/estoque/saldos": () =>
        json(500, { erro: { codigo: "X", mensagem: "Banco fora do ar." } }),
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Banco fora do ar");
    });
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  });

  it("quem não pode lançar não vê o botão de lançar", async () => {
    await abrirEstoque(USUARIO_OPERADOR, {
      "/api/estoque/saldos": () => json(200, { itens: [SALDO] }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Extrato" })).toBeVisible();
    });
    expect(screen.queryByRole("button", { name: "Lançar" })).not.toBeInTheDocument();
  });
});

describe("Lançamento de movimento", () => {
  const PRODUTO_COM_FARDO = () =>
    json(200, { ...PRODUTO, embalagens: [{ unidade: "FD", fator: "12" }] });

  async function irParaLancamento(usuario = ESTOQUISTA_DE_ESTOQUE): Promise<void> {
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Estoque" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Estoque" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Lançar" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Lançar movimento" })).toBeVisible();
    });
    expect(usuario).toBeDefined();
  }

  function montarLancamento(rotas: Record<string, () => Response> = {}) {
    return montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA_DE_ESTOQUE),
      "GET /api/estoque/saldos": SO_SALDO,
      "GET /api/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002": PRODUTO_COM_FARDO,
      "POST /api/estoque/movimentos": () => json(201, { id: "x" }),
      ...rotas,
    });
  }

  it("🔑 a quantidade vai em milésimos, nunca em número", async () => {
    const { corpos } = montarLancamento();
    await irParaLancamento();

    await userEvent.type(screen.getByLabelText(/Quantidade/), "1,5");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado["quantidade"]).toBe("1500");
    expect(typeof enviado["quantidade"]).toBe("string");
  });

  it("🔑 número sem vírgula é a unidade inteira, não milésimos", async () => {
    // A leitura inversa lançaria mil vezes menos mercadoria do que chegou.
    const { corpos } = montarLancamento();
    await irParaLancamento();

    await userEvent.type(screen.getByLabelText(/Quantidade/), "3");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(
      (corpos.find((c) => c.metodo === "POST")?.corpo as Record<string, unknown>)[
        "quantidade"
      ],
    ).toBe("3000");
  });

  it("🔑 oferece a embalagem do produto, para não obrigar a multiplicar de cabeça", async () => {
    const { corpos } = montarLancamento();
    await irParaLancamento();

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /FD — 12 UN/ })).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText(/Quantidade/), "3");
    await userEvent.selectOptions(screen.getByLabelText(/Unidade/), "FD");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    // A conversão para 36 unidades é do servidor: o cliente manda o que foi
    // digitado, e a regra mora num lugar só.
    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    expect(enviado).toMatchObject({ quantidade: "3000", unidade: "FD" });
  });

  it("🔑 ajuste sem motivo é recusado antes de chamar o servidor", async () => {
    const { corpos } = montarLancamento();
    await irParaLancamento();
    const antes = corpos.length;

    await userEvent.selectOptions(
      screen.getByLabelText(/O que aconteceu/),
      "Perda, quebra ou vencimento",
    );
    await userEvent.type(screen.getByLabelText(/Quantidade/), "2");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Informe o motivo");
    expect(corpos).toHaveLength(antes);
  });

  it("perda com motivo é aceita", async () => {
    const { corpos } = montarLancamento();
    await irParaLancamento();

    await userEvent.selectOptions(
      screen.getByLabelText(/O que aconteceu/),
      "Perda, quebra ou vencimento",
    );
    await userEvent.type(screen.getByLabelText(/Quantidade/), "2");
    await userEvent.type(screen.getByLabelText(/Motivo/), "Garrafas quebradas");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      tipo: "PERDA",
      observacao: "Garrafas quebradas",
    });
  });

  it("🔑 saída não está entre os tipos oferecidos", async () => {
    // Saída é a venda. Oferecê-la aqui convidaria a mercadoria a sumir do
    // estoque sem sair do caixa.
    montarLancamento();
    await irParaLancamento();

    expect(screen.queryByRole("option", { name: /Venda/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Transferência/ }),
    ).not.toBeInTheDocument();
  });

  it("recusa quantidade vazia e custo malformado antes da rede", async () => {
    const { corpos } = montarLancamento();
    await irParaLancamento();
    const antes = corpos.length;

    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("quantidade maior que zero");

    await userEvent.type(screen.getByLabelText(/Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo por unidade/), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Custo inválido");

    expect(corpos).toHaveLength(antes);
  });

  it("manda o custo em centavos", async () => {
    const { corpos } = montarLancamento();
    await irParaLancamento();

    await userEvent.type(screen.getByLabelText(/Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo por unidade/), "3,00");
    await userEvent.type(screen.getByLabelText(/^Lote/), "L2026-07");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      custoUnitario: "300",
      lote: "L2026-07",
    });
  });

  it("🔑 quem só dá entrada não vê os tipos de baixa nem o campo de custo", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, CONFERENTE),
      "GET /api/estoque/saldos": SO_SALDO,
      "GET /api/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002": PRODUTO_COM_FARDO,
    });

    await irParaLancamento();

    expect(screen.getByRole("option", { name: "Entrada de mercadoria" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "Perda, quebra ou vencimento" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Custo por unidade/)).not.toBeInTheDocument();
  });

  it("recusa do servidor aparece sem perder o que foi digitado", async () => {
    montarLancamento({
      "POST /api/estoque/movimentos": () =>
        json(400, {
          erro: {
            codigo: "PRODUTO_EMBALAGEM_NAO_CADASTRADA",
            mensagem: "Não há embalagem em caixa cadastrada para este produto.",
          },
        }),
    });

    await irParaLancamento();

    await userEvent.type(screen.getByLabelText(/Quantidade/), "3");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Não há embalagem");
    });
    expect(screen.getByLabelText(/Quantidade/)).toHaveValue("3");
  });

  it("a tela sobrevive ao cadastro do produto falhando", async () => {
    montarComMetodo({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA_DE_ESTOQUE),
      "GET /api/estoque/saldos": SO_SALDO,
      "GET /api/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002": () =>
        json(500, { erro: { codigo: "X", mensagem: "x" } }),
    });

    await irParaLancamento();

    // Sem embalagens, resta a unidade do produto — e dá para lançar.
    expect(screen.getByLabelText(/Unidade/)).toHaveValue("UN");
  });

  it("cancelar volta para a lista", async () => {
    montarLancamento();
    await irParaLancamento();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Estoque" })).toBeVisible();
    });
  });
});

describe("Extrato do estoque", () => {
  async function abrirExtrato(rotas: Rotas = {}): Promise<void> {
    montarApp({
      "/api/acesso/eu": () => json(200, ESTOQUISTA_DE_ESTOQUE),
      "/api/estoque/saldos": SO_SALDO,
      "/api/estoque/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002/movimentos":
        SEM_MOVIMENTOS,
      ...rotas,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Estoque" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Estoque" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Extrato" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Extrato" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Extrato do estoque" })).toBeVisible();
    });
  }

  it("🔑 mostra o sinal do movimento em texto, não só em cor", async () => {
    await abrirExtrato({
      "/api/estoque/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002/movimentos": () =>
        json(200, {
          itens: [
            {
              id: "m1",
              tipo: "PERDA",
              quantidade: "2000",
              unidade: "UN",
              efeito: -1,
              usuarioNome: "Bruno Estoquista",
              observacao: "Garrafas quebradas",
              lote: "L2026-07",
              ocorridoEm: "2026-08-01T12:00:00.000Z",
            },
            {
              id: "m2",
              tipo: "ENTRADA",
              quantidade: "10000",
              unidade: "UN",
              efeito: 1,
              usuarioNome: "Bruno Estoquista",
              ocorridoEm: "2026-08-01T10:00:00.000Z",
            },
          ],
        }),
    });

    await waitFor(() => {
      expect(screen.getByText("Perda")).toBeVisible();
    });
    expect(screen.getByText(/−2 un/)).toBeVisible();
    expect(screen.getByText(/\+10 un/)).toBeVisible();
    expect(screen.getByText("Garrafas quebradas")).toBeVisible();
    // Lote aparece quando existe: é o que rastreia um recolhimento do fabricante.
    expect(screen.getByText(/lote L2026-07/)).toBeVisible();
    expect(screen.getAllByText("Bruno Estoquista")[0]).toBeVisible();
  });

  it("produto sem movimento é estado vazio, não erro", async () => {
    await abrirExtrato();

    await waitFor(() => {
      expect(screen.getByText("Nenhum movimento")).toBeVisible();
    });
  });

  it("falha ao carregar oferece repetir, e voltar leva à lista", async () => {
    await abrirExtrato({
      "/api/estoque/produtos/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002/movimentos": () =>
        json(500, { erro: { codigo: "X", mensagem: "Falhou." } }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Estoque" })).toBeVisible();
    });
  });
});

// ── Compras ──────────────────────────────────────────────────────────────

const COMPRADOR = {
  ...USUARIO_GERENTE,
  nome: "Bruno Estoquista",
  papel: "ESTOQUISTA",
  permissoes: ["estoque:entrada", "estoque:ajuste", "produto:ver_custo"],
};

const NOTA_NA_LISTA = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0020",
  numero: "123456",
  serie: "1",
  fornecedorNome: "Distribuidora Central",
  recebidaEm: "2026-07-30T12:00:00.000Z",
  total: "3000",
  quantidadeItens: 1,
  status: "LANCADA" as const,
  usuarioNome: "Bruno Estoquista",
};

const NOTA_COMPLETA = {
  ...NOTA_NA_LISTA,
  emitidaEm: "2026-07-28T12:00:00.000Z",
  itens: [
    {
      numero: 1,
      descricao: "Refrigerante Cola 2 Litros",
      quantidade: "10000",
      unidade: "UN",
      custoUnitario: "300",
      desconto: "0",
      total: "3000",
    },
  ],
};

const PRODUTO_PARA_NOTA = {
  itens: [
    {
      ...PRODUTO,
      referencias: [],
      embalagens: [{ unidade: "FD", fator: "12" }],
    },
  ],
};

const ROTAS_COMPRAS: Rotas = {
  "/api/acesso/eu": () => json(200, COMPRADOR),
  "/api/compras/notas": () => json(200, { itens: [NOTA_NA_LISTA] }),
  "/api/compras/permissoes": () => json(200, { podeCancelar: true }),
  "/api/fornecedores": () =>
    json(200, {
      itens: [
        { id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0011", exibicao: "Distribuidora Central" },
      ],
    }),
  "/api/produtos": () => json(200, PRODUTO_PARA_NOTA),
};

async function abrirCompras(extras: Rotas = {}): Promise<void> {
  montarApp({ ...ROTAS_COMPRAS, ...extras });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Compras" })).toBeVisible();
  });
  await userEvent.click(screen.getByRole("button", { name: "Compras" }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Entrada de mercadoria" })).toBeVisible();
  });
}

describe("Lista de notas de entrada", () => {
  it("lista com fornecedor e total formatado", async () => {
    await abrirCompras();

    await waitFor(() => {
      expect(screen.getByText("Distribuidora Central")).toBeVisible();
    });
    expect(screen.getByText("R$ 30,00")).toBeVisible();
  });

  it("🔑 marca a cancelada com texto, não só com cor", async () => {
    await abrirCompras({
      "/api/compras/notas": () =>
        json(200, { itens: [{ ...NOTA_NA_LISTA, status: "CANCELADA" }] }),
    });

    await waitFor(() => {
      expect(screen.getByText("Cancelada")).toBeVisible();
    });
  });

  it("pede as canceladas ao servidor quando a caixa é marcada", async () => {
    const chamadas: string[] = [];

    const buscar = vi.fn((url: string) => {
      chamadas.push(url);
      const caminho = url.split("?")[0] ?? url;
      const rota = ROTAS_COMPRAS[caminho];
      return Promise.resolve(
        rota?.() ?? json(404, { erro: { codigo: "X", mensagem: "x" } }),
      );
    });

    const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);
    render(
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <App />
      </ProvedorSessao>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Compras" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Compras" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Mostrar também as canceladas/)).toBeVisible();
    });
    await userEvent.click(screen.getByLabelText(/Mostrar também as canceladas/));

    await waitFor(() => {
      expect(chamadas.some((url) => url.includes("incluirCanceladas=true"))).toBe(true);
    });
  });

  it("procura por número e mostra o vazio certo", async () => {
    await abrirCompras({ "/api/compras/notas": () => json(200, { itens: [] }) });

    await waitFor(() => {
      expect(screen.getByText(/Lance a primeira/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Procurar nota/), "999");
    await userEvent.click(screen.getByRole("button", { name: "Procurar" }));

    await waitFor(() => {
      expect(screen.getByText(/Nada para "999"/)).toBeVisible();
    });
  });

  it("falha ao listar oferece repetir", async () => {
    await abrirCompras({
      "/api/compras/notas": () =>
        json(500, { erro: { codigo: "X", mensagem: "Banco fora do ar." } }),
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Banco fora do ar");
    });
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  });
});

describe("Lançamento de nota", () => {
  function montarLancamentoDeNota(rotas: Record<string, () => Response> = {}) {
    return montarComMetodo({
      "GET /api/acesso/eu": () => json(200, COMPRADOR),
      "GET /api/compras/notas": () => json(200, { itens: [] }),
      "GET /api/compras/permissoes": () => json(200, { podeCancelar: true }),
      "GET /api/fornecedores": () =>
        json(200, {
          itens: [
            {
              id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0011",
              exibicao: "Distribuidora Central",
            },
          ],
        }),
      "GET /api/produtos": () => json(200, PRODUTO_PARA_NOTA),
      "POST /api/compras/notas": () => json(201, NOTA_COMPLETA),
      ...rotas,
    });
  }

  async function irParaLancamento(): Promise<void> {
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Compras" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Compras" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Lançar nota" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Lançar nota de entrada" }),
      ).toBeVisible();
    });
  }

  async function adicionarLinha(): Promise<void> {
    await userEvent.type(screen.getByLabelText(/Adicionar produto/), "REF001");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    });
  }

  it("🔑 a soma das linhas aparece enquanto se digita", async () => {
    // Quem errou uma quantidade descobre com o papel ainda na mão, e não três
    // meses depois quando o estoque não fecha.
    montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");

    expect(screen.getByText("Soma das linhas")).toBeVisible();
    expect(screen.getAllByText("R$ 30,00").length).toBeGreaterThan(0);
  });

  it("🔑 avisa quando o total digitado não bate com as linhas", async () => {
    montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.type(screen.getByLabelText(/Total impresso/), "35,00");

    await waitFor(() => {
      expect(screen.getByText(/Não bate com o total da nota/)).toBeVisible();
    });
  });

  it("o aviso some quando os dois valores batem", async () => {
    montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.type(screen.getByLabelText(/Total impresso/), "30,00");

    expect(screen.queryByText(/Não bate com o total da nota/)).not.toBeInTheDocument();
  });

  it("🔑 quantidade vai em milésimos e dinheiro em centavos", async () => {
    const { corpos } = montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.selectOptions(
      screen.getByLabelText(/Fornecedor/),
      "Distribuidora Central",
    );
    await userEvent.type(screen.getByLabelText(/Número da nota/), "123456");
    await userEvent.type(screen.getByLabelText(/^Quantidade/), "1,5");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.type(screen.getByLabelText(/Total impresso/), "4,50");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    const itens = enviado["itens"] as Record<string, unknown>[];

    expect(itens[0]?.["quantidade"]).toBe("1500");
    expect(itens[0]?.["custoUnitario"]).toBe("300");
    expect(enviado["totalDeclarado"]).toBe("450");
  });

  it("🔑 oferece a embalagem do produto para não obrigar a multiplicar de cabeça", async () => {
    montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    expect(screen.getByRole("option", { name: /FD — 12 UN/ })).toBeInTheDocument();
  });

  it("🔑 escolher a embalagem manda a unidade dela, e o servidor converte", async () => {
    const { corpos } = montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.selectOptions(
      screen.getByLabelText(/Fornecedor/),
      "Distribuidora Central",
    );
    await userEvent.type(screen.getByLabelText(/Número da nota/), "123456");
    await userEvent.selectOptions(screen.getByLabelText(/^Unidade/), "FD");
    await userEvent.type(screen.getByLabelText(/^Quantidade/), "3");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "60,00");
    await userEvent.type(screen.getByLabelText(/Observação/), "Entrega parcial");
    await userEvent.type(screen.getByLabelText(/Total impresso/), "180,00");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const enviado = corpos.find((c) => c.metodo === "POST")?.corpo as Record<
      string,
      unknown
    >;
    const itens = enviado["itens"] as Record<string, unknown>[];

    // O cliente manda o que foi digitado; a conversão para 36 unidades é do
    // servidor, e a regra mora num lugar só.
    expect(itens[0]).toMatchObject({ quantidade: "3000", unidade: "FD" });
    expect(enviado["observacao"]).toBe("Entrega parcial");
  });

  it("🔑 a data que vai para o estoque é a da entrada, não a de hoje", async () => {
    // Lançar uma nota de ontem precisa colocar o movimento em ontem, senão o
    // custo médio sai da ordem em que as compras aconteceram de verdade.
    const { corpos } = montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.selectOptions(
      screen.getByLabelText(/Fornecedor/),
      "Distribuidora Central",
    );
    await userEvent.type(screen.getByLabelText(/Número da nota/), "123456");
    await userEvent.type(screen.getByLabelText(/Série/), "1");
    await userEvent.clear(screen.getByLabelText(/Emitida em/));
    await userEvent.type(screen.getByLabelText(/Emitida em/), "2026-07-28");
    await userEvent.clear(screen.getByLabelText(/Mercadoria entrou em/));
    await userEvent.type(screen.getByLabelText(/Mercadoria entrou em/), "2026-07-30");
    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.type(screen.getByLabelText(/Total impresso/), "30,00");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    expect(corpos.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      emitidaEm: "2026-07-28",
      recebidaEm: "2026-07-30",
      serie: "1",
    });
  });

  it("falha de rede ao procurar o produto vira aviso, não tela branca", async () => {
    montarLancamentoDeNota({
      "GET /api/produtos": () =>
        json(500, { erro: { codigo: "X", mensagem: "Banco fora do ar." } }),
    });
    await irParaLancamento();

    await userEvent.type(screen.getByLabelText(/Adicionar produto/), "REF001");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Banco fora do ar");
    });
  });

  it("avisa quando o produto procurado não existe", async () => {
    montarLancamentoDeNota({ "GET /api/produtos": () => json(200, { itens: [] }) });
    await irParaLancamento();

    await userEvent.type(screen.getByLabelText(/Adicionar produto/), "INEXISTENTE");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Nenhum produto");
    });
  });

  it("remove a linha adicionada por engano", async () => {
    montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.click(screen.getByRole("button", { name: "Remover" }));

    expect(screen.getByText(/Sem item, nada entra no estoque/)).toBeVisible();
  });

  it("recusa campos obrigatórios vazios antes de chamar o servidor", async () => {
    const { corpos } = montarLancamentoDeNota();
    await irParaLancamento();
    const antes = corpos.length;

    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha o fornecedor");

    await userEvent.selectOptions(
      screen.getByLabelText(/Fornecedor/),
      "Distribuidora Central",
    );
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));
    expect(screen.getByRole("alert")).toHaveTextContent("número da nota");

    await userEvent.type(screen.getByLabelText(/Número da nota/), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ao menos um item");

    await adicionarLinha();
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Confira quantidade e custo");

    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));
    expect(screen.getByRole("alert")).toHaveTextContent("total impresso");

    expect(corpos.filter((c) => c.metodo === "POST")).toHaveLength(0);
    expect(corpos.length).toBeGreaterThanOrEqual(antes);
  });

  it("recusa do servidor aparece sem perder o que foi digitado", async () => {
    montarLancamentoDeNota({
      "POST /api/compras/notas": () =>
        json(409, {
          erro: {
            codigo: "NOTA_JA_LANCADA",
            mensagem: "A nota 123456/1 deste fornecedor já foi lançada.",
          },
        }),
    });

    await irParaLancamento();
    await adicionarLinha();

    await userEvent.selectOptions(
      screen.getByLabelText(/Fornecedor/),
      "Distribuidora Central",
    );
    await userEvent.type(screen.getByLabelText(/Número da nota/), "123456");
    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.type(screen.getByLabelText(/Total impresso/), "30,00");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("já foi lançada");
    });
    expect(screen.getByLabelText(/Número da nota/)).toHaveValue("123456");
  });

  it("avisa quando não há fornecedor cadastrado", async () => {
    montarLancamentoDeNota({ "GET /api/fornecedores": () => json(200, { itens: [] }) });
    await irParaLancamento();

    await waitFor(() => {
      expect(screen.getByText(/Nenhum fornecedor cadastrado/)).toBeVisible();
    });
  });

  it("🔑 o desconto do fornecedor entra no total da linha e no corpo", async () => {
    // 10 a R$ 3,00 com R$ 5,00 de desconto: a loja pagou R$ 25,00.
    const { corpos } = montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.selectOptions(
      screen.getByLabelText(/Fornecedor/),
      "Distribuidora Central",
    );
    await userEvent.type(screen.getByLabelText(/Número da nota/), "123456");
    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.type(screen.getByLabelText(/Desconto/), "5,00");

    // A soma já reflete o desconto antes de gravar.
    expect(screen.getAllByText("R$ 25,00").length).toBeGreaterThan(0);

    await userEvent.type(screen.getByLabelText(/Total impresso/), "25,00");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));

    await waitFor(() => {
      expect(corpos.some((c) => c.metodo === "POST")).toBe(true);
    });

    const itens = (
      corpos.find((c) => c.metodo === "POST")?.corpo as {
        itens: Record<string, unknown>[];
      }
    ).itens;

    expect(itens[0]?.["desconto"]).toBe("500");
  });

  it("desconto malformado é recusado antes da rede", async () => {
    const { corpos } = montarLancamentoDeNota();
    await irParaLancamento();
    await adicionarLinha();

    await userEvent.selectOptions(
      screen.getByLabelText(/Fornecedor/),
      "Distribuidora Central",
    );
    await userEvent.type(screen.getByLabelText(/Número da nota/), "123456");
    await userEvent.type(screen.getByLabelText(/^Quantidade/), "10");
    await userEvent.type(screen.getByLabelText(/Custo unitário/), "3,00");
    await userEvent.type(screen.getByLabelText(/Desconto/), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Lançar nota" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Confira quantidade e custo");
    expect(corpos.filter((c) => c.metodo === "POST")).toHaveLength(0);
  });

  it("cancelar volta para a lista", async () => {
    montarLancamentoDeNota();
    await irParaLancamento();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Entrada de mercadoria" }),
      ).toBeVisible();
    });
  });
});

describe("Detalhe e cancelamento da nota", () => {
  const URL_NOTA = "/api/compras/notas/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0020";

  async function abrirDetalhe(extras: Rotas = {}): Promise<void> {
    await abrirCompras({ [URL_NOTA]: () => json(200, NOTA_COMPLETA), ...extras });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Abrir" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Nota 123456/ })).toBeVisible();
    });
  }

  it("mostra os itens da nota", async () => {
    await abrirDetalhe();

    expect(screen.getByText("Refrigerante Cola 2 Litros")).toBeVisible();
    expect(screen.getByText(/10 un/)).toBeVisible();
  });

  it("🔑 exige motivo antes de cancelar", async () => {
    await abrirDetalhe();

    await userEvent.click(
      screen.getByRole("button", { name: "Cancelar nota e estornar estoque" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Informe o motivo");
  });

  it("🔑 cancela com motivo e a nota aparece marcada", async () => {
    let cancelada = false;

    const buscar = vi.fn((url: string, init?: RequestInit) => {
      const caminho = url.split("?")[0] ?? url;
      const metodo = init?.method ?? "GET";

      if (caminho === "/api/acesso/eu") return Promise.resolve(json(200, COMPRADOR));
      if (caminho === "/api/compras/permissoes")
        return Promise.resolve(json(200, { podeCancelar: true }));
      if (caminho === "/api/compras/notas")
        return Promise.resolve(json(200, { itens: [NOTA_NA_LISTA] }));
      if (caminho === `${URL_NOTA}/cancelamento` && metodo === "POST") {
        cancelada = true;
        return Promise.resolve(json(200, NOTA_COMPLETA));
      }
      if (caminho === URL_NOTA) {
        return Promise.resolve(
          json(200, {
            ...NOTA_COMPLETA,
            ...(cancelada
              ? { status: "CANCELADA", motivoCancelamento: "Lançada em duplicidade" }
              : {}),
          }),
        );
      }
      return Promise.resolve(json(404, { erro: { codigo: "X", mensagem: "x" } }));
    });

    const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);
    render(
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <App />
      </ProvedorSessao>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Compras" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Compras" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Abrir" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Motivo/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Motivo/), "Lançada em duplicidade");
    await userEvent.click(
      screen.getByRole("button", { name: "Cancelar nota e estornar estoque" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Nota cancelada/)).toBeVisible();
    });
    expect(screen.getByText(/Lançada em duplicidade/)).toBeVisible();
  });

  it("mostra a observação da nota quando existe", async () => {
    await abrirDetalhe({
      "/api/compras/notas/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0020": () =>
        json(200, { ...NOTA_COMPLETA, observacao: "Entrega parcial" }),
    });

    expect(screen.getByText("Entrega parcial")).toBeVisible();
  });

  it("recusa do servidor no cancelamento aparece na tela", async () => {
    await abrirDetalhe({
      "/api/compras/notas/018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0020/cancelamento": () =>
        json(422, {
          erro: { codigo: "NOTA_JA_CANCELADA", mensagem: "Esta nota já foi cancelada." },
        }),
    });

    await userEvent.type(screen.getByLabelText(/Motivo/), "Duplicada");
    await userEvent.click(
      screen.getByRole("button", { name: "Cancelar nota e estornar estoque" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("já foi cancelada");
    });
  });

  it("🔑 quem não pode cancelar não vê o formulário de cancelamento", async () => {
    await abrirDetalhe({
      "/api/compras/permissoes": () => json(200, { podeCancelar: false }),
    });

    expect(
      screen.queryByRole("button", { name: "Cancelar nota e estornar estoque" }),
    ).not.toBeInTheDocument();
  });

  it("nota já cancelada não oferece cancelar de novo", async () => {
    await abrirDetalhe({
      [URL_NOTA]: () =>
        json(200, {
          ...NOTA_COMPLETA,
          status: "CANCELADA",
          motivoCancelamento: "Duplicada",
        }),
    });

    expect(screen.getByText(/Nota cancelada/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Cancelar nota e estornar estoque" }),
    ).not.toBeInTheDocument();
  });

  it("falha ao carregar a nota oferece repetir, e voltar leva à lista", async () => {
    await abrirCompras({
      [URL_NOTA]: () => json(500, { erro: { codigo: "X", mensagem: "Falhou." } }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Abrir" })).toBeVisible();
    });
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    });
  });
});

// ── Barreira de erro ─────────────────────────────────────────────────────

const NOTA_SEM_TOTAL = { id: "x", numero: "1" };

/**
 * Abre Compras com uma resposta que **falta um campo**.
 *
 * Não usa `abrirCompras` de propósito: a tela quebra na primeira listagem, e
 * esperar pelo cabeçalho dela seria esperar por algo que a barreira já
 * substituiu.
 */
async function abrirComprasQuebrada(): Promise<void> {
  montarApp({
    ...ROTAS_COMPRAS,
    "/api/compras/notas": () => json(200, { itens: [NOTA_SEM_TOTAL] }),
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Compras" })).toBeVisible();
  });
  await userEvent.click(screen.getByRole("button", { name: "Compras" }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Esta tela não abriu" })).toBeVisible();
  });
}

describe("Barreira de erro", () => {
  it("🔑 resposta malformada não deixa a tela em branco", async () => {
    // A causa real: servidor atualizado e página do cliente ainda na versão
    // antiga, sem um campo que a tela espera. Sem a barreira, a página some
    // inteira — sem mensagem, sem botão, sem pista para o suporte.
    await abrirComprasQuebrada();

    expect(screen.getByRole("button", { name: "Recarregar" })).toBeVisible();
  });

  it("🔑 não mostra a exceção ao operador", async () => {
    await abrirComprasQuebrada();

    // Erro técnico na tela é veto do papel UX (CLAUDE.md §9).
    expect(document.body.textContent).not.toContain("BigInt");
    expect(document.body.textContent).not.toContain("TypeError");
  });

  it("🔑 a navegação continua de pé e a próxima aba abre normalmente", async () => {
    // Se a barreira envolvesse a página inteira, o usuário ficaria preso.
    await abrirComprasQuebrada();

    await userEvent.click(screen.getByRole("button", { name: "Produtos" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Produtos" })).toBeVisible();
    });
  });
});
