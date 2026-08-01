import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Empresa } from "../telas/Empresa.js";

/**
 * Cadastro da empresa, do ponto de vista do lojista.
 *
 * Dois riscos moram nesta tela. O primeiro é a instalação recém-feita abrir com
 * "não encontrado" em vez de um formulário. O segundo é o CNPJ parecer
 * editável: o servidor o ignora na alteração, então um campo aberto produziria
 * "salvo com sucesso" com o CNPJ antigo no banco.
 */

const CADASTRADA = {
  razaoSocial: "Mercadinho Bom Preço Ltda",
  nomeFantasia: "Bom Preço",
  exibicao: "Bom Preço",
  cnpj: "11222333000181",
  cnpjFormatado: "11.222.333/0001-81",
  inscricaoEstadual: "110042490114",
  regimeTributario: "SIMPLES_NACIONAL",
  endereco: {
    logradouro: "Rua das Flores",
    numero: "120",
    bairro: "Centro",
    municipio: "Campinas",
    uf: "SP",
    cep: "13010000",
  },
  aptaAEmitir: true,
};

function json(status: number, corpo: unknown): Response {
  if (status === 204) return new Response(null, { status });

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
  empresa: unknown,
  opcoes: {
    readonly permissoes?: readonly string[];
    /** Faz o `GET` falhar, para exercitar o estado de erro da tela. */
    readonly leituraFalha?: boolean;
  } = {},
): { readonly chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  let jaFalhou = false;

  const buscar = vi.fn((url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";

    if (url.includes("/api/empresa")) {
      if (opcoes.leituraFalha === true && metodo === "GET" && !jaFalhou) {
        jaFalhou = true;
        return Promise.resolve(
          json(500, { erro: { codigo: "FALHA", mensagem: "Banco fora do ar." } }),
        );
      }

      const corpo =
        typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;

      chamadas.push({ url, metodo, corpo });

      if (metodo === "PUT") {
        return Promise.resolve(json(200, { ...CADASTRADA, ...(corpo as object) }));
      }

      return Promise.resolve(
        empresa === undefined ? json(204, undefined) : json(200, empresa),
      );
    }

    return Promise.resolve(
      json(200, {
        id: "u1",
        nome: "Ana",
        permissoes: opcoes.permissoes ?? ["config:empresa"],
      }),
    );
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

  function Envolvido(): ReactNode {
    return (
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        <Empresa />
      </ProvedorSessao>
    );
  }

  render(<Envolvido />);

  return { chamadas };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

/**
 * Define o valor de um campo de uma vez, sem simular teclado.
 *
 * O `onChange` da tela roda igual — inclusive a máscara que descarta a
 * pontuação. O que não roda é um re-render por caractere, que é o que torna o
 * preenchimento do formulário inteiro lento demais para o limite do CI.
 */
function preencher(rotulo: RegExp, valor: string): void {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

describe("primeira abertura", () => {
  it("🔑 instalação sem cadastro abre o formulário em branco", async () => {
    // 204, não 404: a loja recém-instalada não perdeu um cadastro. Dizer "não
    // encontrado" no primeiro uso do sistema é o chamado de suporte número um.
    montar(undefined);

    expect(await screen.findByLabelText(/Razão social/)).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("o CNPJ é editável enquanto não há cadastro", async () => {
    montar(undefined);

    expect(await screen.findByLabelText(/CNPJ/)).toBeEnabled();
  });

  it("🔑 preenche o cadastro inteiro e manda tudo de uma vez", async () => {
    // Este é o caminho da implantação: o técnico abre a tela uma vez, preenche
    // tudo e vai embora. Um campo que não chega ao servidor só aparece meses
    // depois, no cabeçalho errado de um relatório.
    //
    // `fireEvent.change` em vez de `userEvent.type`: são dezesseis campos, e
    // digitar tecla a tecla re-renderiza o formulário inteiro a cada
    // caractere — o teste levava mais de 5 s no CI, estourava o limite e
    // contaminava os dois casos seguintes. O que se verifica aqui é o
    // **mapeamento de estado para corpo**, não a digitação; as máscaras têm
    // testes próprios, com poucos campos e teclado de verdade.
    const { chamadas } = montar(undefined);

    await screen.findByLabelText(/Razão social/);

    preencher(/Razão social/, "Padaria Pão Quente Ltda");
    preencher(/Nome fantasia/, "Pão Quente");
    preencher(/CNPJ/, "11.222.333/0001-81");
    preencher(/Inscrição estadual/, "110042490114");
    preencher(/Inscrição municipal/, "998877");

    preencher(/Logradouro/, "Rua das Acácias");
    preencher(/Número/, "45");
    preencher(/Complemento/, "Loja 2");
    preencher(/Bairro/, "Vila Nova");
    preencher(/Município/, "Piracicaba");
    preencher(/CEP/, "13400-000");
    preencher(/Código IBGE/, "3538709");

    preencher(/Telefone/, "(19) 3888-7777");
    preencher(/E-mail/, "contato@paoquente.com.br");

    await userEvent.selectOptions(screen.getByLabelText(/Regime tributário/), "MEI");
    await userEvent.selectOptions(screen.getByLabelText("UF *(obrigatório)"), "MG");

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const put = chamadas.find((chamada) => chamada.metodo === "PUT");
    expect(put?.corpo).toEqual({
      razaoSocial: "Padaria Pão Quente Ltda",
      nomeFantasia: "Pão Quente",
      // Máscara digitada, dígitos enviados: o servidor não deve receber pontuação.
      // A pontuação foi digitada e não chega ao servidor: a máscara é da tela.
      cnpj: "11222333000181",
      regimeTributario: "MEI",
      inscricaoEstadual: "110042490114",
      inscricaoMunicipal: "998877",
      telefone: "1938887777",
      email: "contato@paoquente.com.br",
      endereco: {
        logradouro: "Rua das Acácias",
        numero: "45",
        complemento: "Loja 2",
        bairro: "Vila Nova",
        municipio: "Piracicaba",
        codigoMunicipioIbge: "3538709",
        uf: "MG",
        cep: "13400000",
      },
    });
  });
});

describe("falha ao carregar", () => {
  it("oferece tentar de novo em vez de deixar a tela vazia", async () => {
    montar(CADASTRADA, { leituraFalha: true });

    const tentar = await screen.findByRole("button", { name: /tentar de novo/i });
    await userEvent.click(tentar);

    expect(await screen.findByLabelText(/Razão social/)).toHaveValue(
      "Mercadinho Bom Preço Ltda",
    );
  });
});

describe("cadastro existente", () => {
  it("preenche o formulário com o que está gravado", async () => {
    montar(CADASTRADA);

    expect(await screen.findByLabelText(/Razão social/)).toHaveValue(
      "Mercadinho Bom Preço Ltda",
    );
    expect(screen.getByLabelText(/Município/)).toHaveValue("Campinas");
    expect(screen.getByLabelText("UF *(obrigatório)")).toHaveValue("SP");
  });

  it("🔑 o CNPJ trava depois de salvo, e a tela diz por quê", async () => {
    // Campo aberto faria o lojista digitar, salvar, ver "salvo" e continuar com
    // o CNPJ antigo — o servidor o ignora na alteração.
    montar(CADASTRADA);

    expect(await screen.findByLabelText(/CNPJ/)).toBeDisabled();
    expect(screen.getByText(/outra instalação/i)).toBeInTheDocument();
  });

  it("🔑 avisa que falta inscrição estadual sem impedir nada", async () => {
    // O módulo fiscal é opcional (ADR-0016): a loja vende sem ele.
    montar({ ...CADASTRADA, inscricaoEstadual: undefined, aptaAEmitir: false });

    expect(await screen.findByText(/Falta a inscrição estadual/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("empresa apta não mostra aviso nenhum", async () => {
    montar(CADASTRADA);

    await screen.findByLabelText(/Razão social/);
    expect(screen.queryByText(/Falta a inscrição estadual/)).not.toBeInTheDocument();
  });
});

describe("salvamento", () => {
  it("🔑 não manda o CNPJ na alteração — o servidor o ignoraria de todo jeito", async () => {
    const { chamadas } = montar(CADASTRADA);

    await screen.findByLabelText(/Razão social/);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const put = chamadas.find((chamada) => chamada.metodo === "PUT");
    expect(put).toBeDefined();
    expect(put?.corpo).not.toHaveProperty("cnpj");
  });

  it("campo em branco não vira string vazia no corpo", async () => {
    const { chamadas } = montar(CADASTRADA);

    await userEvent.clear(await screen.findByLabelText(/Nome fantasia/));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const put = chamadas.find((chamada) => chamada.metodo === "PUT");
    expect(put?.corpo).not.toHaveProperty("nomeFantasia");
  });

  it("🔑 CNPJ incompleto é barrado antes da ida à rede", async () => {
    // Poupa o operador de esperar o servidor para saber que faltou um dígito.
    const { chamadas } = montar(undefined);

    await screen.findByLabelText(/Razão social/);
    preencher(/Razão social/, "Loja Teste");
    // Só o CNPJ vai por teclado: é o campo que este caso investiga, e é onde a
    // máscara de dígitos precisa rodar tecla a tecla.
    await userEvent.type(screen.getByLabelText(/CNPJ/), "112223330001");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("14 dígitos");
    expect(chamadas.some((chamada) => chamada.metodo === "PUT")).toBe(false);
  });

  it("CEP incompleto é barrado antes da ida à rede", async () => {
    const { chamadas } = montar(CADASTRADA);

    await userEvent.clear(await screen.findByLabelText(/CEP/));
    await userEvent.type(screen.getByLabelText(/CEP/), "130");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("8 dígitos");
    expect(chamadas.some((chamada) => chamada.metodo === "PUT")).toBe(false);
  });

  it("confirma o salvamento por escrito", async () => {
    montar(CADASTRADA);

    await screen.findByLabelText(/Razão social/);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Dados da empresa salvos",
    );
  });
});

describe("sem permissão para alterar", () => {
  it("🔑 quem só consulta não vê o botão de salvar", async () => {
    // Mostrar o botão e recusar no clique é pior que escondê-lo: o usuário
    // tenta, falha e abre chamado perguntando o que está quebrado.
    montar(CADASTRADA, { permissoes: [] });

    await screen.findByLabelText(/Razão social/);

    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Razão social/)).toBeDisabled();
  });

  it("explica por que os campos estão travados", async () => {
    montar(CADASTRADA, { permissoes: [] });

    expect(await screen.findByText(/só o gerente pode alterá-los/)).toBeInTheDocument();
  });
});
