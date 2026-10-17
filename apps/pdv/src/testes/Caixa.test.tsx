import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { definirAgenteParaTeste } from "../balcao.js";
import {
  bipar,
  campoDeCodigo,
  CREDENCIAL,
  instalarAgente,
  montar,
  OPERADOR,
  type OpcoesServidor,
  pularOrientacao,
  recusa,
  ServidorFalso,
  SUPERVISORA,
  totalDaVenda,
} from "./servidorFalso.js";

/**
 * O caixa fora da venda: abrir, sangrar, suprir, devolver, fechar.
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

async function menu(usuario: UserEvent, tecla: string): Promise<void> {
  await usuario.click(await screen.findByRole("button", { name: /Caixa: sangria/ }));
  await screen.findByRole("dialog", { name: "Caixa" });
  await usuario.keyboard(tecla);
}

async function digitarDinheiro(
  usuario: UserEvent,
  rotulo: string,
  centavos: string,
): Promise<void> {
  const campo = await screen.findByLabelText(rotulo);
  await usuario.clear(campo);
  await usuario.type(campo, centavos);
}

describe("abertura do caixa", () => {
  it("🔑 caixa fechado leva à abertura, e não ao campo de código", async () => {
    montar({ caixaAberto: false });

    expect(await screen.findByRole("heading", { name: "Abrir o caixa" })).toBeVisible();
    expect(screen.queryByLabelText(/Código do produto/)).not.toBeInTheDocument();
  });

  it("🔑 abre com o fundo contado, no jeito da maquininha, e libera a venda", async () => {
    const { servidor, usuario } = montar({ caixaAberto: false });

    const fundo = await screen.findByLabelText("Fundo de troco");
    expect(fundo).toHaveFocus();
    await usuario.type(fundo, "10000");
    expect(fundo).toHaveValue("R$ 100,00");
    await usuario.keyboard("{Enter}");

    expect(await campoDeCodigo()).toBeVisible();
    expect(servidor.chamadasA("POST /api/caixa/abrir")[0]?.corpo).toMatchObject({
      fundoTroco: "10000",
    });
  });

  it("🔑 o fundo não digitado não vira zero", async () => {
    const { servidor, usuario } = montar({ caixaAberto: false });

    await screen.findByLabelText("Fundo de troco");
    await usuario.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o fundo de troco. Se a gaveta começa vazia, digite 0.",
    );
    expect(servidor.chamadasA("POST /api/caixa/abrir")).toHaveLength(0);
  });

  it("aceita fundo zero, que é resposta comum", async () => {
    const { servidor, usuario } = montar({ caixaAberto: false });

    await usuario.type(await screen.findByLabelText("Fundo de troco"), "0{Enter}");

    await campoDeCodigo();
    expect(servidor.chamadasA("POST /api/caixa/abrir")[0]?.corpo).toMatchObject({
      fundoTroco: "0",
    });
  });

  it("recusa do servidor aparece, sem perder o valor contado", async () => {
    const { servidor, usuario } = montar({ caixaAberto: false });
    servidor.responder("POST /api/caixa/abrir", () =>
      recusa(422, "CAIXA_JA_ABERTO", "Já existe um caixa aberto nesta estação."),
    );

    await usuario.type(await screen.findByLabelText("Fundo de troco"), "5000{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Já existe um caixa aberto nesta estação.",
    );
    expect(screen.getByLabelText("Fundo de troco")).toHaveValue("R$ 50,00");
  });

  it("dá saída sem abrir, para quem entrou na estação errada", async () => {
    const { usuario } = montar({ caixaAberto: false });

    await usuario.click(await screen.findByRole("button", { name: "Sair" }));

    expect(await screen.findByLabelText(/PIN/)).toBeVisible();
  });
});

describe("carregar o balcão", () => {
  it("🔑 servidor fora do ar não é caixa fechado: a estação vende pela fila", async () => {
    const servidor = new ServidorFalso();
    servidor.responder("GET /api/pdv/contexto", () => {
      throw new TypeError("Failed to fetch");
    });
    montar({}, servidor);

    expect(await campoDeCodigo()).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Abrir o caixa" }),
    ).not.toBeInTheDocument();
  });

  it("sem servidor, usa a configuração guardada da última vez", async () => {
    const primeira = montar({ configuracao: { recursos: ["BOTOES_RAPIDOS"] } });
    await campoDeCodigo();
    expect(
      JSON.parse(globalThis.localStorage.getItem("erp.pdv.configuracao") ?? "{}"),
    ).toMatchObject({
      recursos: ["BOTOES_RAPIDOS"],
    });
    primeira.servidor.fora = true;

    const servidor = new ServidorFalso();
    servidor.responder("GET /api/pdv/contexto", () => {
      throw new TypeError("Failed to fetch");
    });
    document.body.innerHTML = "";
    montar({}, servidor);

    expect(await screen.findByRole("region", { name: "Produtos rápidos" })).toBeVisible();
  });

  it("configuração guardada ilegível vira o padrão seguro", async () => {
    globalThis.localStorage.setItem("erp.pdv.configuracao", "{quebrado");
    const servidor = new ServidorFalso();
    servidor.responder("GET /api/pdv/contexto", () => {
      throw new TypeError("Failed to fetch");
    });
    montar({}, servidor);

    expect(await campoDeCodigo()).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Produtos rápidos" }),
    ).not.toBeInTheDocument();
  });

  it("armazenamento bloqueado não impede o balcão de carregar", async () => {
    const gravarDeVerdade = Storage.prototype.setItem.bind(globalThis.localStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      (chave: string, valor: string) => {
        if (chave === "erp.pdv.configuracao") throw new Error("cheio");
        gravarDeVerdade(chave, valor);
      },
    );
    montar();

    expect(await campoDeCodigo()).toBeVisible();
  });

  it("falha que não é queda mostra o erro, com tentar de novo", async () => {
    const servidor = new ServidorFalso();
    servidor.responder("GET /api/pdv/contexto", () =>
      recusa(500, "FALHA", "O servidor da loja encontrou um problema."),
    );
    const { usuario } = montar({}, servidor);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O servidor da loja encontrou um problema.",
    );

    await usuario.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await campoDeCodigo()).toBeVisible();
  });

  it("do erro também dá para sair", async () => {
    const servidor = new ServidorFalso();
    servidor.responder("GET /api/pdv/contexto", () => recusa(500, "FALHA", "Problema."));
    const { usuario } = montar({}, servidor);

    await screen.findByRole("alert");
    await usuario.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByLabelText(/PIN/)).toBeVisible();
  });
});

describe("fechamento do caixa", () => {
  it("🔑 não mostra o esperado antes de o operador contar", async () => {
    const { usuario } = montar();
    await campoDeCodigo();

    await menu(usuario, "6");

    expect(
      await screen.findByRole("heading", { name: "Fechamento de caixa" }),
    ).toBeVisible();
    expect(screen.queryByText(/Esperado/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Total contado na gaveta")).toHaveFocus();
  });

  it("🔑 a diferença aparece depois da contagem, com o relatório do dia", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();
    await menu(usuario, "6");

    await digitarDinheiro(usuario, "Total contado na gaveta", "13250");
    await usuario.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "Caixa fechado" })).toBeVisible();
    const diferenca = screen.getByRole("region", { name: "Diferença apurada" });
    expect(diferenca).toHaveTextContent("A gaveta bateu");
    expect(diferenca).toHaveTextContent("R$ 0,00");

    const gaveta = screen.getByRole("region", { name: "Dinheiro na gaveta" });
    expect(gaveta).toHaveTextContent("Troco devolvido- R$ 7,50");
    expect(gaveta).toHaveTextContent("Devolvido em dinheiro- R$ 5,00");
    expect(gaveta).toHaveTextContent("Esperado na gaveta");

    const vendas = screen.getByRole("region", { name: "Vendas do caixa" });
    expect(vendas).toHaveTextContent("4 vendas · R$ 120,00 vendidos");
    expect(vendas).toHaveTextContent("Cancelamentos (1)R$ 9,90");
    expect(vendas).toHaveTextContent("Devoluções (1)R$ 5,00");
    expect(vendas).toHaveTextContent("Vendido no fiado (a receber)R$ 15,00");

    const formas = screen.getByRole("region", { name: "Por forma de pagamento" });
    expect(formas).toHaveTextContent("PixR$ 30,00");
    expect(formas).toHaveTextContent("DébitoR$ 25,00");

    expect(servidor.chamadasA("POST /api/caixa/fechar")[0]?.corpo).toMatchObject({
      contadoEmDinheiro: "13250",
      vendasPendentes: 0,
    });
  });

  it("sobra é distinguida de falta", async () => {
    const { usuario } = montar();
    await campoDeCodigo();
    await menu(usuario, "6");

    await digitarDinheiro(usuario, "Total contado na gaveta", "13300");
    await usuario.keyboard("{Enter}");

    const diferenca = await screen.findByRole("region", { name: "Diferença apurada" });
    expect(diferenca).toHaveTextContent("Sobra");
    expect(diferenca).toHaveTextContent("R$ 0,50");
  });

  it("falta aparece como falta, e o dia sem extras esconde as linhas vazias", async () => {
    const servidor = new ServidorFalso();
    servidor.conferencia = {
      ...servidor.conferencia,
      quantidadeVendas: 1,
      devolvidoEmDinheiro: "0",
      totalAReceber: "0",
      porForma: [],
    };
    const { usuario } = montar({}, servidor);
    await campoDeCodigo();
    await menu(usuario, "6");

    await digitarDinheiro(usuario, "Total contado na gaveta", "13000");
    await usuario.keyboard("{Enter}");

    const diferenca = await screen.findByRole("region", { name: "Diferença apurada" });
    expect(diferenca).toHaveTextContent("Falta");
    expect(diferenca).toHaveTextContent("R$ 2,50");
    expect(screen.getByRole("region", { name: "Vendas do caixa" })).toHaveTextContent(
      "1 venda ·",
    );
    expect(screen.queryByText("Devolvido em dinheiro")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Por forma de pagamento" }),
    ).not.toBeInTheDocument();
  });

  it("contagem não digitada não fecha o caixa", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();
    await menu(usuario, "6");

    await screen.findByLabelText("Total contado na gaveta");
    await usuario.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Conte o dinheiro da gaveta e digite o total.",
    );
    expect(servidor.chamadasA("POST /api/caixa/fechar")).toHaveLength(0);
  });

  it("🔑 informa ao servidor quantas vendas ainda não subiram", async () => {
    instalarAgente({
      estado: vi.fn().mockResolvedValue({ tipo: "CONECTADO", pendentes: 3 }),
    });
    const { servidor, usuario } = montar();
    await campoDeCodigo();
    await menu(usuario, "6");

    await digitarDinheiro(usuario, "Total contado na gaveta", "13250");
    await usuario.keyboard("{Enter}");

    await screen.findByRole("heading", { name: "Caixa fechado" });
    expect(
      servidor.chamadasA("POST /api/caixa/fechar")[0]?.corpo["vendasPendentes"],
    ).toBe(3);
  });

  it("ponte quebrada não impede o fechamento do dia", async () => {
    instalarAgente({ estado: vi.fn().mockRejectedValue(new Error("IPC caiu")) });
    const { servidor, usuario } = montar();
    await campoDeCodigo();
    await menu(usuario, "6");

    await digitarDinheiro(usuario, "Total contado na gaveta", "13250");
    await usuario.keyboard("{Enter}");

    await screen.findByRole("heading", { name: "Caixa fechado" });
    expect(
      servidor.chamadasA("POST /api/caixa/fechar")[0]?.corpo["vendasPendentes"],
    ).toBe(0);
  });

  it("🔑 recusa do servidor vira mensagem que o operador entende", async () => {
    const { servidor, usuario } = montar();
    servidor.responder("POST /api/caixa/fechar", () =>
      recusa(
        422,
        "VENDAS_PENDENTES",
        "Há 3 vendas desta estação ainda não enviadas. Aguarde a rede voltar.",
      ),
    );
    await campoDeCodigo();
    await menu(usuario, "6");

    await digitarDinheiro(usuario, "Total contado na gaveta", "13250");
    await usuario.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Há 3 vendas desta estação ainda não enviadas.",
    );
  });

  it("voltar não fecha o caixa", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();
    await menu(usuario, "6");

    await usuario.click(await screen.findByRole("button", { name: "Voltar" }));

    expect(await campoDeCodigo()).toBeVisible();
    expect(servidor.chamadasA("POST /api/caixa/fechar")).toHaveLength(0);
  });

  it("concluir leva à abertura do próximo caixa", async () => {
    const { usuario } = montar();
    await campoDeCodigo();
    await menu(usuario, "6");

    await digitarDinheiro(usuario, "Total contado na gaveta", "13250");
    await usuario.keyboard("{Enter}");
    await usuario.click(await screen.findByRole("button", { name: "Concluir" }));

    expect(await screen.findByRole("heading", { name: "Abrir o caixa" })).toBeVisible();
  });

  it("🔑 no meio da venda, fechar o caixa e trocar de operador ficam indisponíveis", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.click(screen.getByRole("button", { name: /Caixa: sangria/ }));
    const janela = await screen.findByRole("dialog", { name: "Caixa" });
    expect(within(janela).getByRole("button", { name: /Fechar o caixa/ })).toBeDisabled();
    expect(
      within(janela).getByRole("button", { name: /Trocar operador/ }),
    ).toBeDisabled();
    expect(janela).toHaveTextContent("conclua ou guarde (F7) a venda da tela");

    await usuario.keyboard("6");
    expect(screen.getByRole("dialog", { name: "Caixa" })).toBeVisible();
    expect(servidor.chamadasA("POST /api/caixa/fechar")).toHaveLength(0);

    await usuario.click(within(janela).getByRole("button", { name: "Voltar (Esc)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("sangria e suprimento", () => {
  it("🔑 o suprimento registra valor e motivo, e abre a gaveta", async () => {
    const agente = instalarAgente();
    const { servidor, usuario } = montar();
    await campoDeCodigo();

    await menu(usuario, "1");
    const janela = await screen.findByRole("dialog", { name: /Suprimento/ });
    await digitarDinheiro(usuario, "Valor", "5000");
    await usuario.click(within(janela).getByRole("button", { name: "Reforço de troco" }));
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar suprimento de R$ 50,00" }),
    );

    expect(await screen.findByText("Suprimento de R$ 50,00 registrado.")).toBeVisible();
    expect(servidor.chamadasA("POST /api/caixa/suprimento")[0]?.corpo).toMatchObject({
      valor: "5000",
      motivo: "Reforço de troco",
    });
    await waitFor(() => {
      expect(agente.abrirGaveta).toHaveBeenCalledTimes(1);
    });
  });

  it("valor e motivo são obrigatórios — e o menu também atende ao toque", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();

    await usuario.click(await screen.findByRole("button", { name: /Caixa: sangria/ }));
    await usuario.click(
      within(await screen.findByRole("dialog", { name: "Caixa" })).getByRole("button", {
        name: /Suprimento/,
      }),
    );
    const janela = await screen.findByRole("dialog", { name: /Suprimento/ });
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar suprimento" }),
    );

    expect(janela).toHaveTextContent("Digite o valor.");
    expect(janela).toHaveTextContent(
      "Escreva o motivo, ou toque num dos motivos prontos.",
    );
    expect(servidor.chamadasA("POST /api/caixa/suprimento")).toHaveLength(0);

    await usuario.click(within(janela).getByRole("button", { name: "Voltar (Esc)" }));
  });

  it("🔑 sem a permissão, a sangria explica quem faz — e não mostra formulário", async () => {
    const { usuario } = montar({ operador: OPERADOR });
    await campoDeCodigo();

    await menu(usuario, "2");
    const janela = await screen.findByRole("dialog", { name: /Sangria/ });

    expect(janela).toHaveTextContent("A sangria é feita pelo supervisor ou pelo gerente");
    expect(within(janela).queryByLabelText("Valor")).not.toBeInTheDocument();
    await usuario.click(within(janela).getByRole("button", { name: "Entendi (Esc)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("🔑 o supervisor faz a sangria com o motivo escrito", async () => {
    const { servidor, usuario } = montar({ operador: SUPERVISORA });
    await campoDeCodigo();

    await menu(usuario, "2");
    const janela = await screen.findByRole("dialog", { name: /Sangria/ });
    await digitarDinheiro(usuario, "Valor", "20000");
    await usuario.type(within(janela).getByLabelText("Motivo"), "Cofre da tarde{Enter}");

    expect(await screen.findByText("Sangria de R$ 200,00 registrada.")).toBeVisible();
    expect(servidor.chamadasA("POST /api/caixa/sangria")[0]?.corpo).toMatchObject({
      valor: "20000",
      motivo: "Cofre da tarde",
    });
  });

  it("sangria acima do limite pede a liberação, e passa com ela", async () => {
    const { servidor, usuario } = montar({ operador: SUPERVISORA });
    servidor.responder("POST /api/caixa/sangria", () =>
      recusa(403, "AUTORIZACAO_NECESSARIA", "Sangria acima do seu limite de R$ 500,00."),
    );
    await campoDeCodigo();

    await menu(usuario, "2");
    const janela = await screen.findByRole("dialog", { name: /Sangria/ });
    await digitarDinheiro(usuario, "Valor", "90000");
    await usuario.click(
      within(janela).getByRole("button", { name: "Retirada para o cofre" }),
    );
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar sangria de R$ 900,00" }),
    );

    const liberacao = await screen.findByRole("dialog", {
      name: "Liberação do supervisor",
    });
    expect(liberacao).toHaveTextContent("Sangria acima do seu limite de R$ 500,00.");
    await usuario.type(
      within(liberacao).getByLabelText("Matrícula do supervisor"),
      CREDENCIAL.matricula,
    );
    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      `${CREDENCIAL.pin}{Enter}`,
    );

    expect(await screen.findByText("Sangria de R$ 900,00 registrada.")).toBeVisible();
  });
});

async function vendaConcluida(
  opcoes: OpcoesServidor,
  formaTecla = "1",
): Promise<{ readonly servidor: ServidorFalso; readonly usuario: UserEvent }> {
  const balcao = montar(opcoes);
  await bipar(balcao.usuario, "7891000315507");
  await totalDaVenda("R$ 9,90");
  await bipar(balcao.usuario, "7891000315507");
  await bipar(balcao.usuario, "103");
  await totalDaVenda("R$ 32,30");

  await balcao.usuario.type(await campoDeCodigo(), "{Enter}");
  await balcao.usuario.keyboard(formaTecla);
  if (formaTecla === "5") {
    const cliente = await screen.findByRole("dialog", { name: "Cliente da venda" });
    await balcao.usuario.type(within(cliente).getByLabelText("Nome do cliente"), "jo");
    await balcao.usuario.click(
      await within(cliente).findByRole("button", { name: /José da Silva/ }),
    );
    await balcao.usuario.click(
      await screen.findByRole("button", { name: "Lançar no fiado (Enter)" }),
    );
  } else {
    await balcao.usuario.keyboard("{Enter}");
  }
  await screen.findByRole("region", { name: "Venda concluída" });
  await balcao.usuario.type(await campoDeCodigo(), "{Enter}");

  return balcao;
}

async function abrirDevolucao(usuario: UserEvent): Promise<HTMLElement> {
  await menu(usuario, "4");
  const janela = await screen.findByRole("dialog", { name: "Devolução" });
  await usuario.click(
    await within(janela).findByRole("button", { name: "Devolver itens" }),
  );
  return screen.findByRole("dialog", { name: "Devolução da venda 41" });
}

describe("devolução", () => {
  it("🔑 sem a permissão, explica que o supervisor faz", async () => {
    const { usuario } = montar({ operador: OPERADOR });
    await campoDeCodigo();

    await menu(usuario, "4");
    const janela = await screen.findByRole("dialog", { name: "Devolução" });
    expect(janela).toHaveTextContent(
      "A devolução é feita pelo supervisor ou pelo gerente",
    );
    await usuario.click(within(janela).getByRole("button", { name: "Entendi (Esc)" }));
  });

  it("🔑 devolução parcial: um item de volta ao estoque, reembolso em dinheiro", async () => {
    const agente = instalarAgente();
    const { servidor, usuario } = await vendaConcluida({ operador: SUPERVISORA });
    agente.abrirGaveta.mockClear();

    const janela = await abrirDevolucao(usuario);
    const itens = within(janela).getByRole("list", { name: "Itens da venda" });
    expect(itens).toHaveTextContent("Vendido: 2 un · pode voltar: 2 un");
    expect(
      within(janela).queryByRole("button", { name: "Abater do fiado" }),
    ).not.toBeInTheDocument();

    await usuario.type(within(janela).getByLabelText("Devolver de REFRI COLA 2L"), "1");
    await usuario.click(
      within(janela).getByRole("button", { name: "Produto com defeito" }),
    );
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar devolução" }),
    );

    expect(
      await screen.findByText(
        "Devolução da venda 41 registrada: R$ 9,90. Entregue R$ 9,90 em dinheiro ao cliente.",
      ),
    ).toBeVisible();
    expect(servidor.chamadasA("POST /api/vendas/:id/devolucoes")[0]?.corpo).toMatchObject(
      {
        itens: [
          {
            numeroItem: 1,
            quantidade: { milesimos: "1000", unidade: "UN" },
            destino: "ESTOQUE",
          },
        ],
        formaReembolso: "DINHEIRO",
        motivo: "Produto com defeito",
      },
    );
    await waitFor(() => {
      expect(agente.abrirGaveta).toHaveBeenCalledTimes(1);
    });
  });

  it("devolver tudo, com um item estragado, pelo Pix", async () => {
    const { servidor, usuario } = await vendaConcluida({ operador: SUPERVISORA });

    const janela = await abrirDevolucao(usuario);
    await usuario.click(within(janela).getByRole("button", { name: "Devolver tudo" }));
    expect(within(janela).getByLabelText("Devolver de REFRI COLA 2L")).toHaveValue("2");
    expect(within(janela).getByLabelText("Devolver de PAO FRANCES")).toHaveValue("1");

    const [, pao] = within(janela).getAllByRole("checkbox", {
      name: "Estragado (perda)",
    });
    if (pao === undefined) throw new Error("caixa de perda ausente");
    await usuario.click(pao);
    await usuario.click(within(janela).getByRole("button", { name: "Pix" }));
    await usuario.type(
      within(janela).getByLabelText("Motivo da devolução"),
      "Pão amanhecido{Enter}",
    );

    expect(
      await screen.findByText(/Faça um Pix de R\$ 32,30 para o cliente\./),
    ).toBeVisible();
    expect(servidor.chamadasA("POST /api/vendas/:id/devolucoes")[0]?.corpo).toMatchObject(
      {
        itens: [
          { numeroItem: 1, destino: "ESTOQUE" },
          { numeroItem: 2, destino: "PERDA" },
        ],
        formaReembolso: "PIX",
      },
    );
  });

  it("o item já devolvido aparece assim, e estorno no cartão orienta a maquininha", async () => {
    const { usuario } = await vendaConcluida({ operador: SUPERVISORA });

    let janela = await abrirDevolucao(usuario);
    await usuario.type(within(janela).getByLabelText("Devolver de PAO FRANCES"), "1");
    await usuario.click(
      within(janela).getByRole("button", { name: "Estorno no cartão" }),
    );
    await usuario.click(within(janela).getByRole("button", { name: "Troca" }));
    await usuario.keyboard("{Enter}");
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar devolução" }),
    );
    expect(
      await screen.findByText(/Faça o estorno de R\$ 12,50 na maquininha\./),
    ).toBeVisible();

    janela = await abrirDevolucao(usuario);
    expect(janela).toHaveTextContent("já devolvido");
    expect(within(janela).getByLabelText("Devolver de PAO FRANCES")).toBeDisabled();

    await usuario.click(within(janela).getByRole("button", { name: "Outra venda" }));
    expect(await screen.findByRole("dialog", { name: "Devolução" })).toBeVisible();
  });

  it("venda no fiado pode abater do fiado", async () => {
    const { usuario } = await vendaConcluida({ operador: SUPERVISORA }, "5");

    const janela = await abrirDevolucao(usuario);
    await usuario.type(within(janela).getByLabelText("Devolver de PAO FRANCES"), "1");
    await usuario.click(within(janela).getByRole("button", { name: "Abater do fiado" }));
    await usuario.click(within(janela).getByRole("button", { name: "Cliente desistiu" }));
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar devolução" }),
    );

    expect(
      await screen.findByText(/O valor foi abatido do fiado do cliente\./),
    ).toBeVisible();
  });

  it("sem quantidade, quantidade torta ou sem motivo, a janela explica", async () => {
    const { servidor, usuario } = await vendaConcluida({ operador: SUPERVISORA });
    const janela = await abrirDevolucao(usuario);
    const registrar = within(janela).getByRole("button", { name: "Registrar devolução" });

    await usuario.click(registrar);
    expect(within(janela).getByRole("alert")).toHaveTextContent(
      "Digite a quantidade de ao menos um item",
    );

    await usuario.type(
      within(janela).getByLabelText("Devolver de REFRI COLA 2L"),
      "1,2,3",
    );
    await usuario.click(registrar);
    expect(within(janela).getByRole("alert")).toHaveTextContent(
      "Quantidade inválida em REFRI COLA 2L.",
    );

    await usuario.clear(within(janela).getByLabelText("Devolver de REFRI COLA 2L"));
    await usuario.type(within(janela).getByLabelText("Devolver de REFRI COLA 2L"), "1");
    await usuario.click(registrar);
    expect(within(janela).getByRole("alert")).toHaveTextContent(
      "Escreva o motivo da devolução",
    );

    expect(servidor.chamadasA("POST /api/vendas/:id/devolucoes")).toHaveLength(0);
  });

  it("recusa do servidor e falha ao abrir a venda aparecem na janela", async () => {
    const { servidor, usuario } = await vendaConcluida({ operador: SUPERVISORA });

    servidor.responder("GET /api/vendas/:id/devolucoes", () =>
      recusa(500, "FALHA", "Venda indisponível agora."),
    );
    await menu(usuario, "4");
    let janela = await screen.findByRole("dialog", { name: "Devolução" });
    await usuario.click(
      await within(janela).findByRole("button", { name: "Devolver itens" }),
    );
    expect(await within(janela).findByText("Venda indisponível agora.")).toBeVisible();
    await usuario.keyboard("{Escape}");

    servidor.responder("POST /api/vendas/:id/devolucoes", () =>
      recusa(
        422,
        "DEVOLUCAO_ACIMA_DO_VENDIDO",
        "Não dá para devolver mais do que foi vendido.",
      ),
    );
    janela = await abrirDevolucao(usuario);
    await usuario.type(within(janela).getByLabelText("Devolver de REFRI COLA 2L"), "1");
    await usuario.click(within(janela).getByRole("button", { name: "Troca" }));
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar devolução" }),
    );

    expect(
      await within(janela).findByText("Não dá para devolver mais do que foi vendido."),
    ).toBeVisible();
  });

  it("estorno acima do limite pede a liberação; desistir não registra nada", async () => {
    const { servidor, usuario } = await vendaConcluida({ operador: SUPERVISORA });
    servidor.responder("POST /api/vendas/:id/devolucoes", () =>
      recusa(
        403,
        "AUTORIZACAO_NECESSARIA",
        "Estorno em dinheiro acima do seu limite de R$ 200,00.",
      ),
    );

    const janela = await abrirDevolucao(usuario);
    await usuario.type(within(janela).getByLabelText("Devolver de REFRI COLA 2L"), "1");
    await usuario.click(within(janela).getByRole("button", { name: "Troca" }));
    await usuario.click(
      within(janela).getByRole("button", { name: "Registrar devolução" }),
    );

    await screen.findByRole("dialog", { name: "Liberação do supervisor" });
    await usuario.keyboard("{Escape}");

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Liberação do supervisor" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: "Devolução da venda 41" })).toBeVisible();
    expect(servidor.vendaUnica().devolvido.size).toBe(0);
  });

  it("venda cancelada não serve para devolução", async () => {
    const { usuario } = await vendaConcluida({
      operador: { ...SUPERVISORA, permissoes: [...SUPERVISORA.permissoes] },
    });

    await menu(usuario, "5");
    const cancelar = await screen.findByRole("dialog", {
      name: "Cancelar venda concluída",
    });
    await usuario.click(
      await within(cancelar).findByRole("button", { name: "Cancelar esta venda" }),
    );
    await usuario.click(
      within(
        await screen.findByRole("dialog", { name: "Cancelar a venda 41" }),
      ).getByRole("button", {
        name: "Venda duplicada",
      }),
    );
    await screen.findByText(/Venda 41 cancelada/);

    await menu(usuario, "4");
    const janela = await screen.findByRole("dialog", { name: "Devolução" });
    expect(await within(janela).findByText("Venda cancelada")).toBeVisible();
    expect(
      within(janela).queryByRole("button", { name: "Devolver itens" }),
    ).not.toBeInTheDocument();
  });
});
