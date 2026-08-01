import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClienteAgente } from "@erp/agente-contrato";

import { App } from "../App.js";
import { definirAgenteParaTeste } from "../balcao.js";

/**
 * O balcão, do ponto de vista de quem opera.
 *
 * O que se verifica aqui é o **fluxo em teclas**: o CLAUDE.md dá poder de veto
 * ao papel UX/UI sobre qualquer fluxo que exija mouse no PDV, e a única forma de
 * garantir isso é exercitar a venda inteira pelo teclado, como o operador faz
 * com a fila esperando.
 */

interface Chamada {
  readonly url: string;
  readonly metodo: string;
  readonly corpo: unknown;
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPERADOR = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
  nome: "Maria da Silva",
  matricula: "42",
  papel: "OPERADOR_CAIXA",
  permissoes: ["venda:criar"],
  precisaTrocarCredencial: false,
};

const ITEM = {
  numero: 1,
  produtoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002",
  descricao: "REFRI COLA 2L",
  quantidade: { milesimos: "1000", unidade: "UN" },
  precoUnitario: "990",
  total: "990",
};

const VENDA_VAZIA = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0003",
  numero: 7,
  status: "ABERTA",
  total: "0",
  faltaPagar: "0",
  itens: [],
};

const VENDA_COM_ITEM = {
  ...VENDA_VAZIA,
  total: "990",
  faltaPagar: "990",
  itens: [ITEM],
};

type Rotas = Record<string, (corpo: unknown) => Response>;

function montar(rotas: Rotas): { readonly chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];

  const buscar = vi.fn((url: string, opcoes?: RequestInit) => {
    const caminho = url.split("?")[0] ?? url;
    const corpo =
      typeof opcoes?.body === "string" ? (JSON.parse(opcoes.body) as unknown) : undefined;

    chamadas.push({ url: caminho, metodo: opcoes?.method ?? "GET", corpo });

    const rota = rotas[caminho];
    return Promise.resolve(
      rota?.(corpo) ?? json(404, { erro: { codigo: "X", mensagem: "não encontrado" } }),
    );
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

  return { chamadas };
}

/** Operador já autenticado, com o balcão pronto para vender. */
const AUTENTICADO: Rotas = {
  "/api/acesso/eu": () => json(200, OPERADOR),
};

const VENDENDO: Rotas = {
  ...AUTENTICADO,
  "/api/vendas": () => json(201, VENDA_VAZIA),
  [`/api/vendas/${VENDA_VAZIA.id}/itens`]: () =>
    json(201, { item: ITEM, venda: VENDA_COM_ITEM }),
};

async function esperarCampoDeCodigo(): Promise<HTMLElement> {
  return waitFor(() => screen.getByLabelText(/Código do produto/));
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("entrada no caixa", () => {
  it("🔑 pede PIN, não senha longa", async () => {
    // O balcão troca de operador com fila esperando. Senha de doze caracteres
    // aqui faz a equipe compartilhar login, e a auditoria deixa de valer
    // (ADR-0011).
    montar({
      "/api/acesso/eu": () =>
        json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/PIN/)).toBeVisible();
    });
    expect(screen.queryByLabelText(/Senha/)).not.toBeInTheDocument();
  });

  it("🔑 o login do balcão declara contexto PDV — é o que faz o PIN ser conferido", async () => {
    // O servidor compara contra `hashPin` ou `hashSenha` conforme este campo.
    // Mandar RETAGUARDA daqui conferiria o PIN contra a senha longa, e nenhum
    // operador conseguiria entrar no caixa.
    const { chamadas } = montar({
      "/api/acesso/eu": () =>
        json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
      "/api/acesso/login": () => json(200, { token: "abc", usuario: OPERADOR }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Matrícula/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Matrícula/), "42");
    await userEvent.type(screen.getByLabelText(/PIN/), "419273{Enter}");

    await waitFor(() => {
      expect(chamadas.some((c) => c.url === "/api/acesso/login")).toBe(true);
    });

    expect(chamadas.find((c) => c.url === "/api/acesso/login")?.corpo).toMatchObject({
      matricula: "42",
      contexto: "PDV",
    });
  });

  it("🔑 PIN incompleto não vira tentativa — o bloqueio não pode ser gasto à toa", async () => {
    // O servidor bloqueia progressivamente depois de poucas tentativas. Se
    // Enter com o campo pela metade contasse como erro, o operador travaria o
    // próprio acesso no meio do movimento, sem ter errado o PIN uma vez.
    const { chamadas } = montar({
      "/api/acesso/eu": () =>
        json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Matrícula/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Matrícula/), "42");
    await userEvent.type(screen.getByLabelText(/PIN/), "419{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("O PIN tem 6 números");
    });

    expect(chamadas.some((c) => c.url === "/api/acesso/login")).toBe(false);
    expect(screen.getByLabelText(/PIN/)).toHaveFocus();
  });

  it("sem matrícula, o PIN completo também não vai ao servidor", async () => {
    const { chamadas } = montar({
      "/api/acesso/eu": () =>
        json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/PIN/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/PIN/), "419273{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Informe a matrícula");
    });

    expect(chamadas.some((c) => c.url === "/api/acesso/login")).toBe(false);
    expect(screen.getByLabelText(/Matrícula/)).toHaveFocus();
  });

  it("🔑 não pisca o login para quem já está autenticado", async () => {
    montar(VENDENDO);

    expect(screen.getByRole("status")).toHaveTextContent("Carregando sua sessão…");
    expect(screen.queryByLabelText(/PIN/)).not.toBeInTheDocument();

    await esperarCampoDeCodigo();
  });

  it("PIN errado mostra a mensagem do servidor e mantém a matrícula", async () => {
    montar({
      "/api/acesso/eu": () =>
        json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
      "/api/acesso/login": () =>
        json(401, {
          erro: {
            codigo: "CREDENCIAL_INVALIDA",
            mensagem: "Matrícula ou PIN incorreto.",
          },
        }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Matrícula/)).toBeVisible();
    });

    await userEvent.type(screen.getByLabelText(/Matrícula/), "42");
    await userEvent.type(screen.getByLabelText(/PIN/), "482913{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Matrícula ou PIN incorreto.");
    });

    expect(screen.getByLabelText(/Matrícula/)).toHaveValue("42");
    expect(screen.getByLabelText(/PIN/)).toHaveValue("");
  });

  it("🔑 entra com matrícula e PIN, terminando em Enter, e cai direto no balcão", async () => {
    // A troca de operador precisa caber em segundos, com a mão só no teclado
    // numérico: matrícula, Tab, PIN, Enter — e já está vendendo.
    montar({
      ...VENDENDO,
      // Depois do spread: sem sessão para restaurar, a tela começa no login.
      "/api/acesso/eu": () =>
        json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
      "/api/acesso/login": () => json(200, { token: "abc", usuario: OPERADOR }),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Matrícula/)).toHaveFocus();
    });

    await userEvent.keyboard("42");
    await userEvent.tab();
    await userEvent.keyboard("482913{Enter}");

    await waitFor(() => {
      expect(screen.getByLabelText(/Código do produto/)).toBeVisible();
    });
    expect(screen.getByText("Maria da Silva")).toBeVisible();
  });
});

describe("venda pelo teclado", () => {
  it("🔑 a venda começa na primeira bipada, sem botão de iniciar", async () => {
    // Uma tecla a menos por atendimento, multiplicada por centenas por dia. O
    // operador nunca pensa em "abrir venda" — isso é conceito do servidor.
    const { chamadas } = montar(VENDENDO);

    const campo = await esperarCampoDeCodigo();
    expect(screen.queryByRole("button", { name: /iniciar/i })).not.toBeInTheDocument();

    await userEvent.type(campo, "7891000315507{Enter}");

    await waitFor(() => {
      expect(screen.getByText("REFRI COLA 2L")).toBeVisible();
    });

    const posts = chamadas.filter((c) => c.metodo === "POST").map((c) => c.url);
    expect(posts).toEqual(["/api/vendas", `/api/vendas/${VENDA_VAZIA.id}/itens`]);
  });

  it("🔑 o campo fica pronto para a próxima bipada", async () => {
    // Sem isto o operador precisaria clicar no campo entre um produto e outro —
    // o que é veto do papel UX/UI (CLAUDE.md §1).
    const campo = await (async () => {
      montar(VENDENDO);
      return esperarCampoDeCodigo();
    })();

    await userEvent.type(campo, "7891000315507{Enter}");

    await waitFor(() => {
      expect(screen.getByText("REFRI COLA 2L")).toBeVisible();
    });

    expect(campo).toHaveValue("");
    expect(campo).toHaveFocus();
  });

  it("não abre venda com o campo vazio", async () => {
    const { chamadas } = montar(VENDENDO);

    const campo = await esperarCampoDeCodigo();
    await userEvent.type(campo, "{Enter}");

    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(0);
  });

  it("mostra o total calculado pelo servidor", async () => {
    // O total nunca é somado aqui: desconto rateado é regra de negócio, e
    // duplicá-la no navegador é o caminho para a tela e o cupom divergirem.
    montar(VENDENDO);

    await userEvent.type(await esperarCampoDeCodigo(), "7891000315507{Enter}");

    await waitFor(() => {
      expect(screen.getByLabelText("Total da venda")).toHaveTextContent("R$ 9,90");
    });
  });

  it("🔑 produto não encontrado é mensagem, não tela de erro técnico", async () => {
    montar({
      ...AUTENTICADO,
      "/api/vendas": () => json(201, VENDA_VAZIA),
      [`/api/vendas/${VENDA_VAZIA.id}/itens`]: () =>
        json(404, {
          erro: {
            codigo: "PRODUTO_NAO_ENCONTRADO",
            mensagem: "Produto não encontrado. Confira o código.",
          },
        }),
    });

    const campo = await esperarCampoDeCodigo();
    await userEvent.type(campo, "999{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Produto não encontrado");
    });
    // Continua vendável: o operador tenta o próximo código sem recarregar nada.
    expect(campo).toHaveFocus();
  });

  it("🔑 rede caída não mostra 'Failed to fetch'", async () => {
    const buscar = vi.fn((url: string) =>
      url.includes("/api/acesso/eu")
        ? Promise.resolve(json(200, OPERADOR))
        : Promise.reject(new TypeError("Failed to fetch")),
    );

    const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

    render(
      <ProvedorSessao contexto="PDV" cliente={cliente}>
        <App />
      </ProvedorSessao>,
    );

    await userEvent.type(await esperarCampoDeCodigo(), "7891000315507{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Sem conexão com o servidor");
    });
    expect(screen.getByRole("alert").textContent).not.toMatch(/Failed to fetch/);
  });
});

describe("pagamento pelo teclado", () => {
  const PAGANDO: Rotas = {
    ...VENDENDO,
    [`/api/vendas/${VENDA_VAZIA.id}/pagamentos`]: () =>
      json(201, { forma: "DINHEIRO", valor: "1000", faltaPagar: "0", troco: "10" }),
    [`/api/vendas/${VENDA_VAZIA.id}/finalizar`]: () =>
      json(200, { ...VENDA_COM_ITEM, status: "FINALIZADA", troco: "10" }),
  };

  async function bipar(): Promise<void> {
    await userEvent.type(await esperarCampoDeCodigo(), "7891000315507{Enter}");
    await waitFor(() => {
      expect(screen.getByText("REFRI COLA 2L")).toBeVisible();
    });
  }

  it("🔑 Enter no campo vazio abre o pagamento", async () => {
    // O gesto natural de "acabou": a mão já está no Enter depois da última
    // bipada, e não há tecla nova para decorar.
    montar(PAGANDO);
    await bipar();

    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Pagamento" })).toBeVisible();
    });
  });

  it("🔑 já vem com o valor que falta preenchido", async () => {
    // Na maioria das vendas o cliente paga o valor exato no cartão ou no PIX: o
    // operador só confirma, sem digitar nada.
    montar(PAGANDO);
    await bipar();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByLabelText(/Valor recebido/)).toHaveValue("990");
    });
  });

  it("🔑 fecha a venda e mostra o troco em destaque", async () => {
    montar(PAGANDO);
    await bipar();
    await userEvent.keyboard("{Enter}");

    const campoValor = await waitFor(() => screen.getByLabelText(/Valor recebido/));
    await userEvent.clear(campoValor);
    await userEvent.type(campoValor, "1000{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Troco")).toBeVisible();
    });
    expect(screen.getByText("R$ 0,10")).toBeVisible();
  });

  it("🔑 a venda inteira acontece sem um clique de mouse", async () => {
    // É o teste que sustenta o veto do papel UX/UI: se este passar apenas com
    // teclado, o balcão funciona com as duas mãos ocupadas.
    montar(PAGANDO);

    const campo = await esperarCampoDeCodigo();
    await userEvent.keyboard("7891000315507{Enter}");

    await waitFor(() => {
      expect(screen.getByText("REFRI COLA 2L")).toBeVisible();
    });
    expect(campo).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByLabelText(/Valor recebido/)).toHaveFocus();
    });

    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Troco")).toBeVisible();
    });
  });

  it("Esc volta para a bipagem, para incluir o item esquecido", async () => {
    montar(PAGANDO);
    await bipar();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Pagamento" })).toBeVisible();
    });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.getByLabelText(/Código do produto/)).toBeVisible();
    });
  });

  it("pagamento parcial mantém a tela no pagamento com o restante", async () => {
    montar({
      ...VENDENDO,
      [`/api/vendas/${VENDA_VAZIA.id}/pagamentos`]: () =>
        json(201, { forma: "DINHEIRO", valor: "500", faltaPagar: "490", troco: "0" }),
    });

    await bipar();
    await userEvent.keyboard("{Enter}");

    const campoValor = await waitFor(() => screen.getByLabelText(/Valor recebido/));
    await userEvent.clear(campoValor);
    await userEvent.type(campoValor, "500{Enter}");

    await waitFor(() => {
      expect(screen.getByLabelText(/Valor recebido/)).toHaveValue("490");
    });
    expect(screen.getByText(/Falta/)).toBeVisible();
  });

  it("recusa de pagamento vira mensagem sem perder a venda", async () => {
    montar({
      ...VENDENDO,
      [`/api/vendas/${VENDA_VAZIA.id}/pagamentos`]: () =>
        json(422, {
          erro: {
            codigo: "PAGAMENTO_EXCEDE_TOTAL",
            mensagem: "O valor recebido passa do total da venda.",
          },
        }),
    });

    await bipar();
    await userEvent.keyboard("{Enter}");

    const campoValor = await waitFor(() => screen.getByLabelText(/Valor recebido/));
    await userEvent.clear(campoValor);
    await userEvent.type(campoValor, "999999{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("passa do total");
    });
    // A venda continua de pé: o operador corrige o valor e recebe de novo.
    expect(screen.getByRole("heading", { name: "Pagamento" })).toBeVisible();
  });

  it("não envia pagamento de valor zero", async () => {
    const { chamadas } = montar(PAGANDO);
    await bipar();
    await userEvent.keyboard("{Enter}");

    const campoValor = await waitFor(() => screen.getByLabelText(/Valor recebido/));
    await userEvent.clear(campoValor);
    await userEvent.type(campoValor, "0{Enter}");

    expect(chamadas.filter((c) => c.url.endsWith("/pagamentos"))).toHaveLength(0);
  });

  it("Enter na tela de conclusão começa a próxima venda", async () => {
    montar(PAGANDO);
    await bipar();
    await userEvent.keyboard("{Enter}");

    const campoValor = await waitFor(() => screen.getByLabelText(/Valor recebido/));
    await userEvent.clear(campoValor);
    await userEvent.type(campoValor, "1000{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Troco")).toBeVisible();
    });

    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByLabelText(/Código do produto/)).toBeVisible();
    });
    expect(screen.getByText(/Bipe o primeiro produto/)).toBeVisible();
  });
});

describe("formas de pagamento", () => {
  const PAGANDO: Rotas = {
    ...VENDENDO,
    [`/api/vendas/${VENDA_VAZIA.id}/pagamentos`]: (corpo) =>
      json(201, {
        forma: (corpo as { forma: string }).forma,
        valor: "990",
        faltaPagar: "0",
        troco: "0",
      }),
    [`/api/vendas/${VENDA_VAZIA.id}/finalizar`]: () =>
      json(200, { ...VENDA_COM_ITEM, status: "FINALIZADA", troco: "0" }),
  };

  async function chegarNoPagamento(): Promise<void> {
    await userEvent.type(await esperarCampoDeCodigo(), "7891000315507{Enter}");
    await waitFor(() => {
      expect(screen.getByText("REFRI COLA 2L")).toBeVisible();
    });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByLabelText(/Valor recebido/)).toHaveFocus();
    });
  }

  it("🔑 troca a forma sem sair do campo de valor", async () => {
    // Alt+2 escolhe débito com a mão na mesma posição. Obrigar o operador a
    // sair do campo para clicar numa forma seria mouse no caminho quente.
    const { chamadas } = montar(PAGANDO);
    await chegarNoPagamento();

    await userEvent.keyboard("{Alt>}2{/Alt}");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Troco")).toBeVisible();
    });

    const pagamento = chamadas.find((c) => c.url.endsWith("/pagamentos"));
    expect((pagamento?.corpo as { forma: string }).forma).toBe("CARTAO_DEBITO");
  });

  it("também dá para escolher a forma no toque, para quem tem tela sensível", async () => {
    // O teclado é o caminho principal, não o único: parte dos balcões tem
    // monitor com toque, e o botão precisa funcionar de verdade.
    const { chamadas } = montar(PAGANDO);
    await chegarNoPagamento();

    await userEvent.click(screen.getByRole("button", { name: /PIX/ }));
    await userEvent.click(screen.getByRole("button", { name: "Receber" }));

    await waitFor(() => {
      expect(screen.getByText("Troco")).toBeVisible();
    });

    const pagamento = chamadas.find((c) => c.url.endsWith("/pagamentos"));
    expect((pagamento?.corpo as { forma: string }).forma).toBe("PIX");
  });

  it("marca a forma escolhida para quem usa leitor de tela", async () => {
    montar(PAGANDO);
    await chegarNoPagamento();

    expect(screen.getByRole("button", { name: /Dinheiro/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("sair do caixa", () => {
  it("encerra a sessão e volta para a tela de PIN", async () => {
    // Troca de turno: o operador sai, o próximo entra com a matrícula dele — é
    // o que mantém cada venda atribuída a uma pessoa real.
    montar({ ...VENDENDO, "/api/acesso/sair": () => json(204, {}) });

    await esperarCampoDeCodigo();
    await userEvent.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/PIN/)).toBeVisible();
    });
  });
});

describe("estação", () => {
  it("🔑 manda sempre a mesma estação, porque o caixa é por estação", async () => {
    // Só pode haver um caixa aberto por estação, e a série fiscal é por estação.
    // Identificador novo a cada venda faria a conferência do dia não fechar.
    const { chamadas } = montar(VENDENDO);

    await userEvent.type(await esperarCampoDeCodigo(), "7891000315507{Enter}");
    await waitFor(() => {
      expect(screen.getByText("REFRI COLA 2L")).toBeVisible();
    });

    const abertura = chamadas.find((c) => c.url === "/api/vendas");
    const estacao = (abertura?.corpo as { estacaoId?: string } | undefined)?.estacaoId;

    expect(estacao).toMatch(/^[0-9a-f-]{36}$/);
    expect(globalThis.localStorage.getItem("erp.estacao")).toBe(estacao);
  });
});

describe("cupom no fechamento da venda", () => {
  const VENDENDO_CUPOM: Rotas = {
    "/api/acesso/eu": () => json(200, OPERADOR),
    "/api/vendas": () => json(201, VENDA_VAZIA),
    [`/api/vendas/${VENDA_VAZIA.id}/itens`]: () =>
      json(201, { item: ITEM, venda: VENDA_COM_ITEM }),
    [`/api/vendas/${VENDA_VAZIA.id}/pagamentos`]: () =>
      json(201, { forma: "DINHEIRO", valor: "1000", faltaPagar: "0", troco: "10" }),
    [`/api/vendas/${VENDA_VAZIA.id}/finalizar`]: () =>
      json(200, { ...VENDA_COM_ITEM, status: "FINALIZADA", troco: "10" }),
  };

  function instalarPonte(imprimirCupom: ReturnType<typeof vi.fn>): void {
    definirAgenteParaTeste({
      imprimirCupom,
      abrirGaveta: vi.fn(),
    } as unknown as ClienteAgente);
  }

  afterEach(() => {
    definirAgenteParaTeste(undefined);
  });

  async function venderAtePagar(): Promise<void> {
    await userEvent.type(await esperarCampoDeCodigo(), "7891000315507{Enter}");
    await waitFor(() => {
      expect(screen.getByText("REFRI COLA 2L")).toBeVisible();
    });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Pagamento" })).toBeVisible();
    });
    await userEvent.keyboard("1000{Enter}");
  }

  it("🔑 o cupom sai com os dados da venda, e a gaveta abre no dinheiro", async () => {
    const imprimirCupom = vi.fn().mockResolvedValue(undefined);
    instalarPonte(imprimirCupom);

    montar(VENDENDO_CUPOM);
    await venderAtePagar();

    await waitFor(() => {
      expect(screen.getByText("Troco")).toBeVisible();
    });

    expect(imprimirCupom).toHaveBeenCalledTimes(1);

    const enviado = imprimirCupom.mock.calls[0]?.[0] as {
      houveDinheiro: boolean;
      cupom: { operador: string; troco: string; pagamentos: { descricao: string }[] };
    };

    expect(enviado.houveDinheiro).toBe(true);
    expect(enviado.cupom.operador).toBe(OPERADOR.nome);
    expect(enviado.cupom.troco).toBe("10");
    expect(enviado.cupom.pagamentos[0]?.descricao).toBe("Dinheiro");
  });

  it("🔑 o cupom sai DEPOIS de a venda estar gravada", async () => {
    // Imprimir antes e gravar depois produz o pior defeito deste tipo de
    // sistema: o cliente sai da loja com o cupom de uma venda que o caixa não
    // registrou.
    const ordem: string[] = [];
    const imprimirCupom = vi.fn().mockImplementation(() => {
      ordem.push("imprimiu");
      // `undefined` é "nada a avisar": o cliente do Agente já traduz o desfecho
      // em mensagem, e devolver o objeto cru faria a tela tentar renderizá-lo.
      return Promise.resolve(undefined);
    });
    instalarPonte(imprimirCupom);

    const { chamadas } = montar(VENDENDO_CUPOM);
    await venderAtePagar();

    await waitFor(() => {
      expect(ordem).toContain("imprimiu");
    });

    expect(chamadas.some((c) => c.url.endsWith("/finalizar"))).toBe(true);
  });

  it("🔑 impressora sem papel vira aviso, não erro — a venda já aconteceu", async () => {
    // "Falhou" seria falso e faria o operador refazer a venda, que é como se
    // cobra o cliente duas vezes.
    instalarPonte(
      vi
        .fn()
        .mockResolvedValue("Cupom não impresso. A venda foi registrada normalmente."),
    );

    montar(VENDENDO_CUPOM);
    await venderAtePagar();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "A venda foi registrada normalmente",
      );
    });

    // O troco continua na tela: é o que o operador precisa conferir na mão.
    expect(screen.getByText("Troco")).toBeVisible();
  });

  it("sem ponte instalada, a venda fecha sem aviso nenhum", async () => {
    montar(VENDENDO_CUPOM);
    await venderAtePagar();

    await waitFor(() => {
      expect(screen.getByText("Troco")).toBeVisible();
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("entrada no fechamento", () => {
  it("🔑 o botão de fechar caixa some durante a venda", async () => {
    // Oferecê-lo no meio de um atendimento é convidar ao clique errado com a
    // fila esperando — e o operador perderia o carrinho.
    montar(VENDENDO);

    const usuario = userEvent.setup();
    const campo = await esperarCampoDeCodigo();

    expect(screen.getByRole("button", { name: "Fechar caixa" })).toBeVisible();

    await usuario.type(campo, "7891000315507{Enter}");

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Fechar caixa" }),
      ).not.toBeInTheDocument();
    });
  });

  it("abre a conferência e volta sem perder o balcão", async () => {
    montar(VENDENDO);

    const usuario = userEvent.setup();
    await esperarCampoDeCodigo();

    await usuario.click(screen.getByRole("button", { name: "Fechar caixa" }));

    expect(await screen.findByText("Fechamento de caixa")).toBeVisible();

    await usuario.click(screen.getByRole("button", { name: "Voltar" }));

    expect(await esperarCampoDeCodigo()).toBeVisible();
  });
});
