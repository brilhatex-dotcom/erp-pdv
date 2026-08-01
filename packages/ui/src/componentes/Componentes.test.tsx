import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  centavosParaReais,
  formatarDinheiro,
  formatarQuantidade,
  reaisParaCentavos,
} from "../formato.js";
import { juntarClasses } from "../juntarClasses.js";
import { Botao } from "./Botao.js";
import { CampoSelecao } from "./CampoSelecao.js";
import { CampoTexto } from "./CampoTexto.js";
import { Carregando, ErroDeTela, Vazio } from "./Estados.js";

describe("Botão", () => {
  it("🔑 nasce type=button — o padrão do HTML enviaria o formulário", () => {
    // Um "adicionar item" dentro de um formulário de venda enviaria a venda
    // inteira sem que ninguém tivesse pedido.
    render(<Botao>Adicionar item</Botao>);

    expect(screen.getByRole("button", { name: "Adicionar item" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("aceita submit quando declarado", () => {
    render(<Botao type="submit">Entrar</Botao>);

    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("🔑 ocupado desabilita e anuncia — senão vira venda duplicada", () => {
    render(<Botao ocupado>Finalizar</Botao>);

    const botao = screen.getByRole("button");
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("aria-busy", "true");
    expect(botao).toHaveTextContent("Aguarde");
  });

  it("permite personalizar o texto de espera", () => {
    render(
      <Botao ocupado rotuloOcupado="Emitindo nota…">
        Finalizar
      </Botao>,
    );

    expect(screen.getByRole("button")).toHaveTextContent("Emitindo nota…");
  });

  it("não dispara clique enquanto ocupado", async () => {
    const aoClicar = vi.fn();
    render(
      <Botao ocupado onClick={aoClicar}>
        Finalizar
      </Botao>,
    );

    await userEvent.click(screen.getByRole("button"));

    expect(aoClicar).not.toHaveBeenCalled();
  });

  it("🔑 é alcançável e acionável só com o teclado", async () => {
    // O PDV é operado sem mouse. Um botão que só responde a clique não existe
    // para o operador.
    const aoClicar = vi.fn();
    render(<Botao onClick={aoClicar}>Confirmar</Botao>);

    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");

    expect(aoClicar).toHaveBeenCalledTimes(2);
  });

  it.each([["primario"], ["secundario"], ["perigo"], ["discreto"]] as const)(
    "renderiza o tom %s mantendo o texto legível",
    (tom) => {
      // Cor nunca é a única pista: o texto continua dizendo o que o botão faz.
      render(<Botao tom={tom}>Excluir produto</Botao>);

      expect(screen.getByRole("button", { name: "Excluir produto" })).toBeVisible();
    },
  );

  it("aceita o tamanho grande do balcão", () => {
    render(<Botao tamanho="grande">F2 Pagar</Botao>);

    expect(screen.getByRole("button")).toHaveClass("min-h-14");
  });
});

describe("Campo de texto", () => {
  it("🔑 o rótulo é sempre visível, nunca só placeholder", async () => {
    // Placeholder some quando se digita: quem foi interrompido no meio não
    // descobre mais o que o campo pedia.
    render(<CampoTexto rotulo="Matrícula" placeholder="000" />);

    const campo = screen.getByLabelText("Matrícula");
    await userEvent.type(campo, "42");

    expect(screen.getByText("Matrícula")).toBeVisible();
    expect(campo).toHaveValue("42");
  });

  it("🔑 liga o erro ao campo, para quem não vê a borda vermelha", () => {
    render(<CampoTexto rotulo="PIN" erro="O PIN deve ter 6 números." />);

    const campo = screen.getByLabelText("PIN");
    const erro = screen.getByRole("alert");

    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription("O PIN deve ter 6 números.");
    expect(erro).toHaveTextContent("O PIN deve ter 6 números.");
  });

  it("mostra ajuda quando não há erro, e a esconde quando há", () => {
    const { rerender } = render(
      <CampoTexto rotulo="Código" ajuda="Bipe ou digite o código." />,
    );

    expect(screen.getByText("Bipe ou digite o código.")).toBeVisible();

    rerender(
      <CampoTexto
        rotulo="Código"
        ajuda="Bipe ou digite o código."
        erro="Não encontrado."
      />,
    );

    expect(screen.queryByText("Bipe ou digite o código.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Não encontrado.");
  });

  it("anuncia campo obrigatório sem depender do asterisco", () => {
    render(<CampoTexto rotulo="Matrícula" required />);

    expect(screen.getByText("(obrigatório)")).toBeInTheDocument();
    expect(screen.getByLabelText(/Matrícula/)).toBeRequired();
  });

  it("🔑 campo numérico abre o teclado numérico e desliga autocorreção", () => {
    // Vale para matrícula, PIN, código de barras e quantidade — quase tudo
    // neste produto. Autocorreção num código de barras é digitação perdida.
    render(<CampoTexto rotulo="Código de barras" numerico />);

    const campo = screen.getByLabelText("Código de barras");
    expect(campo).toHaveAttribute("inputMode", "numeric");
    expect(campo).toHaveAttribute("autoComplete", "off");
    expect(campo).toHaveAttribute("spellcheck", "false");
  });

  it("cada campo recebe identificador próprio", () => {
    render(
      <>
        <CampoTexto rotulo="Matrícula" />
        <CampoTexto rotulo="PIN" />
      </>,
    );

    expect(screen.getByLabelText("Matrícula").id).not.toBe(
      screen.getByLabelText("PIN").id,
    );
  });
});

describe("Campo de seleção", () => {
  const CORES = [
    { valor: "UN", rotulo: "Unidade" },
    { valor: "KG", rotulo: "Quilo" },
  ];

  it("liga o rótulo ao campo — quem usa leitor de tela ouve o que ele pede", () => {
    render(
      <CampoSelecao
        rotulo="Unidade"
        valor="UN"
        opcoes={CORES}
        aoMudar={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Unidade")).toHaveValue("UN");
  });

  it("avisa a mudança com o valor escolhido", async () => {
    const aoMudar = vi.fn();
    render(<CampoSelecao rotulo="Unidade" valor="UN" opcoes={CORES} aoMudar={aoMudar} />);

    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "KG");

    expect(aoMudar).toHaveBeenCalledWith("KG");
  });

  it("mostra a ajuda e a liga ao campo", () => {
    render(
      <CampoSelecao
        rotulo="Unidade"
        ajuda="Não muda depois de cadastrado."
        valor="UN"
        opcoes={CORES}
        aoMudar={() => undefined}
      />,
    );

    const campo = screen.getByLabelText("Unidade");
    const ajuda = screen.getByText("Não muda depois de cadastrado.");

    expect(campo).toHaveAttribute("aria-describedby", ajuda.id);
  });

  it("marca o obrigatório para quem vê e para quem ouve", () => {
    render(
      <CampoSelecao
        rotulo="Unidade"
        required
        valor="UN"
        opcoes={CORES}
        aoMudar={() => undefined}
      />,
    );

    expect(screen.getByLabelText(/Unidade/)).toBeRequired();
    expect(screen.getByText("(obrigatório)")).toBeInTheDocument();
  });
});

describe("Estados de tela", () => {
  it("🔑 carregando é anunciado sem interromper o leitor de tela", () => {
    render(<Carregando oQue="produtos" />);

    const estado = screen.getByRole("status");
    expect(estado).toHaveAttribute("aria-live", "polite");
    expect(estado).toHaveTextContent("Carregando produtos…");
  });

  it("carregando sem assunto continua dizendo algo", () => {
    render(<Carregando />);

    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
  });

  it("🔑 vazio oferece o próximo passo, não só a constatação", async () => {
    // "Nenhum produto" deixa o usuário parado. Estado vazio é a melhor chance
    // de ensinar o sistema sem treinamento.
    const cadastrar = vi.fn();
    render(
      <Vazio
        titulo="Nenhum produto cadastrado"
        descricao="Cadastre o primeiro para começar a vender."
        acao={{ rotulo: "Cadastrar produto", aoClicar: cadastrar }}
      />,
    );

    expect(screen.getByText("Cadastre o primeiro para começar a vender.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar produto" }));
    expect(cadastrar).toHaveBeenCalledOnce();
  });

  it("vazio funciona sem ação nem descrição", () => {
    render(<Vazio titulo="Nada por aqui" />);

    expect(screen.getByText("Nada por aqui")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("🔑 erro mostra a mensagem do domínio, nunca o detalhe técnico", () => {
    render(<ErroDeTela mensagem="Produto não encontrado. Confira o código." />);

    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Produto não encontrado. Confira o código.");
    expect(alerta.textContent).not.toMatch(/404|Error|prisma/i);
  });

  it("🔑 só oferece repetir quando repetir pode funcionar", async () => {
    // Um botão que repete um erro de permissão ensina o operador a ignorá-lo.
    const semSaida = render(<ErroDeTela mensagem="Você não tem permissão." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    semSaida.unmount();

    const tentar = vi.fn();
    render(<ErroDeTela mensagem="Não foi possível conectar." aoTentarDeNovo={tentar} />);

    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(tentar).toHaveBeenCalledOnce();
  });
});

describe("Formatação para a tela", () => {
  it.each([
    ["990", "R$ 9,90"],
    ["0", "R$ 0,00"],
    ["5", "R$ 0,05"],
    ["100000", "R$ 1.000,00"],
    ["123456789", "R$ 1.234.567,89"],
    ["-250", "-R$ 2,50"],
  ])("formata %p como %p", (centavos, esperado) => {
    expect(formatarDinheiro(centavos)).toBe(esperado);
  });

  it("🔑 não passa por number — o teto de 2^53 centavos é alcançável", () => {
    // A soma anual de uma rede chega lá, e perder o centavo aqui é perdê-lo no
    // relatório que o contador confere.
    expect(formatarDinheiro(9_007_199_254_740_993n)).toBe("R$ 90.071.992.547.409,93");
  });

  it("aceita bigint direto", () => {
    expect(formatarDinheiro(1990n)).toBe("R$ 19,90");
  });

  it.each([
    ["1250", "1,25"],
    ["1000", "1"],
    ["500", "0,5"],
    ["1", "0,001"],
    ["0", "0"],
    ["-2000", "-2"],
  ])("formata quantidade %p como %p", (milesimos, esperado) => {
    expect(formatarQuantidade(milesimos)).toBe(esperado);
  });
});

describe("Digitação de dinheiro", () => {
  it.each([
    ["0", "0,00"],
    ["990", "9,90"],
    ["1990", "19,90"],
    ["200000", "2000,00"],
    ["5", "0,05"],
    ["-990", "-9,90"],
  ])("centavos %s viram %s no campo", (centavos, esperado) => {
    expect(centavosParaReais(centavos)).toBe(esperado);
  });

  it("aceita bigint direto, sem passar por texto", () => {
    expect(centavosParaReais(1990n)).toBe("19,90");
  });

  it.each([
    ["19,90", "1990"],
    ["19.90", "1990"],
    ["  9,9  ", "990"],
    ["9,", "900"],
    ["0,05", "5"],
  ])("o campo %s vira %s centavos", (texto, esperado) => {
    expect(reaisParaCentavos(texto)).toBe(esperado);
  });

  it("🔑 número sem separador é reais, não centavos", () => {
    // A interpretação inversa daria um valor cem vezes menor, e o erro só
    // apareceria no balcão — na etiqueta que não bate com a gôndola.
    expect(reaisParaCentavos("2000")).toBe("200000");
  });

  it.each([[""], ["abc"], ["19,900"], ["-5"], ["1,2,3"], ["R$ 9,90"]])(
    "recusa %p em vez de gravar um valor errado",
    (texto) => {
      expect(reaisParaCentavos(texto)).toBeUndefined();
    },
  );
});

describe("Junção de classes", () => {
  it("descarta o que é falso", () => {
    expect(juntarClasses("a", false, undefined, null, "", "b")).toBe("a b");
  });
});
