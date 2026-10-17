import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { definirAgenteParaTeste } from "../balcao.js";
import {
  bipar,
  campoDeCodigo,
  ID,
  montar,
  type ProdutoFalso,
  pularOrientacao,
  QUEIJO,
  recusa,
  REFRI,
  totalDaVenda,
  vendaAberta,
} from "./servidorFalso.js";

/**
 * O pagamento, do Enter ao troco.
 *
 * Inclui os três exemplos de conferência pedidos para o produto: R$ 12,50
 * pagos com R$ 20,00 (troco de R$ 7,50) e R$ 50,00 pagos com R$ 20,00 em
 * dinheiro e R$ 30,00 no Pix (saldo zero, sem troco). O terceiro — o peso — está
 * nos testes da venda.
 */

const CESTA: ProdutoFalso = {
  id: ID(110),
  sku: "110",
  descricao: "CESTA DE CAFE",
  tipo: "UNITARIO",
  unidade: "UN",
  precoVenda: "5000",
};

const PAO_1250: ProdutoFalso = {
  id: ID(103),
  sku: "103",
  descricao: "PAO FRANCES",
  tipo: "UNITARIO",
  unidade: "UN",
  precoVenda: "1250",
};

beforeEach(() => {
  globalThis.localStorage.clear();
  pularOrientacao();
  definirAgenteParaTeste(undefined);
});

afterEach(() => {
  definirAgenteParaTeste(undefined);
});

function pagamento(): HTMLElement {
  return screen.getByRole("region", { name: "Pagamento" });
}

async function receber(usuario: UserEvent): Promise<HTMLElement> {
  await usuario.type(await campoDeCodigo(), "{Enter}");
  return screen.findByRole("region", { name: "Pagamento" });
}

async function digitarValor(
  usuario: UserEvent,
  rotulo: string,
  centavos: string,
): Promise<void> {
  const campo = await screen.findByLabelText(rotulo);
  await usuario.clear(campo);
  await usuario.type(campo, `${centavos}{Enter}`);
}

describe("abrir o pagamento", () => {
  it("🔑 Enter no campo vazio abre o pagamento, com a falta e as formas", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    const area = await receber(usuario);

    expect(within(area).getByLabelText("Falta receber")).toHaveTextContent("R$ 12,50");
    const formas = within(area).getByRole("group", { name: "Formas de pagamento" });
    expect(
      within(formas)
        .getAllByRole("button")
        .map((botao) => botao.textContent),
    ).toEqual(["1Dinheiro", "2Pix", "3Débito", "4Crédito", "5Fiado"]);
    expect(within(formas).getAllByRole("button")[0]).toHaveFocus();
  });

  it("F10 também abre o pagamento", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F10}");
    expect(await screen.findByRole("region", { name: "Pagamento" })).toBeVisible();
  });

  it("Esc volta para a bipagem, para incluir o item esquecido", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("{Escape}");

    expect(await campoDeCodigo()).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Pagamento" })).not.toBeInTheDocument();
  });

  it("o botão de voltar faz o mesmo que o Esc", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    const area = await receber(usuario);

    await usuario.click(
      within(area).getByRole("button", { name: "Voltar para a venda (Esc)" }),
    );
    expect(await campoDeCodigo()).toBeVisible();
  });

  it("sem o recurso de fiado, a forma nem aparece", async () => {
    const { usuario } = montar({ configuracao: { recursos: [] } });
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    const area = await receber(usuario);
    expect(within(area).queryByRole("button", { name: /Fiado/ })).not.toBeInTheDocument();
  });
});

describe("dinheiro", () => {
  it("🔑 exemplo: R$ 12,50 pagos com R$ 20,00 → troco de R$ 7,50", async () => {
    const { servidor, usuario } = montar({ produtos: [PAO_1250] });
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("1");
    const valor = await screen.findByLabelText("Valor recebido");
    expect(valor).toHaveValue("R$ 12,50");
    expect(valor).toHaveFocus();

    await usuario.clear(valor);
    await usuario.type(valor, "2000");
    expect(within(pagamento()).getByText("R$ 7,50")).toBeVisible();
    await usuario.keyboard("{Enter}");

    const concluida = await screen.findByRole("region", { name: "Venda concluída" });
    expect(within(concluida).getByLabelText("Troco a devolver")).toHaveTextContent(
      "R$ 7,50",
    );
    expect(concluida).toHaveTextContent("Venda 41 concluída · R$ 12,50");

    const [pago] = servidor.chamadasA("POST /api/vendas/:id/pagamentos");
    expect(pago?.corpo).toMatchObject({ forma: "DINHEIRO", valor: "2000" });
    expect(pago?.corpo["confirmacao"]).toBeUndefined();
    expect(servidor.chamadasA("POST /api/vendas/:id/finalizar")).toHaveLength(1);
  });

  it("🔑 o valor exato fecha a venda direto, sem troco", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("1{Enter}");

    const concluida = await screen.findByRole("region", { name: "Venda concluída" });
    expect(concluida).toHaveTextContent("Sem troco");
  });

  it("valor zero não vai ao servidor", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("1");
    await usuario.clear(await screen.findByLabelText("Valor recebido"));
    await usuario.keyboard("{Enter}");

    expect(within(pagamento()).getByRole("alert")).toHaveTextContent("Digite o valor.");
    expect(servidor.chamadasA("POST /api/vendas/:id/pagamentos")).toHaveLength(0);
  });

  it("pagamento parcial fica na lista, com a falta atualizada, e pode ser tirado", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("1");
    await digitarValor(usuario, "Valor recebido", "500");

    const lista = await within(pagamento()).findByRole("list", {
      name: "Pagamentos registrados",
    });
    expect(lista).toHaveTextContent("Dinheiro");
    expect(within(pagamento()).getByLabelText("Falta receber")).toHaveTextContent(
      "R$ 7,50",
    );

    await usuario.click(
      within(lista).getByRole("button", { name: "Tirar o pagamento de R$ 5,00" }),
    );

    await waitFor(() => {
      expect(
        within(pagamento()).queryByRole("list", { name: "Pagamentos registrados" }),
      ).not.toBeInTheDocument();
    });
    expect(within(pagamento()).getByLabelText("Falta receber")).toHaveTextContent(
      "R$ 12,50",
    );
    expect(
      servidor.chamadasA("POST /api/vendas/:id/pagamentos/:indice/remover"),
    ).toHaveLength(1);
  });

  it("Esc no valor volta à escolha da forma, e Alt+número troca a forma ali mesmo", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("1");
    await screen.findByLabelText("Valor recebido");
    await usuario.keyboard("{Alt>}2{/Alt}");
    expect(
      await within(pagamento()).findByRole("heading", { name: "Pix" }),
    ).toBeVisible();

    await usuario.keyboard("{Escape}");
    expect(
      within(pagamento()).getByRole("group", { name: "Formas de pagamento" }),
    ).toBeVisible();

    // No passo da escolha, o número sem Alt; e tecla que não é forma é ignorada.
    await usuario.keyboard("9");
    expect(
      within(pagamento()).getByRole("group", { name: "Formas de pagamento" }),
    ).toBeVisible();
  });

  it("o botão de outra forma faz o mesmo que o Esc", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.click(within(pagamento()).getByRole("button", { name: /Débito/ }));
    await usuario.click(
      await within(pagamento()).findByRole("button", { name: "Outra forma (Esc)" }),
    );
    expect(
      within(pagamento()).getByRole("group", { name: "Formas de pagamento" }),
    ).toBeVisible();
  });
});

describe("pagamento misto, Pix e cartão", () => {
  it("🔑 exemplo: R$ 50,00 = R$ 20,00 em dinheiro + R$ 30,00 no Pix → saldo zero, sem troco", async () => {
    const { servidor, usuario } = montar({ produtos: [CESTA] });
    await bipar(usuario, "110");
    await totalDaVenda("R$ 50,00");
    await receber(usuario);

    await usuario.keyboard("1");
    await digitarValor(usuario, "Valor recebido", "2000");
    await within(pagamento()).findByRole("list", { name: "Pagamentos registrados" });
    expect(within(pagamento()).getByLabelText("Falta receber")).toHaveTextContent(
      "R$ 30,00",
    );

    await usuario.keyboard("2");
    expect(
      within(pagamento()).getByText(/Confira no aplicativo do banco que o Pix caiu/),
    ).toBeVisible();
    expect(await screen.findByLabelText("Valor no pix")).toHaveValue("R$ 30,00");
    await usuario.keyboard("{Enter}");

    const concluida = await screen.findByRole("region", { name: "Venda concluída" });
    expect(concluida).toHaveTextContent("Sem troco");

    const pagamentos = servidor
      .chamadasA("POST /api/vendas/:id/pagamentos")
      .map((chamada) => chamada.corpo);
    expect(pagamentos).toMatchObject([
      { forma: "DINHEIRO", valor: "2000" },
      { forma: "PIX", valor: "3000", confirmacao: "MANUAL" },
    ]);
    expect(pagamentos[0]?.["chave"]).not.toBe(pagamentos[1]?.["chave"]);
    expect(servidor.vendaUnica().pagamentos).toHaveLength(2);
  });

  it("🔑 o Pix confirmado pelo operador aparece assim na lista", async () => {
    const { usuario } = montar({ produtos: [CESTA] });
    await bipar(usuario, "110");
    await totalDaVenda("R$ 50,00");
    await receber(usuario);

    await usuario.keyboard("2");
    await digitarValor(usuario, "Valor no pix", "1000");

    const lista = await within(pagamento()).findByRole("list", {
      name: "Pagamentos registrados",
    });
    expect(lista).toHaveTextContent("Pix (conferido pelo operador)");
  });

  it("crédito leva o código de autorização da maquininha e as parcelas — nunca o número do cartão", async () => {
    const { servidor, usuario } = montar({ produtos: [CESTA] });
    await bipar(usuario, "110");
    await totalDaVenda("R$ 50,00");
    await receber(usuario);

    await usuario.keyboard("4");
    expect(within(pagamento()).getByText(/Passe o cartão na maquininha/)).toBeVisible();

    const autorizacao = within(pagamento()).getByLabelText(
      "Código de autorização da maquininha (opcional)",
    );
    await usuario.type(autorizacao, "AB-12 3");
    expect(autorizacao).toHaveValue("AB123");
    await usuario.selectOptions(within(pagamento()).getByLabelText("Parcelas"), "3");
    await usuario.click(
      within(pagamento()).getByRole("button", { name: "Cartão aprovado (Enter)" }),
    );

    await screen.findByRole("region", { name: "Venda concluída" });
    expect(servidor.chamadasA("POST /api/vendas/:id/pagamentos")[0]?.corpo).toMatchObject(
      {
        forma: "CARTAO_CREDITO",
        valor: "5000",
        autorizacao: "AB123",
        parcelas: 3,
        confirmacao: "MANUAL",
      },
    );
  });

  it("débito sem código vai sem código, e o parcelado aparece na lista", async () => {
    const { servidor, usuario } = montar({ produtos: [CESTA] });
    await bipar(usuario, "110");
    await totalDaVenda("R$ 50,00");
    await receber(usuario);

    await usuario.keyboard("4");
    await usuario.selectOptions(within(pagamento()).getByLabelText("Parcelas"), "2");
    await digitarValor(usuario, "Valor no crédito", "1000");
    expect(
      await within(pagamento()).findByRole("list", { name: "Pagamentos registrados" }),
    ).toHaveTextContent("Crédito em 2 vezes");

    await usuario.keyboard("3{Enter}");
    await screen.findByRole("region", { name: "Venda concluída" });

    const debito = servidor.chamadasA("POST /api/vendas/:id/pagamentos")[1]?.corpo;
    expect(debito).toMatchObject({ forma: "CARTAO_DEBITO", valor: "4000" });
    expect(debito?.["autorizacao"]).toBeUndefined();
    expect(debito?.["parcelas"]).toBeUndefined();
  });

  it("🔑 pagamento recusado vira mensagem, e a venda continua de pé", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("2");
    await digitarValor(usuario, "Valor no pix", "9999");

    expect(
      await within(screen.getByRole("region", { name: "Venda" })).findByRole("alert"),
    ).toHaveTextContent("Só o dinheiro pode passar do valor da venda.");
    expect(within(pagamento()).getByLabelText("Falta receber")).toHaveTextContent(
      "R$ 12,50",
    );
    await totalDaVenda("R$ 12,50");
  });

  it("🔑 a resposta perdida não cobra duas vezes: o Enter de novo leva a mesma chave", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    // O servidor registra, e a resposta se perde no caminho.
    servidor.responder("POST /api/vendas/:id/pagamentos", (corpo, [id]) => {
      servidor.padrao("POST", `/api/vendas/${String(id)}/pagamentos`, corpo);
      return recusa(
        503,
        "SERVIDOR_OCUPADO",
        "O servidor demorou para responder. Tente de novo.",
      );
    });

    await receber(usuario);
    await usuario.keyboard("1");
    await digitarValor(usuario, "Valor recebido", "2000");
    expect(
      await screen.findByText("O servidor demorou para responder. Tente de novo."),
    ).toBeVisible();

    await usuario.click(
      within(pagamento()).getByRole("button", { name: "Receber dinheiro (Enter)" }),
    );

    const concluida = await screen.findByRole("region", { name: "Venda concluída" });
    expect(within(concluida).getByLabelText("Troco a devolver")).toHaveTextContent(
      "R$ 7,50",
    );

    const [primeira, segunda] = servidor.chamadasA("POST /api/vendas/:id/pagamentos");
    expect(primeira?.corpo["chave"]).toEqual(expect.any(String));
    expect(segunda?.corpo["chave"]).toBe(primeira?.corpo["chave"]);
    expect(servidor.vendaUnica().pagamentos).toHaveLength(1);
  });
});

describe("fiado", () => {
  it("🔑 o fiado pede o cliente na hora e lança na conta dele", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("5");

    const cliente = await screen.findByRole("dialog", { name: "Cliente da venda" });
    await usuario.type(within(cliente).getByLabelText("Nome do cliente"), "jo");
    await usuario.click(
      await within(cliente).findByRole("button", { name: /José da Silva/ }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(pagamento()).toHaveTextContent("Cliente: José da Silva");
    expect(pagamento()).toHaveTextContent("Fiado disponível: R$ 200,00");

    await usuario.click(
      within(pagamento()).getByRole("button", { name: "Lançar no fiado (Enter)" }),
    );

    await screen.findByRole("region", { name: "Venda concluída" });
    expect(servidor.chamadasA("POST /api/vendas/:id/pagamentos")[0]?.corpo).toMatchObject(
      {
        forma: "CREDIARIO",
        valor: "1250",
      },
    );
  });

  it("sem cliente escolhido, o fiado não deixa lançar", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("5");
    await usuario.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(pagamento()).toHaveTextContent("Escolha o cliente do fiado.");
    expect(
      within(pagamento()).getByRole("button", { name: "Lançar no fiado (Enter)" }),
    ).toBeDisabled();

    await usuario.click(
      within(pagamento()).getByRole("button", { name: "Escolher cliente (F6)" }),
    );
    expect(await screen.findByRole("dialog", { name: "Cliente da venda" })).toBeVisible();
  });

  it("cliente sem fiado liberado: a tela diz antes de tentar", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);

    await usuario.keyboard("5");
    const cliente = await screen.findByRole("dialog", { name: "Cliente da venda" });
    await usuario.type(within(cliente).getByLabelText("Nome do cliente"), "josef");
    await usuario.click(
      await within(cliente).findByRole("button", { name: /Josefa Souza/ }),
    );

    expect(await within(pagamento()).findByRole("alert")).toHaveTextContent(
      "Este cliente não tem fiado liberado.",
    );
    expect(
      within(pagamento()).getByRole("button", { name: "Lançar no fiado (Enter)" }),
    ).toBeDisabled();
    expect(
      within(pagamento()).getByRole("button", { name: "Trocar cliente (F6)" }),
    ).toBeVisible();
  });
});

describe("a venda já paga", () => {
  it("🔑 a venda recuperada com tudo pago conclui no Enter", async () => {
    const paga = vendaAberta({
      numero: 77,
      totalPago: "990",
      faltaPagar: "0",
      pagamentos: [
        {
          indice: 0,
          forma: "DINHEIRO",
          descricao: "Dinheiro",
          valor: "990",
          parcelas: 1,
          confirmacao: "MANUAL",
        },
      ],
    });
    const { servidor, usuario } = montar({ abertas: [paga] });
    await totalDaVenda("R$ 9,90");

    await receber(usuario);
    expect(pagamento()).toHaveTextContent("O valor da venda já foi recebido.");
    expect(
      within(pagamento()).getByRole("button", { name: "Concluir a venda (Enter)" }),
    ).toHaveFocus();

    await usuario.keyboard("{Enter}");

    await screen.findByRole("region", { name: "Venda concluída" });
    expect(servidor.chamadasA("POST /api/vendas/:id/finalizar")).toHaveLength(1);
  });

  it("finalização que falha deixa a venda paga na tela, para concluir de novo", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    servidor.responder("POST /api/vendas/:id/finalizar", () =>
      recusa(
        503,
        "SERVIDOR_OCUPADO",
        "O servidor demorou para responder. Tente de novo.",
      ),
    );

    await receber(usuario);
    await usuario.keyboard("1{Enter}");

    expect(
      await screen.findByText("O servidor demorou para responder. Tente de novo."),
    ).toBeVisible();
    await usuario.click(
      within(pagamento()).getByRole("button", { name: "Concluir a venda (Enter)" }),
    );

    await screen.findByRole("region", { name: "Venda concluída" });
    expect(servidor.chamadasA("POST /api/vendas/:id/finalizar")).toHaveLength(2);
  });

  it("no modo treinamento, todo pagamento é simulado e a tela avisa", async () => {
    const { servidor, usuario } = montar({ modo: "TREINAMENTO" });

    expect(await screen.findByRole("note")).toHaveTextContent("MODO TREINAMENTO");

    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await receber(usuario);
    await usuario.keyboard("1{Enter}");

    await screen.findByRole("region", { name: "Venda concluída" });
    expect(
      servidor.chamadasA("POST /api/vendas/:id/pagamentos")[0]?.corpo["confirmacao"],
    ).toBe("SIMULADA");
  });

  it("produtos de peso e de unidade fecham juntos", async () => {
    const { usuario } = montar({ produtos: [REFRI, QUEIJO] });

    await bipar(usuario, "102");
    const peso = await screen.findByRole("dialog", { name: "Peso de QUEIJO MUSSARELA" });
    await usuario.type(within(peso).getByLabelText("Peso em gramas"), "350{Enter}");
    await totalDaVenda("R$ 7,00");
    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 16,90");

    await receber(usuario);
    await usuario.keyboard("1");
    await digitarValor(usuario, "Valor recebido", "2000");

    const concluida = await screen.findByRole("region", { name: "Venda concluída" });
    expect(within(concluida).getByLabelText("Troco a devolver")).toHaveTextContent(
      "R$ 3,10",
    );
  });
});
