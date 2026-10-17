import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { definirAgenteParaTeste } from "../balcao.js";
import {
  adiado,
  bipar,
  campoDeCodigo,
  CREDENCIAL,
  ID,
  montar,
  pularOrientacao,
  recusa,
  totalDaVenda,
  vendaAberta,
} from "./servidorFalso.js";

/**
 * A venda no balcão, tecla a tecla.
 *
 * Cada teste é uma história de balcão: o que o operador faz, o que a tela
 * pede ao servidor e o que aparece. As contas são do servidor — aqui, falso —,
 * e o que se verifica é que a tela não inventa nenhuma.
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

function itens(): HTMLElement {
  return screen.getByRole("list", { name: "Itens da venda" });
}

async function janela(titulo: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: titulo });
}

describe("bipar", () => {
  it("🔑 a venda começa na primeira bipada, sem botão de iniciar", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "7891000315507");

    await totalDaVenda("R$ 9,90");
    expect(servidor.chamadasA("POST /api/vendas")).toHaveLength(1);
    expect(screen.getByText(/Venda 41 · Maria da Silva/)).toBeVisible();
  });

  it("🔑 o campo fica limpo e com o foco para a próxima bipada", async () => {
    const { usuario } = montar();

    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");

    const campo = await campoDeCodigo();
    expect(campo).toHaveValue("");
    expect(campo).toHaveFocus();
  });

  it("🔑 bipar de novo o mesmo produto soma, e a tela diz que somou", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");
    await bipar(usuario, "7891000315507");

    await totalDaVenda("R$ 19,80");
    expect(screen.getByText(/somado ao que já estava/)).toBeVisible();
    expect(within(itens()).getByText("somado")).toBeVisible();
    expect(within(itens()).getAllByRole("listitem")).toHaveLength(1);
    expect(servidor.chamadasA("POST /api/vendas")).toHaveLength(1);
  });

  it("🔑 bipadas em sequência entram todas, na ordem, sem esperar a resposta", async () => {
    const { servidor, usuario } = montar();
    const campo = await campoDeCodigo();

    await usuario.type(campo, "7891000315507{Enter}103{Enter}");

    await totalDaVenda("R$ 22,40");
    expect(
      servidor
        .chamadasA("POST /api/vendas/:id/itens")
        .map((chamada) => chamada.corpo["codigo"]),
    ).toEqual(["7891000315507", "103"]);
  });

  it("Enter no campo vazio, sem venda, só orienta", async () => {
    const { servidor, usuario } = montar();

    await usuario.type(await campoDeCodigo(), "{Enter}");

    expect(await screen.findByText("Bipe um produto primeiro.")).toBeVisible();
    expect(servidor.chamadasA("POST /api/vendas")).toHaveLength(0);
  });

  it("🔑 produto não encontrado é mensagem com o código lido, e a venda aberta é reaproveitada", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "999");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Produto não encontrado. Confira o código ou procure pelo nome. (código 999)",
    );

    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");

    // A venda que o código errado abriu é a mesma que recebeu o item certo.
    expect(servidor.chamadasA("POST /api/vendas")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("🔑 rede caída, sem Agente, não mostra 'Failed to fetch'", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();

    servidor.fora = true;
    await bipar(usuario, "7891000315507");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Sem conexão com o servidor da loja");
    expect(alerta).not.toHaveTextContent("Failed to fetch");
  });

  it("🔑 3*código lança três de uma vez, na unidade do produto", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "3*7891000315507");

    await totalDaVenda("R$ 29,70");
    expect(
      servidor.chamadasA("POST /api/vendas/:id/itens")[0]?.corpo["quantidade"],
    ).toEqual({
      milesimos: "3000",
    });
  });

  it("o * sem quantidade ou sem código explica o formato", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "x*789");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Antes do * vai a quantidade",
    );

    const campo = await campoDeCodigo();
    await usuario.clear(campo);
    await usuario.type(campo, "3*{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Depois do * bipe ou digite",
    );

    expect(servidor.chamadasA("POST /api/vendas")).toHaveLength(0);
  });

  it("meia unidade de produto inteiro é recusada pelo servidor, com a frase dele", async () => {
    const { usuario } = montar();

    await bipar(usuario, "0,5*7891000315507");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "REFRI COLA 2L é vendido por unidade inteira.",
    );
  });

  it("produto sem estoque pede o supervisor, e entra com a liberação", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "7890000000104");

    const liberacao = await janela("Liberação do supervisor");
    expect(liberacao).toHaveTextContent("Este produto está sem estoque.");

    await usuario.type(
      within(liberacao).getByLabelText("Matrícula do supervisor"),
      CREDENCIAL.matricula,
    );
    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      `${CREDENCIAL.pin}{Enter}`,
    );

    await totalDaVenda("R$ 50,00");
    expect(
      servidor.chamadasA("POST /api/vendas/:id/itens").at(-1)?.corpo["supervisor"],
    ).toEqual(CREDENCIAL);
  });

  it("🔑 PIN errado do supervisor mantém a janela, com o erro dentro", async () => {
    const { usuario } = montar();

    await bipar(usuario, "7890000000104");
    const liberacao = await janela("Liberação do supervisor");

    await usuario.type(within(liberacao).getByLabelText("Matrícula do supervisor"), "7");
    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      "000000{Enter}",
    );

    expect(await within(liberacao).findByRole("alert")).toHaveTextContent(
      "Matrícula ou PIN do supervisor incorreto.",
    );

    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      `${CREDENCIAL.pin}{Enter}`,
    );
    await totalDaVenda("R$ 50,00");
  });

  it("a liberação aceita, mas a operação recusada por outro motivo, fecha a janela e mostra o motivo", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    servidor.responder(
      "POST /api/vendas/:id/desconto",
      () =>
        recusa(
          403,
          "AUTORIZACAO_NECESSARIA",
          "Desconto acima do seu limite de 5% no item.",
        ),
      () =>
        recusa(422, "DESCONTO_INVALIDO", "O desconto não pode passar do valor do item."),
    );

    await usuario.keyboard("{F4}");
    const desconto = await janela("Desconto");
    await usuario.type(
      within(desconto).getByLabelText("Percentual de desconto"),
      "10{Enter}",
    );

    const liberacao = await janela("Liberação do supervisor");
    // Liberar sem preencher não vai ao servidor.
    await usuario.click(within(liberacao).getByRole("button", { name: "Liberar" }));
    expect(servidor.chamadasA("POST /api/vendas/:id/desconto")).toHaveLength(1);

    await usuario.type(
      within(liberacao).getByLabelText("Matrícula do supervisor"),
      CREDENCIAL.matricula,
    );
    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      `${CREDENCIAL.pin}{Enter}`,
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Liberação do supervisor" }),
      ).not.toBeInTheDocument();
    });
    expect(await within(await janela("Desconto")).findByRole("alert")).toHaveTextContent(
      "O desconto não pode passar do valor do item.",
    );
  });

  it("desistir da liberação não é erro: a tela volta sem mensagem", async () => {
    const { usuario } = montar();

    await bipar(usuario, "7890000000104");
    await janela("Liberação do supervisor");
    await usuario.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await campoDeCodigo()).toHaveFocus();
  });
});

describe("produto de peso", () => {
  it("🔑 o pesável pede o peso: 350 g × R$ 20,00/kg = R$ 7,00", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "102");

    const peso = await janela("Peso de QUEIJO MUSSARELA");
    expect(peso).toHaveTextContent("R$ 20,00/kg");

    await usuario.type(within(peso).getByLabelText("Peso em gramas"), "350");
    expect(peso).toHaveTextContent("350 g × R$ 20,00/kg = R$ 7,00");

    await usuario.keyboard("{Enter}");

    await totalDaVenda("R$ 7,00");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      servidor.chamadasA("POST /api/vendas/:id/itens").at(-1)?.corpo["quantidade"],
    ).toEqual({
      milesimos: "350000",
      unidade: "G",
    });
  });

  it("🔑 o peso também entra em quilos, com a tecla K", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "102");
    const peso = await janela("Peso de QUEIJO MUSSARELA");

    await usuario.type(within(peso).getByLabelText("Peso em gramas"), "k");
    await usuario.type(within(peso).getByLabelText("Peso em quilos"), "0,350");
    expect(peso).toHaveTextContent("0,350 kg × R$ 20,00/kg = R$ 7,00");

    await usuario.keyboard("{Enter}");

    await totalDaVenda("R$ 7,00");
    expect(
      servidor.chamadasA("POST /api/vendas/:id/itens").at(-1)?.corpo["quantidade"],
    ).toEqual({
      milesimos: "350",
      unidade: "KG",
    });
  });

  it("peso vazio explica o formato, nos gramas e nos quilos", async () => {
    const { usuario } = montar();

    await bipar(usuario, "102");
    const peso = await janela("Peso de QUEIJO MUSSARELA");

    await usuario.click(within(peso).getByRole("button", { name: "Lançar (Enter)" }));
    expect(within(peso).getByRole("alert")).toHaveTextContent(
      "Digite o peso em gramas, só números.",
    );

    await usuario.click(within(peso).getByRole("button", { name: "kg" }));
    await usuario.click(within(peso).getByRole("button", { name: "Lançar (Enter)" }));
    expect(within(peso).getByRole("alert")).toHaveTextContent("Digite o peso em quilos.");

    await usuario.click(within(peso).getByRole("button", { name: "g" }));
    await usuario.type(within(peso).getByLabelText("Peso em gramas"), "g500");
    expect(peso).toHaveTextContent("500 g × R$ 20,00/kg = R$ 10,00");
  });

  it("recusa do servidor ao peso aparece dentro da janela, que fica aberta", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "102");
    const peso = await janela("Peso de QUEIJO MUSSARELA");

    servidor.responder("POST /api/vendas/:id/itens", () =>
      recusa(422, "QUANTIDADE_INVALIDA", "Peso acima do que a balança mede."),
    );
    await usuario.type(within(peso).getByLabelText("Peso em gramas"), "350{Enter}");

    expect(await within(peso).findByRole("alert")).toHaveTextContent(
      "Peso acima do que a balança mede.",
    );
    expect(
      screen.getByRole("dialog", { name: "Peso de QUEIJO MUSSARELA" }),
    ).toBeVisible();
  });

  it("Esc fecha o peso e devolve o foco ao campo de código", async () => {
    const { usuario } = montar();

    await bipar(usuario, "102");
    await janela("Peso de QUEIJO MUSSARELA");
    await usuario.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(await campoDeCodigo()).toHaveFocus();
  });

  it("recusa ao pedido de peso sem o produto junto vira mensagem comum", async () => {
    const { servidor, usuario } = montar();

    servidor.responder("POST /api/vendas/:id/itens", () =>
      recusa(422, "PRODUTO_EXIGE_PESO", "Informe o peso de QUEIJO."),
    );
    await bipar(usuario, "102");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o peso de QUEIJO. (código 102)",
    );
  });
});

describe("procurar pelo nome", () => {
  it("🔑 nome digitado no campo abre a busca já preenchida", async () => {
    const { usuario } = montar();

    await bipar(usuario, "pao");

    const busca = await janela("Procurar produto");
    expect(within(busca).getByLabelText("Nome ou código")).toHaveValue("pao");

    await within(busca).findByText("PAO FRANCES (completo)");
    await usuario.keyboard("{Enter}");

    await totalDaVenda("R$ 12,50");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("F2 procura; as setas escolhem e o Enter lança", async () => {
    const { usuario } = montar();
    await campoDeCodigo();

    await usuario.keyboard("{F2}");
    const busca = await janela("Procurar produto");
    expect(within(busca).getByText("Digite ao menos duas letras do nome.")).toBeVisible();

    await usuario.type(within(busca).getByLabelText("Nome ou código"), "la");
    await within(busca).findByText("REFRI COLA 2L (completo)");

    await usuario.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}");
    const escolhido = within(busca).getByRole("button", { current: true });
    expect(escolhido).toHaveTextContent("QUEIJO MUSSARELA (completo)");
    expect(escolhido).toHaveTextContent("R$ 20,00/kg");

    await usuario.keyboard("{Enter}");
    expect(await janela("Peso de QUEIJO MUSSARELA")).toBeVisible();
  });

  it("o texto com letra já digitado vai junto para o F2", async () => {
    const { usuario } = montar();

    await usuario.type(await campoDeCodigo(), "refri");
    await usuario.keyboard("{F2}");

    const busca = await janela("Procurar produto");
    expect(within(busca).getByLabelText("Nome ou código")).toHaveValue("refri");
    await usuario.click(await within(busca).findByText("REFRI COLA 2L (completo)"));

    await totalDaVenda("R$ 9,90");
  });

  it("busca sem resultado diz o que fazer", async () => {
    const { usuario } = montar();

    await bipar(usuario, "xyzw");

    const busca = await janela("Procurar produto");
    expect(await within(busca).findByText(/Nenhum produto com esse nome/)).toBeVisible();

    await usuario.click(within(busca).getByRole("button", { name: "Voltar (Esc)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("falha na busca vira mensagem dentro da janela", async () => {
    const { servidor, usuario } = montar();
    servidor.responder("GET /api/pdv/produtos", () =>
      recusa(500, "FALHA", "Não foi possível buscar agora."),
    );

    await usuario.type(await campoDeCodigo(), "refri");
    await usuario.keyboard("{F2}");

    const busca = await janela("Procurar produto");
    expect(await within(busca).findByRole("alert")).toHaveTextContent(
      "Não foi possível buscar agora.",
    );
  });

  it("estoque aparece na busca quando o servidor o manda", async () => {
    const { usuario } = montar();

    await usuario.type(await campoDeCodigo(), "bolo");
    await usuario.keyboard("{F2}");

    const busca = await janela("Procurar produto");
    expect(await within(busca).findByText(/Estoque: 0 un/)).toBeVisible();
  });
});

describe("botões rápidos", () => {
  it("🔑 o botão lança o produto pelo código interno", async () => {
    const { servidor, usuario } = montar();

    await usuario.click(await screen.findByRole("button", { name: /REFRI COLA 2L/ }));

    await totalDaVenda("R$ 9,90");
    expect(servidor.chamadasA("POST /api/vendas/:id/itens")[0]?.corpo["codigo"]).toBe(
      "101",
    );
    expect(await campoDeCodigo()).toHaveFocus();
  });

  it("🔑 o pesável abre o peso direto, sem perguntar ao servidor", async () => {
    const { servidor, usuario } = montar();

    await usuario.click(await screen.findByRole("button", { name: /QUEIJO MUSSARELA/ }));

    expect(await janela("Peso de QUEIJO MUSSARELA")).toBeVisible();
    expect(servidor.chamadasA("POST /api/vendas/:id/itens")).toHaveLength(0);
  });

  it("as categorias filtram os botões, com foto quando há", async () => {
    const { servidor, usuario } = montar();

    const categorias = await screen.findByRole("group", { name: "Categorias" });
    expect(within(categorias).getByRole("button", { name: /Bebidas/ })).toHaveTextContent(
      "🥤",
    );

    await usuario.click(within(categorias).getByRole("button", { name: "Padaria" }));

    const pao = await screen.findByRole("button", { name: /PAO FRANCES/ });
    expect(pao.querySelector("img")).toHaveAttribute("src", `/api/imagens/${ID(801)}`);
    expect(
      servidor.chamadasA("GET /api/pdv/produtos")[0]?.consulta.get("categoriaId"),
    ).toBe(ID(902));
    expect(within(categorias).getByRole("button", { name: "Padaria" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await usuario.click(
      within(categorias).getByRole("button", { name: "Mais vendidos" }),
    );
    expect(await screen.findByRole("button", { name: /REFRI COLA 2L/ })).toBeVisible();
  });

  it("categoria vazia, ou que falhou, diz que não há produto", async () => {
    const { servidor, usuario } = montar();
    servidor.responder("GET /api/pdv/produtos", () => recusa(500, "FALHA", "x"));

    await usuario.click(await screen.findByRole("button", { name: /Bebidas/ }));

    expect(await screen.findByText("Nenhum produto nesta categoria.")).toBeVisible();
  });

  it("falha ao carregar os botões não atrapalha a venda", async () => {
    const { servidor, usuario } = montar();
    servidor.responder("GET /api/pdv/atalhos", () => recusa(500, "FALHA", "x"));

    expect(
      await screen.findByText(
        "Os produtos mais vendidos aparecem aqui depois das primeiras vendas.",
      ),
    ).toBeVisible();

    await bipar(usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");
  });

  it("sem o recurso ligado, os botões nem aparecem", async () => {
    montar({ configuracao: { recursos: [] } });

    await campoDeCodigo();
    expect(
      screen.queryByRole("region", { name: "Produtos rápidos" }),
    ).not.toBeInTheDocument();
  });
});

describe("corrigir a venda", () => {
  async function comDoisItens(): Promise<ReturnType<typeof montar>> {
    const balcao = montar();
    await bipar(balcao.usuario, "7891000315507");
    await totalDaVenda("R$ 9,90");
    await bipar(balcao.usuario, "103");
    await totalDaVenda("R$ 22,40");
    return balcao;
  }

  it("as setas trocam o item selecionado, e o clique também", async () => {
    const { usuario } = await comDoisItens();
    const selecionado = (): HTMLElement | null =>
      itens().querySelector<HTMLElement>("[aria-current='true']");

    expect(selecionado()).toHaveTextContent("PAO FRANCES");

    await usuario.keyboard("{ArrowDown}");
    expect(selecionado()).toHaveTextContent("REFRI COLA 2L");

    await usuario.keyboard("{ArrowDown}");
    expect(selecionado()).toHaveTextContent("REFRI COLA 2L");

    await usuario.keyboard("{ArrowUp}");
    expect(selecionado()).toHaveTextContent("PAO FRANCES");

    await usuario.click(within(itens()).getByText("REFRI COLA 2L"));
    expect(selecionado()).toHaveTextContent("REFRI COLA 2L");
    expect(await campoDeCodigo()).toHaveFocus();
  });

  it("🔑 F3 muda a quantidade do item selecionado", async () => {
    const { servidor, usuario } = await comDoisItens();

    await usuario.keyboard("{ArrowDown}{F3}");
    const quantidade = await janela("Quantidade de REFRI COLA 2L");
    await usuario.type(
      within(quantidade).getByLabelText("Nova quantidade (un)"),
      "3{Enter}",
    );

    await totalDaVenda("R$ 42,20");
    expect(
      servidor.chamadasA("PUT /api/vendas/:id/itens/:numero")[0]?.corpo,
    ).toMatchObject({
      quantidade: { milesimos: "3000", unidade: "UN" },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("quantidade vazia no F3 explica o formato", async () => {
    const { usuario } = await comDoisItens();

    await usuario.keyboard("{F3}");
    const quantidade = await janela(/Quantidade de/);
    await usuario.click(
      within(quantidade).getByRole("button", { name: "Alterar (Enter)" }),
    );

    expect(within(quantidade).getByRole("alert")).toHaveTextContent(
      "Digite a quantidade.",
    );
  });

  it("F3, F4 e F8 sem item pedem para bipar primeiro", async () => {
    const { usuario } = montar();
    await campoDeCodigo();

    for (const tecla of ["{F3}", "{F4}", "{F8}"]) {
      await usuario.keyboard(tecla);
      expect(await screen.findByText("Bipe um produto primeiro.")).toBeVisible();
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("🔑 F8 tira o item, depois de confirmar", async () => {
    const { servidor, usuario } = await comDoisItens();

    await usuario.keyboard("{F8}");
    const confirmar = await janela("Tirar item");
    expect(confirmar).toHaveTextContent("Tirar PAO FRANCES (R$ 12,50) da venda?");

    await usuario.keyboard("{Enter}");

    await totalDaVenda("R$ 9,90");
    expect(await screen.findByText("PAO FRANCES saiu da venda.")).toBeVisible();
    expect(servidor.chamadasA("POST /api/vendas/:id/itens/:numero/remover")).toHaveLength(
      1,
    );
  });

  it("Esc no F8 não tira nada", async () => {
    const { servidor, usuario } = await comDoisItens();

    await usuario.keyboard("{F8}");
    await janela("Tirar item");
    await usuario.keyboard("{Escape}");

    await totalDaVenda("R$ 22,40");
    expect(servidor.chamadasA("POST /api/vendas/:id/itens/:numero/remover")).toHaveLength(
      0,
    );
  });

  it("sem a alçada de tirar item, o supervisor libera no próprio caixa", async () => {
    const { servidor, usuario } = await comDoisItens();
    servidor.responder("POST /api/vendas/:id/itens/:numero/remover", () =>
      recusa(
        403,
        "AUTORIZACAO_NECESSARIA",
        "Para tirar item da venda, chame o supervisor.",
      ),
    );

    await usuario.keyboard("{F8}");
    await janela("Tirar item");
    await usuario.keyboard("{Enter}");

    const liberacao = await janela("Liberação do supervisor");
    expect(liberacao).toHaveTextContent("Para tirar item da venda, chame o supervisor.");
    await usuario.type(
      within(liberacao).getByLabelText("Matrícula do supervisor"),
      CREDENCIAL.matricula,
    );
    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      `${CREDENCIAL.pin}{Enter}`,
    );

    await totalDaVenda("R$ 9,90");
    expect(
      servidor.chamadasA("POST /api/vendas/:id/itens/:numero/remover").at(-1)?.corpo[
        "supervisor"
      ],
    ).toEqual(CREDENCIAL);
  });

  it("tirar o último item deixa a venda aberta, e o F8 seguinte pede para bipar", async () => {
    const { usuario } = montar({ abertas: [vendaAberta({ numero: 77 })] });

    await campoDeCodigo();
    await usuario.keyboard("{F8}");
    await janela("Tirar item");
    await usuario.keyboard("{Enter}");
    await totalDaVenda("R$ 0,00");

    await usuario.keyboard("{F8}");
    expect(await screen.findByText("Bipe um produto primeiro.")).toBeVisible();
    expect(screen.getByText(/Venda 77/)).toBeVisible();
  });
});

describe("desconto", () => {
  it("🔑 F4 dá desconto em percentual no item, mostrando o limite", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F4}");
    const desconto = await janela("Desconto");
    expect(desconto).toHaveTextContent(
      "Seu limite é 5%. Acima disso, o supervisor libera.",
    );
    expect(desconto).toHaveTextContent("Sobre R$ 12,50.");

    await usuario.type(
      within(desconto).getByLabelText("Percentual de desconto"),
      "4{Enter}",
    );

    await totalDaVenda("R$ 12,00");
    expect(servidor.chamadasA("POST /api/vendas/:id/desconto")[0]?.corpo).toMatchObject({
      numeroItem: 1,
      percentualBps: 400,
    });
  });

  it("desconto em reais na venda inteira", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F4}");
    const desconto = await janela("Desconto");
    await usuario.click(
      within(desconto).getByRole("button", { name: "Na venda inteira" }),
    );
    expect(desconto).toHaveTextContent("Seu limite é 3%.");
    // Ir e voltar entre alvo e modo não perde nada.
    await usuario.click(within(desconto).getByRole("button", { name: /No item/ }));
    expect(desconto).toHaveTextContent("Seu limite é 5%.");
    await usuario.click(
      within(desconto).getByRole("button", { name: "Na venda inteira" }),
    );
    await usuario.click(within(desconto).getByRole("button", { name: "Em R$" }));
    await usuario.click(within(desconto).getByRole("button", { name: "Em %" }));
    expect(within(desconto).getByLabelText("Percentual de desconto")).toBeVisible();
    await usuario.click(within(desconto).getByRole("button", { name: "Em R$" }));

    const valor = within(desconto).getByLabelText("Valor do desconto");
    await usuario.clear(valor);
    await usuario.type(valor, "30{Enter}");

    await totalDaVenda("R$ 12,20");
    const corpo = servidor.chamadasA("POST /api/vendas/:id/desconto")[0]?.corpo;
    expect(corpo).toMatchObject({ valor: "30" });
    expect(corpo?.["numeroItem"]).toBeUndefined();
  });

  it("🔑 desconto acima do limite pede o supervisor, e passa com a liberação", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F4}");
    const desconto = await janela("Desconto");
    await usuario.type(
      within(desconto).getByLabelText("Percentual de desconto"),
      "10{Enter}",
    );

    const liberacao = await janela("Liberação do supervisor");
    await usuario.type(
      within(liberacao).getByLabelText("Matrícula do supervisor"),
      CREDENCIAL.matricula,
    );
    await usuario.type(
      within(liberacao).getByLabelText("PIN do supervisor"),
      `${CREDENCIAL.pin}{Enter}`,
    );

    await totalDaVenda("R$ 11,25");
    expect(
      servidor.chamadasA("POST /api/vendas/:id/desconto").at(-1)?.corpo["supervisor"],
    ).toEqual(CREDENCIAL);
  });

  it("percentual em branco ou acima de 100% explica o formato", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F4}");
    const desconto = await janela("Desconto");
    await usuario.click(
      within(desconto).getByRole("button", { name: "Aplicar (Enter)" }),
    );
    expect(within(desconto).getByRole("alert")).toHaveTextContent("Digite o percentual.");

    await usuario.type(
      within(desconto).getByLabelText("Percentual de desconto"),
      "150{Enter}",
    );
    expect(within(desconto).getByRole("alert")).toHaveTextContent("Digite o percentual.");
  });

  it("recusa do servidor ao desconto aparece dentro da janela", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    servidor.responder("POST /api/vendas/:id/desconto", () =>
      recusa(403, "PERMISSAO_NEGADA", "Você não tem permissão para esta operação."),
    );

    await usuario.keyboard("{F4}");
    const desconto = await janela("Desconto");
    await usuario.type(
      within(desconto).getByLabelText("Percentual de desconto"),
      "2,5{Enter}",
    );

    expect(await within(desconto).findByRole("alert")).toHaveTextContent(
      "Você não tem permissão para esta operação.",
    );
  });

  it("para quem não tem limite, a tela diz que pode qualquer desconto", async () => {
    const { usuario } = montar({ limiteDescontoBps: null });

    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await usuario.keyboard("{F4}");

    expect(await janela("Desconto")).toHaveTextContent(
      "Você pode dar qualquer desconto.",
    );
  });
});

describe("cliente", () => {
  it("🔑 F6 põe o cliente na venda e mostra o fiado disponível", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F6}");
    const cliente = await janela("Cliente da venda");
    expect(cliente).toHaveTextContent("Digite ao menos duas letras do nome.");

    await usuario.type(within(cliente).getByLabelText("Nome do cliente"), "jo");
    const jose = await within(cliente).findByRole("button", { name: /José da Silva/ });
    expect(jose).toHaveTextContent("***.982.247-**");
    expect(jose).toHaveTextContent("Fiado disponível");
    expect(jose).toHaveTextContent("R$ 200,00");
    expect(
      within(cliente).getByRole("button", { name: /Josefa Souza/ }),
    ).toHaveTextContent("Sem fiado");

    await usuario.click(jose);

    expect(await screen.findByText(/fiado disponível R\$ 200,00/)).toBeVisible();
    expect(servidor.chamadasA("PUT /api/vendas/:id/cliente")[0]?.corpo).toEqual({
      clienteId: ID(201),
    });
  });

  it("o cliente pode vir antes do primeiro item", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();

    await usuario.keyboard("{F6}");
    const cliente = await janela("Cliente da venda");
    await usuario.type(within(cliente).getByLabelText("Nome do cliente"), "jos");
    await usuario.click(
      await within(cliente).findByRole("button", { name: /José da Silva/ }),
    );

    await waitFor(() => {
      expect(servidor.chamadasA("PUT /api/vendas/:id/cliente")).toHaveLength(1);
    });
    expect(servidor.chamadasA("POST /api/vendas")).toHaveLength(1);
  });

  it("tirar o cliente da venda", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F6}");
    let cliente = await janela("Cliente da venda");
    await usuario.type(within(cliente).getByLabelText("Nome do cliente"), "jo");
    await usuario.click(
      await within(cliente).findByRole("button", { name: /José da Silva/ }),
    );
    await screen.findByText(/fiado disponível/);

    await usuario.keyboard("{F6}");
    cliente = await janela("Cliente da venda");
    expect(cliente).toHaveTextContent("Na venda: José da Silva");
    await usuario.click(within(cliente).getByRole("button", { name: "Tirar cliente" }));

    await waitFor(() => {
      expect(screen.queryByText(/Cliente:/)).not.toBeInTheDocument();
    });
    expect(servidor.chamadasA("PUT /api/vendas/:id/cliente").at(-1)?.corpo).toEqual({
      clienteId: null,
    });
  });

  it("cliente sem cadastro e falha na busca dizem o que fazer", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();

    await usuario.keyboard("{F6}");
    const cliente = await janela("Cliente da venda");
    await usuario.type(within(cliente).getByLabelText("Nome do cliente"), "zz");
    expect(
      await within(cliente).findByText(/Nenhum cliente com esse nome/),
    ).toBeVisible();

    servidor.responder("GET /api/pdv/clientes", () =>
      recusa(500, "FALHA", "Busca indisponível."),
    );
    await usuario.type(within(cliente).getByLabelText("Nome do cliente"), "z");
    expect(await within(cliente).findByRole("alert")).toHaveTextContent(
      "Busca indisponível.",
    );

    await usuario.click(within(cliente).getByRole("button", { name: "Voltar (Esc)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("guardar e retomar", () => {
  it("🔑 F7 guarda a venda com um nome e libera o caixa", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    expect(screen.getByRole("button", { name: "Guardar venda (F7)" })).toBeVisible();
    await usuario.keyboard("{F7}");
    const guardadas = await janela("Vendas guardadas");
    await usuario.type(
      within(guardadas).getByLabelText("Nome para lembrar (opcional)"),
      "Mesa 3{Enter}",
    );

    expect(
      await screen.findByText('Venda "Mesa 3" guardada. Para retomar, aperte F7.'),
    ).toBeVisible();
    expect(screen.getByText(/Caixa livre/)).toBeVisible();
    expect(servidor.chamadasA("POST /api/vendas/:id/suspender")[0]?.corpo).toEqual({
      rotulo: "Mesa 3",
    });
    await totalDaVenda("R$ 0,00");
  });

  it("🔑 F7 sem venda lista as guardadas, e retomar traz os itens de volta", async () => {
    const guardada = vendaAberta({
      numero: 77,
      suspensao: { em: "2026-10-17T12:00:00.000Z", rotulo: "Mesa 3" },
    });
    const { servidor, usuario } = montar({ abertas: [guardada] });
    await campoDeCodigo();
    expect(screen.getByText(/Caixa livre/)).toBeVisible();

    await usuario.keyboard("{F7}");
    const guardadas = await janela("Vendas guardadas");
    const linha = await within(guardadas).findByRole("listitem");
    expect(linha).toHaveTextContent("Mesa 3");
    expect(linha).toHaveTextContent("1 item");

    await usuario.click(within(linha).getByRole("button", { name: "Retomar" }));

    expect(await screen.findByText("Venda 77 retomada.")).toBeVisible();
    await totalDaVenda("R$ 9,90");
    expect(servidor.chamadasA("POST /api/vendas/:id/retomar")).toHaveLength(1);
  });

  it("guardar sem nome também serve, e a lista diz quando não há guardadas", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F7}");
    const guardadas = await janela("Vendas guardadas");
    expect(
      await within(guardadas).findByText("Nenhuma venda guardada neste caixa."),
    ).toBeVisible();
    await usuario.click(
      within(guardadas).getByRole("button", { name: "Guardar a venda da tela (Enter)" }),
    );

    expect(
      await screen.findByText("Venda guardada. Para retomar, aperte F7."),
    ).toBeVisible();

    await usuario.keyboard("{F7}");
    const lista = await janela("Vendas guardadas");
    const linha = await within(lista).findByRole("listitem");
    expect(linha).toHaveTextContent("Venda 41");
    expect(linha).toHaveTextContent("1 item");
  });

  it("com venda na tela, retomar outra fica para depois", async () => {
    const guardada = vendaAberta({
      numero: 77,
      suspensao: { em: "2026-10-17T12:00:00.000Z" },
    });
    const { usuario } = montar({ abertas: [guardada] });
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F7}");
    const guardadas = await janela("Vendas guardadas");
    expect(
      await within(guardadas).findByText(/guarde ou conclua antes a venda da tela/),
    ).toBeVisible();
    expect(within(guardadas).getByRole("button", { name: "Retomar" })).toBeDisabled();
  });

  it("a venda vazia da tela é descartada ao retomar outra", async () => {
    const guardada = vendaAberta({
      numero: 77,
      suspensao: { em: "2026-10-17T12:00:00.000Z" },
    });
    const { servidor, usuario } = montar({ abertas: [guardada] });

    // O código errado abre uma venda que fica vazia.
    await bipar(usuario, "999");
    await screen.findByRole("alert");

    await usuario.keyboard("{F7}");
    const guardadas = await janela("Vendas guardadas");
    await usuario.click(
      await within(guardadas).findByRole("button", { name: "Retomar" }),
    );

    await screen.findByText("Venda 77 retomada.");
    expect(servidor.chamadasA("POST /api/vendas/:id/cancelar")[0]?.corpo).toMatchObject({
      motivo: "Venda vazia descartada",
    });
  });

  it("falha ao listar as guardadas aparece na janela", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();
    servidor.responder("GET /api/vendas/abertas", () =>
      recusa(500, "FALHA", "Lista indisponível."),
    );

    await usuario.keyboard("{F7}");
    const guardadas = await janela("Vendas guardadas");
    expect(await within(guardadas).findByRole("alert")).toHaveTextContent(
      "Lista indisponível.",
    );
    await usuario.click(within(guardadas).getByRole("button", { name: "Voltar (Esc)" }));
  });
});

describe("cancelar", () => {
  it("🔑 F9 cancela a venda com um motivo pronto", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F9}");
    const cancelar = await janela("Cancelar a venda 41");
    expect(cancelar).toHaveTextContent("A venda de R$ 12,50 será descartada.");
    await usuario.click(
      within(cancelar).getByRole("button", { name: "Cliente desistiu da compra" }),
    );

    expect(await screen.findByText("Venda 41 cancelada.")).toBeVisible();
    expect(servidor.chamadasA("POST /api/vendas/:id/cancelar")[0]?.corpo).toMatchObject({
      motivo: "Cliente desistiu da compra",
    });
    expect(screen.getByText(/Caixa livre/)).toBeVisible();
  });

  it("o motivo escrito à mão precisa dizer alguma coisa", async () => {
    const { servidor, usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F9}");
    const cancelar = await janela(/Cancelar a venda/);
    const motivo = within(cancelar).getByLabelText("Outro motivo");

    await usuario.type(motivo, "ab{Enter}");
    expect(within(cancelar).getByRole("alert")).toHaveTextContent(
      "Escreva o motivo do cancelamento.",
    );

    await usuario.type(motivo, "c troca de produto{Enter}");
    await screen.findByText("Venda 41 cancelada.");
    expect(servidor.chamadasA("POST /api/vendas/:id/cancelar")[0]?.corpo["motivo"]).toBe(
      "abc troca de produto",
    );
  });

  it("venda com pagamento parcial avisa o que devolver ao cliente", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{Enter}");
    await usuario.keyboard("1");
    const valor = await screen.findByLabelText("Valor recebido");
    await usuario.clear(valor);
    await usuario.type(valor, "500{Enter}");
    await screen.findByRole("list", { name: "Pagamentos registrados" });

    await usuario.keyboard("{F9}");
    const cancelar = await janela(/Cancelar a venda/);
    await usuario.click(
      within(cancelar).getByRole("button", { name: "Item registrado errado" }),
    );

    expect(
      await screen.findByText(
        "Venda 41 cancelada. Devolva ao cliente o que ele já pagou: Dinheiro R$ 5,00.",
      ),
    ).toBeVisible();
  });

  it("venda vazia cancela sem perguntar nada", async () => {
    const { servidor, usuario } = montar();

    await bipar(usuario, "999");
    await screen.findByRole("alert");
    await usuario.keyboard("{F9}");

    await waitFor(() => {
      expect(servidor.chamadasA("POST /api/vendas/:id/cancelar")).toHaveLength(1);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText(/Caixa livre/)).toBeVisible();
  });

  it("F9 sem venda avisa, e Esc fecha a janela de cancelar sem cancelar", async () => {
    const { servidor, usuario } = montar();
    await campoDeCodigo();

    await usuario.keyboard("{F9}");
    expect(
      await screen.findByText("Não há venda em andamento para cancelar."),
    ).toBeVisible();

    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");
    await usuario.click(screen.getByRole("button", { name: "Cancelar venda (F9)" }));
    await janela(/Cancelar a venda/);
    await usuario.keyboard("{Escape}");

    await totalDaVenda("R$ 12,50");
    expect(servidor.chamadasA("POST /api/vendas/:id/cancelar")).toHaveLength(0);
  });
});

describe("a venda que volta", () => {
  it("🔑 a venda aberta volta para a tela depois do F5", async () => {
    montar({ abertas: [vendaAberta({ numero: 77 })] });

    expect(
      await screen.findByText("Venda 77 recuperada: continue de onde parou."),
    ).toBeVisible();
    await totalDaVenda("R$ 9,90");
    expect(screen.getByText(/Venda 77 · Maria da Silva/)).toBeVisible();
  });

  it("as guardadas não voltam sozinhas para a tela", async () => {
    montar({
      abertas: [
        vendaAberta({ numero: 77, suspensao: { em: "2026-10-17T12:00:00.000Z" } }),
      ],
    });

    await campoDeCodigo();
    expect(screen.getByText(/Caixa livre/)).toBeVisible();
    expect(screen.queryByText(/recuperada/)).not.toBeInTheDocument();
  });

  it("venda recuperada com cliente mostra que há cliente, mesmo sem o nome", async () => {
    montar({ abertas: [vendaAberta({ numero: 77, clienteId: ID(201) })] });

    expect(await screen.findByText("identificado na venda")).toBeVisible();
  });
});

describe("ajuda e orientação", () => {
  it("🔑 a orientação aparece na primeira vez, e só na primeira", async () => {
    globalThis.localStorage.removeItem("erp.pdv.orientacao-vista");
    const { usuario } = montar();

    const boasVindas = await janela("Bem-vindo ao caixa");
    expect(within(boasVindas).getByRole("list", { name: "Como vender" })).toBeVisible();
    await usuario.click(within(boasVindas).getByRole("button", { name: "Entendi" }));

    expect(globalThis.localStorage.getItem("erp.pdv.orientacao-vista")).toBe("sim");
    expect(await campoDeCodigo()).toHaveFocus();
  });

  it("F1 mostra todas as teclas", async () => {
    const { usuario } = montar();
    await campoDeCodigo();

    await usuario.keyboard("{F1}");
    const ajuda = await janela("Ajuda do caixa");
    expect(within(ajuda).getByRole("rowheader", { name: "F10" })).toBeVisible();
    expect(
      within(ajuda).queryByRole("list", { name: "Como vender" }),
    ).not.toBeInTheDocument();

    await usuario.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("sem armazenamento no navegador, a orientação não trava a tela", async () => {
    const lerDeVerdade = Storage.prototype.getItem.bind(globalThis.localStorage);
    const gravarDeVerdade = Storage.prototype.setItem.bind(globalThis.localStorage);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((chave: string) => {
      if (chave === "erp.pdv.orientacao-vista") throw new Error("bloqueado");
      return lerDeVerdade(chave);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      (chave: string, valor: string) => {
        if (chave === "erp.pdv.orientacao-vista") throw new Error("bloqueado");
        gravarDeVerdade(chave, valor);
      },
    );
    const { usuario } = montar();

    await campoDeCodigo();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await usuario.keyboard("{F1}");
    await usuario.click(
      within(await janela("Ajuda do caixa")).getByRole("button", { name: "Entendi" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("foco", () => {
  it("🔑 a tecla digitada com o foco num botão volta para o campo de código", async () => {
    const { usuario } = montar();
    const campo = await campoDeCodigo();

    screen.getByRole("button", { name: "Ajuda (F1)" }).focus();
    await usuario.keyboard("7891000315507{Enter}");

    await totalDaVenda("R$ 9,90");
    expect(campo).toHaveFocus();
  });

  it("os botões da barra fazem o mesmo que as teclas", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.click(screen.getByRole("button", { name: "Procurar (F2)" }));
    await janela("Procurar produto");
    await usuario.keyboard("{Escape}");

    await usuario.click(screen.getByRole("button", { name: "Quantidade (F3)" }));
    await janela(/Quantidade de/);
    await usuario.keyboard("{Escape}");

    await usuario.click(screen.getByRole("button", { name: "Desconto (F4)" }));
    await janela("Desconto");
    await usuario.keyboard("{Escape}");

    await usuario.click(screen.getByRole("button", { name: "Cliente (F6)" }));
    await janela("Cliente da venda");
    await usuario.keyboard("{Escape}");

    await usuario.click(screen.getByRole("button", { name: "Guardar venda (F7)" }));
    await janela("Vendas guardadas");
    await usuario.keyboard("{Escape}");

    await usuario.click(screen.getByRole("button", { name: "Tirar item (F8)" }));
    await janela("Tirar item");
    await usuario.keyboard("{Escape}");

    await usuario.click(screen.getByRole("button", { name: "Ajuda (F1)" }));
    await janela("Ajuda do caixa");
    await usuario.keyboard("{Escape}");

    await usuario.click(screen.getByRole("button", { name: "Receber (F10)" }));
    expect(await screen.findByRole("region", { name: "Pagamento" })).toBeVisible();
  });

  it("Tab fica preso dentro da janela aberta", async () => {
    const { usuario } = montar();
    await bipar(usuario, "103");
    await totalDaVenda("R$ 12,50");

    await usuario.keyboard("{F8}");
    const confirmar = await janela("Tirar item");
    const [primeiro, ultimo] = within(confirmar).getAllByRole("button");

    expect(primeiro).toHaveFocus();
    await usuario.tab();
    expect(ultimo).toHaveFocus();
    await usuario.tab();
    expect(primeiro).toHaveFocus();
    await usuario.tab({ shift: true });
    expect(ultimo).toHaveFocus();
  });

  it("uma operação de cada vez: o pedido no meio de outra só orienta", async () => {
    const { servidor, usuario } = montar();
    const segurado = adiado();
    servidor.responder("POST /api/vendas/:id/itens", () => segurado.resposta);

    await bipar(usuario, "103");
    await waitFor(() => {
      expect(servidor.chamadasA("POST /api/vendas/:id/itens")).toHaveLength(1);
    });

    // O item está no caminho e a venda ainda está vazia: o F9 de agora
    // descartaria a venda que o item vai encher.
    await usuario.keyboard("{F9}");
    expect(
      await screen.findByText("Um instante: a operação anterior ainda está terminando."),
    ).toBeVisible();

    segurado.soltar(
      servidor.padrao("POST", `/api/vendas/${servidor.vendaUnica().id}/itens`, {
        codigo: "103",
      }),
    );
    await totalDaVenda("R$ 12,50");
    expect(servidor.chamadasA("POST /api/vendas/:id/cancelar")).toHaveLength(0);
  });

  it("Enter para receber, com item ainda a caminho, espera o item", async () => {
    const { servidor, usuario } = montar();
    const segurado = adiado();
    servidor.responder("POST /api/vendas/:id/itens", () => segurado.resposta);

    await usuario.type(await campoDeCodigo(), "103{Enter}{Enter}");
    expect(
      await screen.findByText("Um instante: ainda lançando os itens."),
    ).toBeVisible();

    segurado.soltar(
      servidor.padrao("POST", `/api/vendas/${servidor.vendaUnica().id}/itens`, {
        codigo: "103",
      }),
    );
    await totalDaVenda("R$ 12,50");
    expect(screen.queryByRole("region", { name: "Pagamento" })).not.toBeInTheDocument();
  });
});
