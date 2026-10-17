import type { VendaNoAgente } from "@erp/agente-contrato";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { definirAgenteParaTeste } from "../balcao.js";
import {
  type AgenteFalso,
  bipar,
  campoDeCodigo,
  instalarAgente,
  montar,
  type OpcoesServidor,
  pularOrientacao,
  ServidorFalso,
  totalDaVenda,
} from "./servidorFalso.js";

/**
 * O balcão com o servidor fora do ar.
 *
 * É o cenário que justifica o produto inteiro: a loja não pode parar de vender
 * porque um cabo caiu. O que se verifica aqui é o que o **operador** vê — que a
 * venda continua, que ele sabe que está sem conexão, e que o troco aparece
 * igual.
 */

const ITEM_LOCAL = {
  numero: 1,
  codigo: "789",
  descricao: "REFRI COLA 2L",
  quantidade: { milesimos: "1000", unidade: "UN" },
  precoUnitario: "990",
  total: "990",
};

const VENDA_LOCAL: VendaNoAgente = {
  id: "local-1",
  offline: true,
  total: "990",
  faltaPagar: "990",
  itens: [ITEM_LOCAL],
};

function agenteComFila(
  sobrescritas: Parameters<typeof instalarAgente>[0] = {},
): AgenteFalso {
  return instalarAgente({
    estado: vi.fn().mockResolvedValue({ tipo: "OFFLINE", pendentes: 2 }),
    adicionarItem: vi.fn().mockResolvedValue({ tipo: "OK", venda: VENDA_LOCAL }),
    registrarPagamento: vi.fn().mockResolvedValue({ tipo: "OK", faltaPagar: "0" }),
    finalizar: vi.fn().mockResolvedValue({ tipo: "OK", troco: "10" }),
    ...sobrescritas,
  });
}

/** O servidor autentica, a tela carrega, e aí o servidor some. */
async function servidorCaiDepoisDeCarregar(
  opcoes: OpcoesServidor = {},
): Promise<ReturnType<typeof montar>> {
  const balcao = montar(opcoes);
  await campoDeCodigo();
  balcao.servidor.fora = true;

  return balcao;
}

beforeEach(() => {
  globalThis.localStorage.clear();
  pularOrientacao();
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
  vi.restoreAllMocks();
});

describe("venda com o servidor fora do ar", () => {
  it("🔑 a venda inteira acontece, do bipe ao troco, sem tecla nenhuma a mais", async () => {
    const agente = agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar();

    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");

    await usuario.type(await campoDeCodigo(), "{Enter}");
    const pagamento = await screen.findByRole("region", { name: "Pagamento" });
    expect(
      within(pagamento).queryByRole("button", { name: /Fiado/ }),
    ).not.toBeInTheDocument();
    expect(pagamento).toHaveTextContent(
      "Sem conexão com o servidor, o fiado fica indisponível.",
    );

    await usuario.keyboard("1");
    const valor = await screen.findByLabelText("Valor recebido");
    await usuario.clear(valor);
    await usuario.type(valor, "1000{Enter}");

    const concluida = await screen.findByRole("region", { name: "Venda concluída" });
    expect(within(concluida).getByLabelText("Troco a devolver")).toHaveTextContent(
      "R$ 0,10",
    );
    expect(concluida).toHaveTextContent("Venda concluída sem conexão");
    expect(agente.iniciarVenda).toHaveBeenCalledTimes(1);
    expect(agente.registrarPagamento).toHaveBeenCalledWith("DINHEIRO", "1000");
    expect(agente.finalizar).toHaveBeenCalledTimes(1);
  });

  it("🔑 o operador sabe que está sem conexão, e que as vendas estão guardadas", async () => {
    agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar();

    expect(await screen.findByText("Sem conexão com o servidor")).toBeVisible();
    expect(screen.getByText(/2 vendas aguardando envio/)).toBeVisible();

    await bipar(usuario, "789");
    expect(
      await screen.findByText(/Venda sem conexão com o servidor: bipe, receba e conclua/),
    ).toBeVisible();
  });

  it("🔑 a venda offline não inventa número", async () => {
    agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar();

    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");

    expect(screen.getByText(/Venda sem conexão · Maria da Silva/)).toBeVisible();
  });

  it("🔑 produto fora do catálogo local vira mensagem de operador", async () => {
    agenteComFila({
      adicionarItem: vi.fn().mockResolvedValue({
        tipo: "ERRO",
        mensagem: "Produto não está no catálogo desta estação.",
      }),
    });
    const { usuario } = await servidorCaiDepoisDeCarregar();

    await bipar(usuario, "789");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Produto não está no catálogo desta estação. (código 789)",
    );
  });

  it("🔑 uma vez na fila, a venda continua na fila, mesmo se o servidor voltar", async () => {
    const agente = agenteComFila();
    const { servidor, usuario } = await servidorCaiDepoisDeCarregar();

    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");
    servidor.fora = false;
    await bipar(usuario, "789");

    await waitFor(() => {
      expect(agente.adicionarItem).toHaveBeenCalledTimes(2);
    });
    expect(servidor.chamadasA("POST /api/vendas/:id/itens")).toHaveLength(0);
  });

  it("3*código sem conexão bipa três vezes na fila", async () => {
    const agente = agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar();

    await bipar(usuario, "3*789");

    await waitFor(() => {
      expect(agente.adicionarItem).toHaveBeenCalledTimes(3);
    });
  });

  it("desconto, cliente e guardar explicam que dependem do servidor", async () => {
    agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar();
    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");

    for (const tecla of ["{F3}", "{F4}", "{F6}", "{F7}", "{F8}"]) {
      await usuario.keyboard(tecla);
      expect(
        await screen.findByText(
          /Sem conexão com o servidor, só dá para bipar, receber e concluir/,
        ),
      ).toBeVisible();
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("🔑 desistir da venda sem conexão pede confirmação e descarta a fila", async () => {
    const agente = agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar();
    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");

    await usuario.keyboard("{F9}");
    const desistir = await screen.findByRole("dialog", { name: "Desistir da venda" });
    expect(desistir).toHaveTextContent(
      "Os itens desta venda sem conexão serão descartados.",
    );
    await usuario.keyboard("{Enter}");

    expect(await screen.findByText("Venda descartada.")).toBeVisible();
    expect(agente.cancelar).toHaveBeenCalledTimes(1);
    await totalDaVenda("R$ 0,00");
  });

  it("🔑 o comprovante sai pela estação, sem número e marcado, e a gaveta abre junto", async () => {
    const agente = agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar({
      configuracao: { impressaoComprovante: "SEMPRE", larguraCupom: 58 },
    });

    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");
    await usuario.type(await campoDeCodigo(), "{Enter}");
    await usuario.keyboard("1");
    const valor = await screen.findByLabelText("Valor recebido");
    await usuario.clear(valor);
    await usuario.type(valor, "1000{Enter}");

    await waitFor(() => {
      expect(agente.imprimirCupom).toHaveBeenCalledWith(
        expect.objectContaining({
          houveDinheiro: true,
          colunas: 32,
          cupom: expect.objectContaining({
            numero: 0,
            avisos: ["VENDA SEM CONEXAO"],
            loja: { nome: "Padaria Pão Quente" },
            semValorFiscal: true,
          }) as unknown,
        }),
      );
    });
  });

  it("🔑 no treino, servidor fora não manda a venda para a fila — e diz por quê", async () => {
    // A fila do Agente entrega ao servidor de verdade: uma venda de treino
    // ali entraria no movimento da loja (ADR-0026).
    const agente = agenteComFila();
    const { usuario } = await servidorCaiDepoisDeCarregar({ modo: "TREINAMENTO" });

    await bipar(usuario, "789");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O treino precisa do servidor da loja",
    );
    expect(agente.iniciarVenda).not.toHaveBeenCalled();
    expect(agente.adicionarItem).not.toHaveBeenCalled();
  });

  it("falha da fila ao receber ou concluir vira mensagem, e a venda fica na tela", async () => {
    agenteComFila({
      registrarPagamento: vi
        .fn()
        .mockResolvedValueOnce({ tipo: "ERRO", mensagem: "Disco cheio na estação." })
        .mockResolvedValue({ tipo: "OK", faltaPagar: "0" }),
      finalizar: vi
        .fn()
        .mockResolvedValueOnce({
          tipo: "ERRO",
          mensagem: "Não foi possível gravar a venda.",
        })
        .mockResolvedValue({ tipo: "OK", troco: "0" }),
    });
    const { usuario } = await servidorCaiDepoisDeCarregar();
    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");

    await usuario.type(await campoDeCodigo(), "{Enter}");
    await usuario.keyboard("1{Enter}");
    expect(await screen.findByText("Disco cheio na estação.")).toBeVisible();

    await usuario.click(screen.getByRole("button", { name: "Receber dinheiro (Enter)" }));
    expect(await screen.findByText("Não foi possível gravar a venda.")).toBeVisible();

    await usuario.click(screen.getByRole("button", { name: "Concluir a venda (Enter)" }));
    expect(
      await screen.findByRole("region", { name: "Venda concluída" }),
    ).toHaveTextContent("Sem troco");
  });

  it("sem conexão, o pagamento não tem botão de tirar", async () => {
    agenteComFila({
      registrarPagamento: vi.fn().mockResolvedValue({ tipo: "OK", faltaPagar: "490" }),
    });
    const { usuario } = await servidorCaiDepoisDeCarregar();
    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");

    await usuario.type(await campoDeCodigo(), "{Enter}");
    await usuario.keyboard("1");
    const valor = await screen.findByLabelText("Valor recebido");
    await usuario.clear(valor);
    await usuario.type(valor, "500{Enter}");

    const lista = await screen.findByRole("list", { name: "Pagamentos registrados" });
    expect(
      within(lista).queryByRole("button", { name: /Tirar/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Falta receber")).toHaveTextContent("R$ 4,90");
  });

  it("servidor fora desde o carregamento: vende pela fila com o padrão seguro", async () => {
    const agente = agenteComFila();
    const servidor = new ServidorFalso();
    servidor.responder("GET /api/caixa/aberto", () => {
      throw new TypeError("Failed to fetch");
    });
    const { usuario } = montar({}, servidor);
    await campoDeCodigo();
    servidor.fora = true;

    await bipar(usuario, "789");
    await totalDaVenda("R$ 9,90");
    expect(agente.adicionarItem).toHaveBeenCalledWith("789");
  });
});
