import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { definirAgenteParaTeste } from "../balcao.js";
import {
  type AgenteFalso,
  bipar,
  campoDeCodigo,
  CREDENCIAL,
  ID,
  instalarAgente,
  montar,
  type OpcoesServidor,
  pularOrientacao,
  recusa,
  ServidorFalso,
  totalDaVenda,
} from "./servidorFalso.js";

/**
 * Depois do pagamento: o troco, o comprovante, a gaveta — e o "passou errado,
 * cancela".
 *
 * O comprovante sai **depois** de a venda estar gravada, e problema de
 * impressora é aviso, nunca erro: a venda aconteceu.
 */

beforeEach(() => {
  globalThis.localStorage.clear();
  pularOrientacao();
  definirAgenteParaTeste(undefined);
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
  vi.restoreAllMocks();
});

/** Vende um pão de R$ 12,50 e recebe R$ 20,00 no dinheiro, pelo teclado. */
async function venderPaoNoDinheiro(
  opcoes: OpcoesServidor = {},
): Promise<{ readonly servidor: ServidorFalso; readonly usuario: UserEvent }> {
  const balcao = montar(opcoes);
  await bipar(balcao.usuario, "103");
  await totalDaVenda("R$ 12,50");

  await balcao.usuario.type(await campoDeCodigo(), "{Enter}");
  await balcao.usuario.keyboard("1");
  const valor = await screen.findByLabelText("Valor recebido");
  await balcao.usuario.clear(valor);
  await balcao.usuario.type(valor, "2000{Enter}");

  await screen.findByRole("region", { name: "Venda concluída" });
  return balcao;
}

function concluida(): HTMLElement {
  return screen.getByRole("region", { name: "Venda concluída" });
}

describe("a venda concluída", () => {
  it("🔑 o troco fica na tela até a próxima bipada, que já começa a venda nova", async () => {
    const { servidor, usuario } = await venderPaoNoDinheiro();

    expect(within(concluida()).getByLabelText("Troco a devolver")).toHaveTextContent(
      "R$ 7,50",
    );
    // O cupom à direita continua mostrando a venda que acabou, para o cliente conferir.
    await totalDaVenda("R$ 12,50");
    expect(await campoDeCodigo()).toHaveFocus();

    await bipar(usuario, "7891000315507");

    await totalDaVenda("R$ 9,90");
    expect(
      screen.queryByRole("region", { name: "Venda concluída" }),
    ).not.toBeInTheDocument();
    expect(servidor.chamadasA("POST /api/vendas")).toHaveLength(2);
  });

  it("Enter no campo vazio limpa a tela para a próxima venda", async () => {
    const { usuario } = await venderPaoNoDinheiro();

    await usuario.type(await campoDeCodigo(), "{Enter}");

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Venda concluída" }),
      ).not.toBeInTheDocument();
    });
    await totalDaVenda("R$ 0,00");
    expect(screen.getByText(/Caixa livre/)).toBeVisible();
  });

  it("o botão de nova venda faz o mesmo, e devolve o foco ao campo", async () => {
    const { usuario } = await venderPaoNoDinheiro();

    await usuario.click(
      within(concluida()).getByRole("button", { name: "Nova venda (Enter)" }),
    );

    expect(await campoDeCodigo()).toHaveFocus();
    expect(
      screen.queryByRole("region", { name: "Venda concluída" }),
    ).not.toBeInTheDocument();
  });
});

describe("comprovante e gaveta", () => {
  it("🔑 comprovante sob pedido: a gaveta abre no dinheiro, sem papel", async () => {
    const agente = instalarAgente();
    await venderPaoNoDinheiro();

    await waitFor(() => {
      expect(agente.abrirGaveta).toHaveBeenCalledTimes(1);
    });
    expect(agente.imprimirCupom).not.toHaveBeenCalled();
    expect(
      within(concluida()).getByRole("button", { name: "Imprimir comprovante (Ctrl+P)" }),
    ).toBeVisible();
  });

  it("🔑 o comprovante pedido sai pelo Agente, marcado como não fiscal, e não reabre a gaveta", async () => {
    const agente = instalarAgente();
    const { usuario } = await venderPaoNoDinheiro();

    await usuario.click(
      within(concluida()).getByRole("button", { name: "Imprimir comprovante (Ctrl+P)" }),
    );

    expect(await within(concluida()).findByText("Comprovante impresso.")).toBeVisible();
    expect(agente.imprimirCupom).toHaveBeenCalledWith(
      expect.objectContaining({
        houveDinheiro: false,
        colunas: 48,
        cupom: expect.objectContaining({
          numero: 41,
          total: "1250",
          troco: "750",
          semValorFiscal: true,
          avisos: [],
          loja: expect.objectContaining({
            nome: "Padaria Pão Quente",
            documento: "12.345.678/0001-95",
          }) as unknown,
          pagamentos: [{ descricao: "Dinheiro", valor: "2000" }],
        }) as unknown,
      }),
    );
  });

  it("🔑 comprovante sempre: sai sozinho e abre a gaveta junto", async () => {
    const agente = instalarAgente();
    await venderPaoNoDinheiro({
      configuracao: { impressaoComprovante: "SEMPRE", larguraCupom: 58 },
    });

    await waitFor(() => {
      expect(agente.imprimirCupom).toHaveBeenCalledWith(
        expect.objectContaining({ houveDinheiro: true, colunas: 32 }),
      );
    });
    expect(agente.abrirGaveta).not.toHaveBeenCalled();
    expect(await within(concluida()).findByText("Comprovante impresso.")).toBeVisible();
  });

  it("Ctrl+P imprime outra via da venda que acabou", async () => {
    const agente = instalarAgente();
    const { usuario } = await venderPaoNoDinheiro({
      configuracao: { impressaoComprovante: "SEMPRE" },
    });
    await within(concluida()).findByText("Comprovante impresso.");

    await usuario.keyboard("{Control>}p{/Control}");

    await waitFor(() => {
      expect(agente.imprimirCupom).toHaveBeenCalledTimes(2);
    });
    expect(agente.imprimirCupom).toHaveBeenLastCalledWith(
      expect.objectContaining({ houveDinheiro: false }),
    );
  });

  it("🔑 impressora sem papel vira aviso, não erro — a venda já aconteceu", async () => {
    instalarAgente({ imprimirCupom: vi.fn().mockResolvedValue("Impressora sem papel.") });
    const { usuario } = await venderPaoNoDinheiro({
      configuracao: { impressaoComprovante: "SEMPRE" },
    });

    expect(await within(concluida()).findByText("Impressora sem papel.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await usuario.click(
      within(concluida()).getByRole("button", {
        name: "Tentar imprimir de novo (Ctrl+P)",
      }),
    );
    expect(await within(concluida()).findByText("Impressora sem papel.")).toBeVisible();
  });

  it("gaveta que não abre também é só aviso", async () => {
    instalarAgente({ abrirGaveta: vi.fn().mockResolvedValue("Gaveta não abriu.") });
    await venderPaoNoDinheiro();

    expect(await screen.findByText("Gaveta não abriu.")).toBeVisible();
  });

  it("comprovante que não chega do servidor vira aviso", async () => {
    instalarAgente();
    const servidor = new ServidorFalso({
      configuracao: { impressaoComprovante: "SEMPRE" },
    });
    servidor.responder("GET /api/vendas/:id/comprovante", () =>
      recusa(500, "FALHA", "x"),
    );
    const { usuario } = montar({}, servidor);

    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await usuario.type(await campoDeCodigo(), "{Enter}");
    await usuario.keyboard("1{Enter}");

    expect(
      await screen.findByText(
        "Comprovante não impresso. A venda foi registrada normalmente.",
      ),
    ).toBeVisible();
  });

  it("🔑 sem Agente, o comprovante sai pela impressão do navegador, com a largura do papel", async () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { usuario } = await venderPaoNoDinheiro();

    await usuario.click(
      within(concluida()).getByRole("button", { name: "Imprimir comprovante (Ctrl+P)" }),
    );

    const papel = await screen.findByRole("region", {
      name: "Comprovante para impressão",
    });
    // A largura do rolo de 80 mm, no próprio elemento: é ela que a impressão usa.
    expect(papel.style.width).toBe("76mm");
    expect(papel).toHaveTextContent("Padaria Pão Quente");
    expect(papel).toHaveTextContent("*** SEM VALOR FISCAL ***");
    expect(papel).toHaveTextContent("NÃO É DOCUMENTO FISCAL");
    expect(papel).toHaveTextContent("TROCO");
    expect(papel).toHaveTextContent("(11) 3333-4444");
    expect(papel.querySelector("img")).toHaveAttribute("src", `/api/imagens/${ID(800)}`);

    await waitFor(() => {
      expect(imprimir).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Comprovante para impressão" }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("segunda via", () => {
  it("🔑 pelo menu do caixa: marcada como segunda via, sem abrir a gaveta", async () => {
    const agente = instalarAgente();
    const { usuario } = await venderPaoNoDinheiro();
    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");

    await usuario.click(screen.getByRole("button", { name: /Caixa: sangria/ }));
    await usuario.keyboard("3");

    const janela = await screen.findByRole("dialog", { name: "Reimprimir comprovante" });
    const linha = await within(janela).findByRole("listitem");
    expect(linha).toHaveTextContent("Venda 41");
    expect(linha).toHaveTextContent("Maria da Silva");
    await usuario.click(
      within(linha).getByRole("button", { name: "Imprimir segunda via" }),
    );

    expect(await screen.findByText("Segunda via da venda 41 impressa.")).toBeVisible();
    expect(agente.imprimirCupom).toHaveBeenLastCalledWith(
      expect.objectContaining({
        houveDinheiro: false,
        cupom: expect.objectContaining({ avisos: ["SEGUNDA VIA"] }) as unknown,
      }),
    );
  });

  it("Ctrl+P sem venda concluída na tela abre a segunda via; aviso da impressora aparece", async () => {
    instalarAgente({ imprimirCupom: vi.fn().mockResolvedValue("Impressora desligada.") });
    const { usuario } = await venderPaoNoDinheiro();
    await usuario.type(await campoDeCodigo(), "{Enter}");

    await usuario.keyboard("{Control>}p{/Control}");
    const janela = await screen.findByRole("dialog", { name: "Reimprimir comprovante" });
    await usuario.click(
      await within(janela).findByRole("button", { name: "Imprimir segunda via" }),
    );

    expect(await screen.findByText("Impressora desligada.")).toBeVisible();
  });

  it("sem Agente, a segunda via sai pelo navegador", async () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { usuario } = await venderPaoNoDinheiro();
    await usuario.type(await campoDeCodigo(), "{Enter}");

    await usuario.keyboard("{Control>}p{/Control}");
    const janela = await screen.findByRole("dialog", { name: "Reimprimir comprovante" });
    await usuario.click(
      await within(janela).findByRole("button", { name: "Imprimir segunda via" }),
    );

    expect(
      await screen.findByRole("region", { name: "Comprovante para impressão" }),
    ).toHaveTextContent("*** SEGUNDA VIA ***");
  });

  it("procura pelo número do cupom, e diz quando não acha", async () => {
    const { servidor, usuario } = await venderPaoNoDinheiro();
    await usuario.type(await campoDeCodigo(), "{Enter}");

    await usuario.keyboard("{Control>}p{/Control}");
    const janela = await screen.findByRole("dialog", { name: "Reimprimir comprovante" });
    const numero = within(janela).getByLabelText("Número da venda");

    await usuario.type(numero, "99{Enter}");
    expect(
      await within(janela).findByText("Não há venda com o número 99."),
    ).toBeVisible();

    await usuario.clear(numero);
    await usuario.type(numero, "41");
    await usuario.click(within(janela).getByRole("button", { name: "Procurar" }));
    expect(await within(janela).findByText(/Venda 41/)).toBeVisible();
    expect(
      servidor.chamadasA("GET /api/vendas/recentes").at(-1)?.consulta.get("numero"),
    ).toBe("41");

    await usuario.clear(numero);
    await usuario.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        servidor.chamadasA("GET /api/vendas/recentes").at(-1)?.consulta.get("limite"),
      ).toBe("10");
    });

    await usuario.click(within(janela).getByRole("button", { name: "Voltar (Esc)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lista vazia e lista que falha dizem o que houve", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();

    await usuario.keyboard("{Control>}p{/Control}");
    let janela = await screen.findByRole("dialog", { name: "Reimprimir comprovante" });
    expect(
      await within(janela).findByText("Nenhuma venda concluída neste caixa ainda."),
    ).toBeVisible();
    await usuario.keyboard("{Escape}");

    servidor.responder("GET /api/vendas/recentes", () =>
      recusa(500, "FALHA", "Lista fora do ar."),
    );
    await usuario.keyboard("{Control>}p{/Control}");
    janela = await screen.findByRole("dialog", { name: "Reimprimir comprovante" });
    expect(await within(janela).findByRole("alert")).toHaveTextContent(
      "Lista fora do ar.",
    );
  });
});

describe("cancelar a venda concluída", () => {
  it("🔑 F9 logo depois de concluir cancela a venda, com o supervisor, e diz o que devolver", async () => {
    const agente = instalarAgente();
    const { servidor, usuario } = await venderPaoNoDinheiro();
    agente.abrirGaveta.mockClear();

    await usuario.keyboard("{F9}");
    const cancelar = await screen.findByRole("dialog", { name: "Cancelar a venda 41" });
    expect(cancelar).toHaveTextContent("A venda já foi paga (R$ 12,50).");
    await usuario.click(
      within(cancelar).getByRole("button", { name: "Venda duplicada" }),
    );

    const liberacao = await screen.findByRole("dialog", {
      name: "Liberação do supervisor",
    });
    await usuario.type(
      within(liberacao).getByLabelText("Matrícula do supervisor"),
      CREDENCIAL.matricula,
    );
    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      `${CREDENCIAL.pin}{Enter}`,
    );

    expect(
      await screen.findByText(
        "Venda 41 cancelada. Devolva ao cliente: Dinheiro R$ 20,00.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Venda concluída" }),
    ).not.toBeInTheDocument();
    expect(servidor.vendaUnica().status).toBe("CANCELADA");
    await waitFor(() => {
      expect(agente.abrirGaveta).toHaveBeenCalledTimes(1);
    });
  });

  it("pelo menu, escolhendo a venda; a cancelada aparece como já cancelada", async () => {
    const { usuario } = await venderPaoNoDinheiro({
      operador: {
        id: ID(2),
        nome: "Rita Supervisora",
        matricula: "7",
        papel: "Supervisor",
        permissoes: ["caixa:abrir", "caixa:fechar", "venda:criar", "venda:cancelar"],
        precisaTrocarCredencial: false,
      },
    });
    await usuario.type(await campoDeCodigo(), "{Enter}");

    await usuario.click(screen.getByRole("button", { name: /Caixa: sangria/ }));
    await usuario.keyboard("5");
    let janela = await screen.findByRole("dialog", { name: "Cancelar venda concluída" });
    await usuario.click(
      await within(janela).findByRole("button", { name: "Cancelar esta venda" }),
    );

    const cancelar = await screen.findByRole("dialog", { name: "Cancelar a venda 41" });
    await usuario.click(
      within(cancelar).getByRole("button", { name: "Cliente desistiu da compra" }),
    );
    expect(await screen.findByText(/Venda 41 cancelada/)).toBeVisible();

    await usuario.click(screen.getByRole("button", { name: /Caixa: sangria/ }));
    await usuario.keyboard("5");
    janela = await screen.findByRole("dialog", { name: "Cancelar venda concluída" });
    const linha = await within(janela).findByRole("listitem");
    expect(linha).toHaveTextContent("cancelada");
    expect(linha).toHaveTextContent("Já cancelada");
  });

  it("venda concluída sem pagamento a devolver só diz que cancelou", async () => {
    const servidor = new ServidorFalso();
    servidor.responder("POST /api/vendas/:id/cancelar", (corpo, [id]) => {
      servidor.padrao("POST", `/api/vendas/${String(id)}/cancelar`, {
        ...corpo,
        supervisor: CREDENCIAL,
      });
      return new Response(JSON.stringify({ venda: {}, estornada: true, estornos: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const { usuario } = montar({}, servidor);
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await usuario.type(await campoDeCodigo(), "{Enter}");
    await usuario.keyboard("1{Enter}");
    await screen.findByRole("region", { name: "Venda concluída" });

    await usuario.keyboard("{F9}");
    const cancelar = await screen.findByRole("dialog", { name: "Cancelar a venda 41" });
    await usuario.click(
      within(cancelar).getByRole("button", { name: "Venda duplicada" }),
    );

    expect(await screen.findByText("Venda 41 cancelada.")).toBeVisible();
  });
});

export type { AgenteFalso };
