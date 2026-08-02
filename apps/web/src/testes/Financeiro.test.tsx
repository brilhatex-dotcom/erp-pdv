import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Financeiro } from "../telas/Financeiro.js";

/**
 * A caderneta, do ponto de vista de quem cobra.
 *
 * Dois erros custam dinheiro aqui, e nenhum deles é a tela quebrar. O primeiro
 * é quitar um título inteiro quando o cliente pagou um pedaço. O segundo é
 * chamar para cobrança quem está em dia.
 */

const A_VENCER = {
  id: "t1",
  tipo: "RECEBER" as const,
  origem: "VENDA",
  contraparteNome: "Ana Maria de Souza",
  valorOriginal: "20000",
  totalBaixado: "0",
  saldo: "20000",
  // Bem no futuro: o rótulo de prazo é calculado contra o relógio real.
  vencimento: "2099-12-31T12:00:00.000Z",
  descricao: "Venda 42",
  situacao: "ABERTO" as const,
  vencido: false,
  diasEmAtraso: 0,
};

const ATRASADO = {
  ...A_VENCER,
  id: "t2",
  contraparteNome: "José Carlos",
  saldo: "5000",
  valorOriginal: "5000",
  vencimento: "2026-07-01T12:00:00.000Z",
  vencido: true,
  diasEmAtraso: 12,
};

const DETALHE = {
  ...A_VENCER,
  baixas: [
    {
      id: "b1",
      tipo: "PAGAMENTO" as const,
      valor: "5000",
      ocorridaEm: "2026-08-01T12:00:00.000Z",
      forma: "DINHEIRO",
    },
  ],
  totalBaixado: "5000",
  saldo: "15000",
  situacao: "PARCIAL" as const,
};

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Chamada {
  readonly url: string;
  readonly metodo: string;
  readonly corpo: unknown;
}

function montar(
  itens: unknown[],
  opcoes: {
    readonly permissoes?: readonly string[];
    readonly detalhe?: unknown;
    /** Faz toda escrita falhar, para exercitar a mensagem de erro. */
    readonly escritaFalha?: boolean;
  } = {},
): { readonly chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];

  const buscar = vi.fn((url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";

    if (url.includes("/api/financeiro")) {
      const corpo =
        typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;

      chamadas.push({ url, metodo, corpo });

      if (opcoes.escritaFalha === true && metodo !== "GET") {
        return Promise.resolve(
          json(422, {
            erro: {
              codigo: "BAIXA_ACIMA_DO_SALDO",
              mensagem: "O valor é maior que o saldo.",
            },
          }),
        );
      }

      // Detalhe e mutações devolvem o título; a lista devolve `itens`.
      if (metodo !== "GET" || /\/titulos\/[^/?]+$/.test(url)) {
        return Promise.resolve(json(200, opcoes.detalhe ?? DETALHE));
      }

      return Promise.resolve(json(200, { itens }));
    }

    return Promise.resolve(
      json(200, {
        id: "u1",
        nome: "Ana",
        permissoes: opcoes.permissoes ?? ["financeiro:ver", "financeiro:lancar"],
      }),
    );
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

  function Envolvido(): ReactNode {
    return (
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <Financeiro />
      </ProvedorSessao>
    );
  }

  render(<Envolvido />);

  return { chamadas };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("lista", () => {
  it("🔑 nomeia o atraso em dias, não só pinta de vermelho", async () => {
    // Cor sozinha não serve: cerca de 8% dos homens não distinguem vermelho de
    // verde, e o número responde a pergunta sem comparar datas de cabeça.
    montar([ATRASADO]);

    expect(await screen.findByText("12 dias em atraso")).toBeInTheDocument();
  });

  it("🔑 o que está em dia não aparece como atrasado", async () => {
    // Chamar para cobrança quem está em dia é o erro que mais custa
    // relacionamento.
    montar([A_VENCER]);

    expect(await screen.findByText(/Vence em/)).toBeInTheDocument();
    expect(screen.queryByText(/em atraso/)).not.toBeInTheDocument();
  });

  it("🔑 fala em dia e amanhã, não em data — é como o operador pensa", async () => {
    // "Vence em 2026-08-04" obriga a comparar com o calendário. O prazo em
    // palavras responde à pergunta na hora.
    // Por dia de calendário, como o servidor conta — e não por diferença de
    // horas, que diria "amanhã" para algo que vence hoje à noite.
    const emDias = (dias: number) => {
      const alvo = new Date();
      alvo.setUTCDate(alvo.getUTCDate() + dias);

      return alvo.toISOString();
    };

    montar([
      { ...A_VENCER, id: "h", vencimento: emDias(0) },
      { ...A_VENCER, id: "a", contraparteNome: "Amanhã", vencimento: emDias(1) },
    ]);

    expect(await screen.findByText("Vence hoje")).toBeInTheDocument();
    expect(screen.getByText("Vence amanhã")).toBeInTheDocument();
  });

  it("um dia de atraso é dito no singular", async () => {
    montar([{ ...ATRASADO, diasEmAtraso: 1 }]);

    expect(await screen.findByText("1 dia em atraso")).toBeInTheDocument();
  });

  it("🔑 a parcela aparece na lista — é o que o cliente pergunta", async () => {
    // "Qual parcela é essa?" é a primeira pergunta de quem tem carnê.
    montar([{ ...A_VENCER, parcela: { numero: 2, de: 6 }, descricao: undefined }]);

    expect(await screen.findByText(/2\/6/)).toBeInTheDocument();
  });

  it("conta parcialmente paga é sinalizada na lista", async () => {
    montar([{ ...A_VENCER, situacao: "PARCIAL", totalBaixado: "5000", saldo: "15000" }]);

    expect(await screen.findByText(/parcial/)).toBeInTheDocument();
  });

  it("soma o total em aberto", async () => {
    montar([A_VENCER, ATRASADO]);

    expect(await screen.findByText("R$ 250,00")).toBeInTheDocument();
    expect(screen.getByText(/2 contas/)).toBeInTheDocument();
  });

  it("uma conta é dita no singular", async () => {
    montar([A_VENCER]);

    expect(await screen.findByText(/1 conta ·/)).toBeInTheDocument();
  });

  it("lista vazia explica o que vai aparecer ali", async () => {
    montar([]);

    expect(await screen.findByText("Nenhuma conta em aberto")).toBeInTheDocument();
  });

  it("🔑 a aba a pagar consulta o outro tipo", async () => {
    const { chamadas } = montar([]);

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByRole("button", { name: "A pagar" }));

    expect(chamadas.some((chamada) => chamada.url.includes("tipo=PAGAR"))).toBe(true);
  });

  it("o filtro de vencidos manda a data para o servidor", async () => {
    const { chamadas } = montar([]);

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByLabelText("Só vencidos"));

    expect(chamadas.some((chamada) => chamada.url.includes("vencidosAte="))).toBe(true);
  });
});

describe("recebimento", () => {
  async function abrirDetalhe() {
    const resultado = montar([A_VENCER]);

    await screen.findByText("Ana Maria de Souza");
    await userEvent.click(screen.getByRole("button", { name: /Ana Maria de Souza/ }));
    await screen.findByText("Registrar recebimento");

    return resultado;
  }

  it("🔑 o campo de valor abre em branco, não com o saldo", async () => {
    // Preenchido, quem recebeu R$ 20 de uma dívida de R$ 200 confirma sem ler
    // e quita o título inteiro.
    await abrirDetalhe();

    expect(screen.getByLabelText(/Valor recebido/)).toHaveValue("");
  });

  it("🔑 quitar tudo é um botão explícito, com o valor à vista", async () => {
    const { chamadas } = await abrirDetalhe();

    await userEvent.click(screen.getByRole("button", { name: /Quitar R\$ 150,00/ }));

    const baixa = chamadas.find((chamada) => chamada.metodo === "POST");
    expect(baixa?.corpo).toMatchObject({ valor: "15000" });
  });

  it("recebimento parcial manda o que foi digitado", async () => {
    const { chamadas } = await abrirDetalhe();

    fireEvent.change(screen.getByLabelText(/Valor recebido/), {
      target: { value: "20,00" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Registrar" }));

    const baixa = chamadas.find((chamada) => chamada.metodo === "POST");
    expect(baixa?.corpo).toMatchObject({ valor: "2000", forma: "DINHEIRO" });
  });

  it("valor vazio é barrado antes da rede", async () => {
    const { chamadas } = await abrirDetalhe();

    await userEvent.click(screen.getByRole("button", { name: "Registrar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Informe o valor recebido");
    expect(chamadas.some((chamada) => chamada.metodo === "POST")).toBe(false);
  });

  it("mostra o histórico com a forma de pagamento", async () => {
    await abrirDetalhe();

    expect(screen.getByText(/Recebimento de/)).toBeInTheDocument();
    expect(screen.getByText(/DINHEIRO/)).toBeInTheDocument();
  });

  it("estorna um recebimento", async () => {
    const { chamadas } = await abrirDetalhe();

    await userEvent.click(screen.getByRole("button", { name: "Estornar" }));

    expect(chamadas.some((chamada) => chamada.url.includes("/estorno"))).toBe(true);
  });

  it("🔑 recusa do servidor vira mensagem que o operador entende", async () => {
    // O erro de regra do domínio já vem escrito para quem opera; a tela só
    // precisa não engoli-lo.
    montar([A_VENCER], { escritaFalha: true });

    await screen.findByText("Ana Maria de Souza");
    await userEvent.click(screen.getByRole("button", { name: /Ana Maria de Souza/ }));
    await screen.findByText("Registrar recebimento");

    await userEvent.click(screen.getByRole("button", { name: /Quitar/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O valor é maior que o saldo.",
    );
  });

  it("falha no estorno também é mostrada", async () => {
    montar([A_VENCER], { escritaFalha: true });

    await screen.findByText("Ana Maria de Souza");
    await userEvent.click(screen.getByRole("button", { name: /Ana Maria de Souza/ }));
    await screen.findByText("Histórico");

    await userEvent.click(screen.getByRole("button", { name: "Estornar" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("título sem recebimento diz que não há histórico", async () => {
    montar([A_VENCER], { detalhe: { ...A_VENCER, baixas: [] } });

    await screen.findByText("Ana Maria de Souza");
    await userEvent.click(screen.getByRole("button", { name: /Ana Maria de Souza/ }));

    expect(await screen.findByText("Nenhum recebimento ainda.")).toBeInTheDocument();
  });

  it("volta para a lista", async () => {
    await abrirDetalhe();

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(await screen.findByText("Financeiro")).toBeInTheDocument();
  });
});

describe("lançamento manual", () => {
  it("🔑 a conta de luz é lançada sem cadastro nenhum", async () => {
    const { chamadas } = montar([]);

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByRole("button", { name: "A pagar" }));
    await userEvent.click(screen.getByRole("button", { name: "Lançar conta" }));

    fireEvent.change(screen.getByLabelText(/Para quem/), {
      target: { value: "Companhia de Energia" },
    });
    fireEvent.change(screen.getByLabelText("Valor *(obrigatório)"), {
      target: { value: "340,00" },
    });
    fireEvent.change(screen.getByLabelText(/Vencimento/), {
      target: { value: "2026-08-15" },
    });
    fireEvent.change(screen.getByLabelText(/Descrição/), {
      target: { value: "Energia de julho" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const lancamento = chamadas.find((chamada) => chamada.metodo === "POST");
    expect(lancamento?.corpo).toEqual({
      tipo: "PAGAR",
      contraparteNome: "Companhia de Energia",
      valor: "34000",
      // Meio-dia UTC: o campo devolve só o dia, e o fuso empurraria o
      // vencimento para a véspera.
      vencimento: "2026-08-15T12:00:00.000Z",
      descricao: "Energia de julho",
    });
  });

  it("parcelas maiores que um vão no corpo", async () => {
    const { chamadas } = montar([]);

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByRole("button", { name: "Lançar conta" }));

    fireEvent.change(screen.getByLabelText(/De quem/), { target: { value: "Cliente" } });
    fireEvent.change(screen.getByLabelText("Valor *(obrigatório)"), {
      target: { value: "300,00" },
    });
    fireEvent.change(screen.getByLabelText(/Vencimento/), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText(/Parcelas/), { target: { value: "3" } });

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(chamadas.find((chamada) => chamada.metodo === "POST")?.corpo).toMatchObject({
      parcelas: 3,
    });
  });

  it("valor vazio é barrado antes da rede", async () => {
    const { chamadas } = montar([]);

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByRole("button", { name: "Lançar conta" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Informe o valor da conta");
    expect(chamadas.some((chamada) => chamada.metodo === "POST")).toBe(false);
  });

  it("vencimento vazio é barrado antes da rede", async () => {
    const { chamadas } = montar([]);

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByRole("button", { name: "Lançar conta" }));

    fireEvent.change(screen.getByLabelText("Valor *(obrigatório)"), {
      target: { value: "100,00" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Informe o vencimento");
    expect(chamadas.some((chamada) => chamada.metodo === "POST")).toBe(false);
  });

  it("falha no lançamento é mostrada, sem perder o que foi digitado", async () => {
    montar([], { escritaFalha: true });

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByRole("button", { name: "Lançar conta" }));

    fireEvent.change(screen.getByLabelText(/De quem/), { target: { value: "Cliente" } });
    fireEvent.change(screen.getByLabelText("Valor *(obrigatório)"), {
      target: { value: "100,00" },
    });
    fireEvent.change(screen.getByLabelText(/Vencimento/), {
      target: { value: "2026-09-01" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText(/De quem/)).toHaveValue("Cliente");
  });

  it("cancela sem lançar", async () => {
    montar([]);

    await screen.findByText("Nenhuma conta em aberto");
    await userEvent.click(screen.getByRole("button", { name: "Lançar conta" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Financeiro")).toBeInTheDocument();
  });
});

describe("sem permissão de lançar", () => {
  it("🔑 quem só consulta não vê como mexer em dinheiro", async () => {
    // Mostrar o botão e recusar no clique é pior que escondê-lo: o usuário
    // tenta, falha e abre chamado perguntando o que está quebrado.
    montar([A_VENCER], { permissoes: ["financeiro:ver"] });

    await screen.findByText("Ana Maria de Souza");

    expect(
      screen.queryByRole("button", { name: "Lançar conta" }),
    ).not.toBeInTheDocument();
  });

  it("o formulário de recebimento não aparece", async () => {
    montar([A_VENCER], { permissoes: ["financeiro:ver"] });

    await screen.findByText("Ana Maria de Souza");
    await userEvent.click(screen.getByRole("button", { name: /Ana Maria de Souza/ }));

    expect(await screen.findByText("Histórico")).toBeInTheDocument();
    expect(screen.queryByText("Registrar recebimento")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Estornar" })).not.toBeInTheDocument();
  });
});
