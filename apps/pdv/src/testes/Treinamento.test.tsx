import { ClienteApi, Sessao } from "@erp/cliente-api";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App.js";
import { definirAgenteParaTeste } from "../balcao.js";
import { ProvedorModo } from "../modo.js";
import {
  bipar,
  campoDeCodigo,
  instalarAgente,
  type OpcoesServidor,
  pularOrientacao,
  recusa,
  ServidorFalso,
  totalDaVenda,
} from "./servidorFalso.js";

/**
 * O modo treinamento na tela (ADR-0026): o botão na entrada da loja, a troca
 * do cliente da API para `/treino`, e o que a estação deixa de fazer no treino
 * — gaveta, fila, configuração guardada.
 */

interface Montado {
  readonly loja: ServidorFalso;
  readonly treino: ServidorFalso | undefined;
  readonly usuario: UserEvent;
}

/**
 * A loja e o treino atrás do mesmo endereço, como no servidor de verdade: o
 * que começa com `/treino` vai para o banco do treino.
 */
function montarComTreino(
  opcoes: {
    readonly loja?: OpcoesServidor;
    readonly treino?: OpcoesServidor | false;
  } = {},
): Montado {
  const loja = new ServidorFalso({ autenticado: false, ...opcoes.loja });
  const treino =
    opcoes.treino === false
      ? undefined
      : new ServidorFalso({ modo: "TREINAMENTO", autenticado: false, ...opcoes.treino });

  const buscar = (url: string, pedido?: RequestInit): Promise<Response> => {
    if (!url.startsWith("/treino")) return loja.buscar(url, pedido);
    if (treino === undefined) {
      return Promise.resolve(recusa(404, "NAO_ENCONTRADO", "Recurso não encontrado."));
    }

    return treino.buscar(url.slice("/treino".length), pedido);
  };

  render(
    <ProvedorModo
      criarCliente={(base) =>
        new ClienteApi(new Sessao(), base, buscar as unknown as typeof fetch)
      }
    >
      <App />
    </ProvedorModo>,
  );

  return { loja, treino, usuario: userEvent.setup() };
}

async function entrar(usuario: UserEvent, matricula: string, pin: string): Promise<void> {
  await usuario.type(await screen.findByLabelText(/Matrícula/), matricula);
  await usuario.type(screen.getByLabelText(/PIN/), `${pin}{Enter}`);
}

async function menu(usuario: UserEvent, tecla: string): Promise<void> {
  await usuario.click(await screen.findByRole("button", { name: /Caixa: sangria/ }));
  await screen.findByRole("dialog", { name: "Caixa" });
  await usuario.keyboard(tecla);
}

/** Do botão "Treinar" até a tela de venda do treino. */
async function treinarAteAVenda(usuario: UserEvent): Promise<void> {
  await usuario.click(
    await screen.findByRole("button", { name: "Treinar, sem valer de verdade" }),
  );
  await screen.findByRole("heading", { name: "Treinamento" });
  await entrar(usuario, "901", "121212");
  await campoDeCodigo();
}

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  pularOrientacao();
  definirAgenteParaTeste(undefined);
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
  vi.restoreAllMocks();
});

describe("entrar no treino", () => {
  it("🔑 a entrada da loja oferece o treino quando o servidor tem um", async () => {
    montarComTreino();

    expect(
      await screen.findByRole("button", { name: "Treinar, sem valer de verdade" }),
    ).toBeVisible();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("servidor sem treino: a entrada da loja não mostra o botão", async () => {
    const { loja } = montarComTreino({ treino: false });

    await screen.findByLabelText(/Matrícula/);
    await waitFor(() => {
      expect(loja.chamadas.length).toBeGreaterThan(0);
    });

    expect(screen.queryByRole("button", { name: /Treinar/ })).not.toBeInTheDocument();
  });

  it("🔑 Treinar mostra com quem entrar, e tudo passa a ir para /treino", async () => {
    const { loja, treino, usuario } = montarComTreino();

    await usuario.click(
      await screen.findByRole("button", { name: "Treinar, sem valer de verdade" }),
    );

    expect(await screen.findByRole("heading", { name: "Treinamento" })).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("MODO TREINAMENTO");
    const pessoas = await screen.findByRole("region", { name: "Pessoas de treino" });
    expect(within(pessoas).getByText("121212")).toBeVisible();
    expect(within(pessoas).getByText("7890000000017")).toBeVisible();

    await entrar(usuario, "901", "121212");
    await campoDeCodigo();

    expect(treino?.chamadasA("POST /api/acesso/login")).toHaveLength(1);
    expect(treino?.chamadasA("GET /api/pdv/contexto")).toHaveLength(1);
    expect(loja.chamadasA("POST /api/acesso/login")).toHaveLength(0);
    expect(loja.chamadasA("GET /api/pdv/contexto")).toHaveLength(0);
    expect(screen.getByRole("note")).toHaveTextContent("MODO TREINAMENTO");
  });

  it("🔑 o treino fica na aba: o F5 continua nele, e a janela nova volta à loja", async () => {
    const { usuario } = montarComTreino();
    await usuario.click(
      await screen.findByRole("button", { name: "Treinar, sem valer de verdade" }),
    );
    await screen.findByRole("heading", { name: "Treinamento" });

    expect(globalThis.sessionStorage.getItem("erp.pdv.treinamento")).toBe("sim");
    expect(globalThis.localStorage.getItem("erp.pdv.treinamento")).toBeNull();
  });

  it("aba que já estava no treino abre no treino", async () => {
    globalThis.sessionStorage.setItem("erp.pdv.treinamento", "sim");

    montarComTreino();

    expect(await screen.findByRole("heading", { name: "Treinamento" })).toBeVisible();
  });

  it("treino fora do ar: a entrada do treino diz o que houve e deixa voltar", async () => {
    globalThis.sessionStorage.setItem("erp.pdv.treinamento", "sim");
    const { treino, usuario } = montarComTreino();
    treino?.responder("GET /api/treinamento", () =>
      recusa(503, "TREINAMENTO_INDISPONIVEL", "O treinamento não está disponível agora."),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O treinamento não está disponível agora.",
    );

    await usuario.click(
      screen.getByRole("button", { name: "Voltar ao caixa de verdade" }),
    );

    expect(await screen.findByRole("heading", { name: "Caixa" })).toBeVisible();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(globalThis.sessionStorage.getItem("erp.pdv.treinamento")).toBeNull();
  });
});

describe("vender no treino", () => {
  it("🔑 a venda em dinheiro não abre a gaveta de verdade", async () => {
    const agente = instalarAgente();
    const { treino, usuario } = montarComTreino();
    await treinarAteAVenda(usuario);

    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");
    await usuario.type(await campoDeCodigo(), "{Enter}");
    await screen.findByRole("region", { name: "Pagamento" });
    await usuario.keyboard("1");
    const recebido = await screen.findByLabelText("Valor recebido");
    await usuario.clear(recebido);
    await usuario.type(recebido, "2000{Enter}");

    await screen.findByRole("region", { name: "Venda concluída" });
    expect(
      treino?.chamadasA("POST /api/vendas/:id/pagamentos")[0]?.corpo["confirmacao"],
    ).toBe("SIMULADA");
    expect(agente.abrirGaveta).not.toHaveBeenCalled();
  });

  it("🔑 o comprovante do treino sai pelo Agente sem pedir a gaveta", async () => {
    const agente = instalarAgente();
    const { usuario } = montarComTreino({
      treino: { configuracao: { impressaoComprovante: "SEMPRE" } },
    });
    await treinarAteAVenda(usuario);

    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");
    await usuario.type(await campoDeCodigo(), "{Enter}");
    await screen.findByRole("region", { name: "Pagamento" });
    await usuario.keyboard("1");
    const recebido = await screen.findByLabelText("Valor recebido");
    await usuario.clear(recebido);
    await usuario.type(recebido, "2000{Enter}");

    await waitFor(() => {
      expect(agente.imprimirCupom).toHaveBeenCalledWith(
        expect.objectContaining({ houveDinheiro: false }),
      );
    });
    expect(agente.abrirGaveta).not.toHaveBeenCalled();
  });

  it("🔑 a configuração do treino não fica guardada na estação", async () => {
    const { usuario } = montarComTreino();
    await treinarAteAVenda(usuario);

    expect(globalThis.localStorage.getItem("erp.pdv.configuracao")).toBeNull();
  });

  it("o indicador da fila do Agente não aparece no treino", async () => {
    instalarAgente({
      estado: vi.fn().mockResolvedValue({ tipo: "OFFLINE", pendentes: 2 }),
    });
    const { usuario } = montarComTreino();
    await treinarAteAVenda(usuario);

    // Dá tempo de o indicador perguntar ao Agente, se ele estivesse na tela.
    await new Promise((resolver) => setTimeout(resolver, 50));
    expect(screen.queryByText(/Sem conexão com o servidor/)).not.toBeInTheDocument();
  });

  it("servidor do treino fora do ar ao carregar: o treino para e diz por quê", async () => {
    instalarAgente();
    const { treino, usuario } = montarComTreino();
    await usuario.click(
      await screen.findByRole("button", { name: "Treinar, sem valer de verdade" }),
    );
    await screen.findByRole("heading", { name: "Treinamento" });
    treino?.responder("GET /api/pdv/contexto", () => {
      throw new TypeError("Failed to fetch");
    });

    await entrar(usuario, "901", "121212");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sem conexão com o servidor da loja",
    );
    expect(screen.queryByLabelText(/Código do produto/)).not.toBeInTheDocument();
  });

  it("a ajuda (F1) mostra os códigos para treinar sem leitor", async () => {
    const { usuario } = montarComTreino();
    await treinarAteAVenda(usuario);

    await usuario.keyboard("{F1}");

    const ajuda = await screen.findByRole("dialog", { name: "Ajuda do caixa" });
    expect(
      within(ajuda).getByText("Sem leitor? Digite no campo do caixa:"),
    ).toBeVisible();
    expect(within(ajuda).getByText("7890000000017")).toBeVisible();
  });
});

describe("o caixa no treino", () => {
  it("a abertura do caixa mostra a faixa do treino", async () => {
    const { usuario } = montarComTreino({ treino: { caixaAberto: false } });
    await usuario.click(
      await screen.findByRole("button", { name: "Treinar, sem valer de verdade" }),
    );
    await entrar(usuario, "901", "121212");

    expect(await screen.findByRole("heading", { name: "Abrir o caixa" })).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("MODO TREINAMENTO");
  });

  it("🔑 o fechamento do treino não é travado pelas vendas da fila da loja", async () => {
    instalarAgente({
      estado: vi.fn().mockResolvedValue({ tipo: "CONECTADO", pendentes: 3 }),
    });
    const { treino, usuario } = montarComTreino();
    await treinarAteAVenda(usuario);
    await menu(usuario, "6");

    expect(screen.getByRole("note")).toHaveTextContent("MODO TREINAMENTO");
    const campo = await screen.findByLabelText("Total contado na gaveta");
    await usuario.clear(campo);
    await usuario.type(campo, "13250{Enter}");

    await screen.findByRole("heading", { name: "Caixa fechado" });
    expect(treino?.chamadasA("POST /api/caixa/fechar")[0]?.corpo["vendasPendentes"]).toBe(
      0,
    );
  });

  it("🔑 recomeçar pede confirmação, chama o treino e volta para a entrada dele", async () => {
    const { loja, treino, usuario } = montarComTreino();
    await treinarAteAVenda(usuario);

    await menu(usuario, "8");
    const confirmar = await screen.findByRole("dialog", { name: "Recomeçar o treino" });
    expect(within(confirmar).getByText("A loja de verdade não é tocada.")).toBeVisible();
    expect(treino?.chamadasA("POST /api/treinamento/recomecar")).toHaveLength(0);

    await usuario.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "Treinamento" })).toBeVisible();
    expect(treino?.chamadasA("POST /api/treinamento/recomecar")).toHaveLength(1);
    // Na loja, só a tentativa de restaurar a sessão, da entrada de antes do treino.
    expect(
      loja.chamadas
        .filter((chamada) => chamada.metodo === "POST")
        .map((chamada) => chamada.caminho),
    ).toEqual(["/api/acesso/renovar"]);
  });

  it("🔑 sair do treino volta à entrada da loja, sem faixa", async () => {
    const { treino, usuario } = montarComTreino();
    await treinarAteAVenda(usuario);

    await menu(usuario, "9");

    expect(await screen.findByRole("heading", { name: "Caixa" })).toBeVisible();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(treino?.chamadasA("POST /api/acesso/sair")).toHaveLength(1);
    expect(globalThis.sessionStorage.getItem("erp.pdv.treinamento")).toBeNull();
  });

  it("o menu da loja não tem as opções do treino", async () => {
    const loja = new ServidorFalso();
    const buscar = loja.buscar as unknown as typeof fetch;
    render(
      <ProvedorModo criarCliente={(base) => new ClienteApi(new Sessao(), base, buscar)}>
        <App />
      </ProvedorModo>,
    );
    const usuario = userEvent.setup();
    await campoDeCodigo();

    await usuario.click(await screen.findByRole("button", { name: /Caixa: sangria/ }));
    const menuDoCaixa = await screen.findByRole("dialog", { name: "Caixa" });

    expect(
      within(menuDoCaixa).queryByRole("button", { name: /Recomeçar o treino/ }),
    ).not.toBeInTheDocument();
    expect(
      within(menuDoCaixa).queryByRole("button", { name: /Sair do treino/ }),
    ).not.toBeInTheDocument();
  });
});
