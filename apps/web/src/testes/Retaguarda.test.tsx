import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App.js";
import { hojeNaLoja } from "../telas/Auditoria.js";
import { formatarTamanho, haQuantoTempo } from "../telas/CopiasDeSeguranca.js";

/**
 * As telas que dizem como a loja vende e quem mexeu em quê — e as opções do
 * produto que o caixa usa (foto, botão rápido, estoque mínimo, fornecedor).
 */

type Manipulador = (
  corpo: unknown,
  consulta: URLSearchParams,
) => Response | Promise<Response>;

interface Chamada {
  readonly metodo: string;
  readonly caminho: string;
  readonly consulta: URLSearchParams;
  readonly corpo: unknown;
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recusa(status: number, mensagem: string, detalhes?: unknown): Response {
  return json(status, { erro: { codigo: "X", mensagem, detalhes } });
}

/** Cada rota pode ter uma fila de respostas: a última se repete. */
function montar(rotas: Record<string, Manipulador | readonly Manipulador[]>): {
  readonly chamadas: Chamada[];
} {
  const chamadas: Chamada[] = [];
  const filas = new Map(
    Object.entries(rotas).map(([rota, resposta]) => [
      rota,
      Array.isArray(resposta)
        ? [...(resposta as readonly Manipulador[])]
        : [resposta as Manipulador],
    ]),
  );

  const buscar = vi.fn((url: string, init?: RequestInit) => {
    const endereco = new URL(url, "http://loja.local");
    const metodo = init?.method ?? "GET";
    const corpo: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    chamadas.push({
      metodo,
      caminho: endereco.pathname,
      consulta: endereco.searchParams,
      corpo,
    });

    const fila = filas.get(`${metodo} ${endereco.pathname}`);
    const manipulador = fila !== undefined && fila.length > 1 ? fila.shift() : fila?.[0];

    return Promise.resolve(
      manipulador?.(corpo, endereco.searchParams) ?? recusa(404, "Não encontrado."),
    );
  });

  const cliente = new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);

  render(
    <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
      <App />
    </ProvedorSessao>,
  );

  return { chamadas };
}

const GERENTE = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
  nome: "Ana Gerente",
  matricula: "1",
  papel: "GERENTE",
  permissoes: [
    "config:empresa",
    "auditoria:consultar",
    "produto:criar",
    "produto:editar",
    "produto:alterar_preco",
    "fornecedor:consultar",
  ],
  precisaTrocarCredencial: false,
};

const ESTOQUISTA = {
  ...GERENTE,
  nome: "Carlos Estoquista",
  papel: "ESTOQUISTA",
  permissoes: ["produto:criar", "produto:editar"],
};

const CONFIGURACAO = {
  segmento: "PADARIA",
  recursos: ["VENDA_POR_PESO", "BOTOES_RAPIDOS"],
  vendaSemEstoque: "AUTORIZAR",
  larguraCupom: 80,
  impressaoComprovante: "SEMPRE",
  layoutBalanca: {
    prefixos: ["2"],
    tamanhoCodigoProduto: 4,
    conteudo: "PESO",
    casasDecimais: 3,
  },
  gravada: true,
  padroes: {
    PADARIA: ["VENDA_POR_PESO", "BOTOES_RAPIDOS"],
    MERCADINHO: ["FIADO"],
    FRUTARIA: ["VENDA_POR_PESO", "BOTOES_RAPIDOS"],
    MISTO: ["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"],
  },
};

const IMAGEM = "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0801";

function telaDeConfiguracao(
  extras: Record<string, Manipulador | readonly Manipulador[]> = {},
  usuario: typeof GERENTE = GERENTE,
): { readonly chamadas: Chamada[] } {
  return montar({
    "GET /api/acesso/eu": () => json(200, usuario),
    "GET /api/produtos": () => json(200, { itens: [] }),
    "GET /api/categorias": () => json(200, { itens: [] }),
    "GET /api/configuracao": () => json(200, CONFIGURACAO),
    "GET /api/pdv/contexto": () =>
      json(200, {
        integracoes: [
          {
            codigo: "IMPRESSORA",
            nome: "Impressora térmica",
            situacao: "DISPONIVEL",
            explicacao: "Pelo Agente Local.",
          },
          {
            codigo: "BALANCA",
            nome: "Balança",
            situacao: "EM_CONFIGURACAO",
            explicacao: "Pela etiqueta.",
          },
          {
            codigo: "TEF",
            nome: "Maquininha integrada",
            situacao: "NAO_IMPLEMENTADA",
            explicacao: "O operador confirma.",
          },
        ],
      }),
    "PUT /api/configuracao": (corpo) =>
      json(200, { ...CONFIGURACAO, ...(corpo as object) }),
    ...extras,
  });
}

async function abrir(aba: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: aba }));
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configuração da loja", () => {
  it("🔑 mostra como a loja vende e grava o estado inteiro", async () => {
    const { chamadas } = telaDeConfiguracao();
    await abrir("Configuração");

    expect(
      await screen.findByRole("heading", { name: "Configuração da loja" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /Padaria/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Venda por peso/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Fiado/ })).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Pedir a liberação do supervisor" }),
    ).toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: /Fiado/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Botões rápidos/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Não vender" }));
    await userEvent.selectOptions(screen.getByLabelText("Largura do papel"), "58");
    await userEvent.selectOptions(screen.getByLabelText("Quando imprimir"), "SOB_PEDIDO");
    await userEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));

    expect(await screen.findByText(/Configuração salva/)).toBeVisible();
    expect(chamadas.find((chamada) => chamada.metodo === "PUT")?.corpo).toEqual({
      segmento: "PADARIA",
      recursos: ["VENDA_POR_PESO", "FIADO"],
      vendaSemEstoque: "BLOQUEAR",
      larguraCupom: 58,
      impressaoComprovante: "SOB_PEDIDO",
      layoutBalanca: {
        prefixos: ["2"],
        tamanhoCodigoProduto: 4,
        conteudo: "PESO",
        casasDecimais: 3,
      },
      logoId: null,
    });
  });

  it("🔑 o tipo de loja sugere os recursos, e o gerente aplica com um toque", async () => {
    const { chamadas } = telaDeConfiguracao();
    await abrir("Configuração");

    await userEvent.click(await screen.findByRole("radio", { name: /Mercadinho/ }));
    await userEvent.click(
      screen.getByRole("button", {
        name: "Usar os recursos recomendados para mercadinho",
      }),
    );

    expect(screen.getByRole("checkbox", { name: /Fiado/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Venda por peso/ })).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: /Usar os recursos recomendados/ }),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Largura do papel"), "80");
    await userEvent.selectOptions(screen.getByLabelText("Quando imprimir"), "SEMPRE");
    await userEvent.click(screen.getByRole("radio", { name: /Vender normalmente/ }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
    await screen.findByText(/Configuração salva/);

    expect(chamadas.find((chamada) => chamada.metodo === "PUT")?.corpo).toMatchObject({
      segmento: "MERCADINHO",
      recursos: ["FIADO"],
      vendaSemEstoque: "PERMITIR",
    });
  });

  it("a configuração de fábrica avisa que falta conferir e salvar", async () => {
    telaDeConfiguracao({
      "GET /api/configuracao": () => json(200, { ...CONFIGURACAO, gravada: false }),
    });
    await abrir("Configuração");

    expect(await screen.findByText(/ainda usa a configuração de fábrica/)).toBeVisible();
  });

  it("🔑 quem não é gerente consulta, mas não muda", async () => {
    telaDeConfiguracao({}, ESTOQUISTA);
    await abrir("Configuração");

    expect(await screen.findByText(/Para mudar, peça ao gerente/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Salvar configuração" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Fiado/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Conferir o formato" })).toBeDisabled();
  });

  it("recusa do servidor lista os campos, ou diz a frase dele", async () => {
    telaDeConfiguracao({
      "PUT /api/configuracao": [
        () =>
          recusa(400, "Confira os campos da configuração.", {
            erros: [
              { mensagem: "Escolha ao menos um prefixo para a etiqueta." },
              { codigo: "SEM_MENSAGEM" },
            ],
          }),
        () => recusa(500, "O servidor não respondeu como devia."),
      ],
    });
    await abrir("Configuração");

    await userEvent.click(
      await screen.findByRole("button", { name: "Salvar configuração" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escolha ao menos um prefixo para a etiqueta.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "O servidor não respondeu como devia.",
      );
    });
  });

  it("falha ao carregar oferece tentar de novo", async () => {
    telaDeConfiguracao({
      "GET /api/configuracao": [
        () => recusa(500, "Servidor indisponível."),
        () => json(200, CONFIGURACAO),
      ],
    });
    await abrir("Configuração");

    expect(await screen.findByText("Servidor indisponível.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(
      await screen.findByRole("heading", { name: "Configuração da loja" }),
    ).toBeVisible();
  });

  it("🔑 mostra a situação de cada integração — e some se o contexto falhar", async () => {
    telaDeConfiguracao();
    await abrir("Configuração");

    const integracoes = await screen.findByRole("region", { name: "Integrações" });
    expect(within(integracoes).getByText("Disponível")).toBeVisible();
    expect(within(integracoes).getByText("Em configuração")).toBeVisible();
    expect(within(integracoes).getByText("Não implementada")).toBeVisible();
    expect(integracoes).toHaveTextContent("O operador confirma.");
  });

  it("sem o contexto, a tela segue sem a lista de integrações", async () => {
    telaDeConfiguracao({ "GET /api/pdv/contexto": () => recusa(500, "x") });
    await abrir("Configuração");

    await screen.findByRole("heading", { name: "Configuração da loja" });
    expect(screen.queryByRole("region", { name: "Integrações" })).not.toBeInTheDocument();
  });
});

describe("logotipo e fotos", () => {
  function arquivo(tamanho: number): File {
    return new File([new Uint8Array(tamanho)], "logo.png", { type: "image/png" });
  }

  it("🔑 envia a foto, mostra, e grava o identificador — tirar grava null", async () => {
    const { chamadas } = telaDeConfiguracao({
      "POST /api/imagens": () => json(201, { id: IMAGEM }),
    });
    await abrir("Configuração");

    await userEvent.upload(await screen.findByLabelText("Escolher foto"), arquivo(64));

    expect(
      await screen.findByRole("img", { name: "Logotipo da loja atual" }),
    ).toHaveAttribute("src", `/api/imagens/${IMAGEM}`);
    const enviada = chamadas.find((chamada) => chamada.caminho === "/api/imagens")
      ?.corpo as {
      conteudo: string;
    };
    expect(enviada.conteudo).toMatch(/^[A-Za-z0-9+/=]+$/);

    await userEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
    await screen.findByText(/Configuração salva/);
    expect(
      chamadas.filter((chamada) => chamada.metodo === "PUT").at(-1)?.corpo,
    ).toMatchObject({ logoId: IMAGEM });

    await userEvent.click(screen.getByRole("button", { name: "Tirar foto" }));
    expect(screen.getByLabelText("Escolher foto")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
    await waitFor(() => {
      expect(chamadas.filter((chamada) => chamada.metodo === "PUT")).toHaveLength(2);
    });
    expect(
      chamadas.filter((chamada) => chamada.metodo === "PUT").at(-1)?.corpo,
    ).toMatchObject({ logoId: null });
  });

  it("foto grande demais é recusada antes de enviar", async () => {
    const { chamadas } = telaDeConfiguracao();
    await abrir("Configuração");

    await userEvent.upload(
      await screen.findByLabelText("Escolher foto"),
      arquivo(700 * 1024),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("A foto passa de 600 KB.");
    expect(chamadas.some((chamada) => chamada.caminho === "/api/imagens")).toBe(false);
  });

  it("foto recusada pelo servidor mostra a frase dele", async () => {
    telaDeConfiguracao({
      "POST /api/imagens": () => recusa(400, "Envie a foto em JPG, PNG ou WebP."),
    });
    await abrir("Configuração");

    await userEvent.upload(await screen.findByLabelText("Escolher foto"), arquivo(64));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Envie a foto em JPG, PNG ou WebP.",
    );
  });

  it("arquivo que não pôde ser lido vira mensagem", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function falhar(
      this: FileReader,
    ) {
      this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
    });
    telaDeConfiguracao();
    await abrir("Configuração");

    await userEvent.upload(await screen.findByLabelText("Escolher foto"), arquivo(64));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível ler a foto. Tente outra.",
    );
  });
});

describe("etiqueta da balança", () => {
  it("🔑 confere o formato com uma etiqueta de exemplo e com a etiqueta bipada", async () => {
    const { chamadas } = telaDeConfiguracao({
      "POST /api/configuracao/balanca/testar": () =>
        json(200, {
          exemplo: { etiqueta: "2000012007003", significado: "produto 12, R$ 7,00" },
          leitura: { valida: true, codigoProduto: "12345", preco: "700" },
        }),
    });
    await abrir("Configuração");

    const prefixos = await screen.findByLabelText("Começa com");
    await userEvent.clear(prefixos);
    await userEvent.type(prefixos, "20, 21x");
    await userEvent.selectOptions(
      screen.getByLabelText("Dígitos do código do produto"),
      "5",
    );
    await userEvent.selectOptions(screen.getByLabelText("A etiqueta traz"), "PRECO");
    await userEvent.selectOptions(screen.getByLabelText("Casas depois da vírgula"), "2");
    await userEvent.type(
      screen.getByLabelText("Etiqueta para conferir (opcional)"),
      "2012345007004",
    );
    await userEvent.click(screen.getByRole("button", { name: "Conferir o formato" }));

    const resultado = await screen.findByRole("status");
    expect(resultado).toHaveTextContent(
      "Exemplo neste formato: 2000012007003 = produto 12, R$ 7,00.",
    );
    expect(resultado).toHaveTextContent(
      "A etiqueta bipada foi lida: produto 12345, R$ 7,00.",
    );
    expect(
      chamadas.find((chamada) => chamada.caminho === "/api/configuracao/balanca/testar")
        ?.corpo,
    ).toEqual({
      layout: {
        prefixos: ["20", "21"],
        tamanhoCodigoProduto: 5,
        conteudo: "PRECO",
        casasDecimais: 2,
      },
      etiqueta: "2012345007004",
    });

    await userEvent.selectOptions(screen.getByLabelText("A etiqueta traz"), "PESO");
    await userEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
    await screen.findByText(/Configuração salva/);
    expect(chamadas.find((chamada) => chamada.metodo === "PUT")?.corpo).toMatchObject({
      layoutBalanca: {
        prefixos: ["20", "21"],
        tamanhoCodigoProduto: 5,
        conteudo: "PESO",
        casasDecimais: 2,
      },
    });
  });

  it("etiqueta com peso, e etiqueta que não fecha com o formato", async () => {
    telaDeConfiguracao({
      "POST /api/configuracao/balanca/testar": [
        () =>
          json(200, {
            leitura: {
              valida: true,
              codigoProduto: "12",
              peso: { milesimos: "350", unidade: "KG" },
            },
          }),
        () =>
          json(200, {
            leitura: { valida: false, mensagem: "O dígito verificador não confere." },
          }),
      ],
    });
    await abrir("Configuração");

    await userEvent.click(
      await screen.findByRole("button", { name: "Conferir o formato" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("produto 12, 0,35 kg.");

    await userEvent.click(screen.getByRole("button", { name: "Conferir o formato" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "não fecha com este formato: O dígito verificador não confere.",
      );
    });
  });

  it("formato inválido lista cada problema", async () => {
    telaDeConfiguracao({
      "POST /api/configuracao/balanca/testar": () =>
        recusa(400, "Confira o formato da etiqueta.", {
          erros: [
            { codigo: "A", mensagem: "Informe o primeiro dígito da etiqueta." },
            { codigo: "B", mensagem: "O código do produto não cabe na etiqueta." },
          ],
        }),
    });
    await abrir("Configuração");

    await userEvent.clear(await screen.findByLabelText("Começa com"));
    await userEvent.click(screen.getByRole("button", { name: "Conferir o formato" }));

    const problemas = await screen.findByRole("alert");
    expect(within(problemas).getAllByRole("listitem")).toHaveLength(2);
    expect(problemas).toHaveTextContent("O código do produto não cabe na etiqueta.");
  });
});

describe("auditoria", () => {
  const REGISTROS = [
    {
      id: "r1",
      ocorridoEm: "2026-10-17T13:05:00.000Z",
      acao: "DESCONTO_ITEM",
      descricao: "Desconto de R$ 2,00 (10%) no item 3 da venda 47",
      usuarioNome: "Maria da Silva",
      autorizadoPorNome: "Rita Supervisora",
    },
    {
      id: "r2",
      ocorridoEm: "2026-10-17T14:00:00.000Z",
      acao: "OUTRA_COISA",
      descricao: "Backup das 14h",
    },
  ];

  function telaDeAuditoria(
    extras: Record<string, Manipulador | readonly Manipulador[]> = {},
  ): { readonly chamadas: Chamada[] } {
    return montar({
      "GET /api/acesso/eu": () => json(200, GERENTE),
      "GET /api/produtos": () => json(200, { itens: [] }),
      "GET /api/categorias": () => json(200, { itens: [] }),
      "GET /api/auditoria": () => json(200, { registros: REGISTROS }),
      ...extras,
    });
  }

  it("🔑 lista o dia de hoje com quem pediu e quem liberou", async () => {
    const { chamadas } = telaDeAuditoria();
    await abrir("Auditoria");

    const tabela = await screen.findByRole("table", { name: "Registros de auditoria" });
    const [, desconto, backup] = within(tabela).getAllByRole("row");
    expect(desconto).toHaveTextContent("Desconto no item");
    expect(desconto).toHaveTextContent("Maria da Silva");
    expect(desconto).toHaveTextContent("Rita Supervisora");
    expect(backup).toHaveTextContent("OUTRA_COISA");
    expect(backup).toHaveTextContent("Sistema");
    expect(backup).toHaveTextContent("—");

    const consulta = chamadas.find(
      (chamada) => chamada.caminho === "/api/auditoria",
    )?.consulta;
    expect(consulta?.get("de")).toBe(hojeNaLoja());
    expect(consulta?.get("ate")).toBe(hojeNaLoja());
    expect(consulta?.has("acao")).toBe(false);
  });

  it("filtra por período e pelo tipo do registro", async () => {
    const { chamadas } = telaDeAuditoria();
    await abrir("Auditoria");
    await screen.findByRole("table", { name: "Registros de auditoria" });

    const de = screen.getByLabelText("De");
    await userEvent.clear(de);
    await userEvent.type(de, "2026-10-01");
    const ate = screen.getByLabelText("Até");
    await userEvent.clear(ate);
    await userEvent.type(ate, "2026-10-15");
    await userEvent.selectOptions(screen.getByLabelText("O quê"), "SANGRIA");
    await userEvent.click(screen.getByRole("button", { name: "Consultar" }));

    await waitFor(() => {
      expect(
        chamadas.filter((chamada) => chamada.caminho === "/api/auditoria"),
      ).toHaveLength(2);
    });
    const consulta = chamadas
      .filter((chamada) => chamada.caminho === "/api/auditoria")
      .at(-1)?.consulta;
    expect(consulta?.get("de")).toBe("2026-10-01");
    expect(consulta?.get("ate")).toBe("2026-10-15");
    expect(consulta?.get("acao")).toBe("SANGRIA");
  });

  it("período sem registro diz o que fazer, e a falha oferece tentar de novo", async () => {
    telaDeAuditoria({
      "GET /api/auditoria": [
        () => recusa(500, "Servidor indisponível."),
        () => json(200, { registros: [] }),
      ],
    });
    await abrir("Auditoria");

    expect(await screen.findByText("Servidor indisponível.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("Nada registrado nesse período.")).toBeVisible();
  });

  it("sem a permissão, a aba nem aparece", async () => {
    montar({
      "GET /api/acesso/eu": () => json(200, ESTOQUISTA),
      "GET /api/produtos": () => json(200, { itens: [] }),
      "GET /api/categorias": () => json(200, { itens: [] }),
    });

    await screen.findByRole("button", { name: "Produtos" });
    expect(screen.queryByRole("button", { name: "Auditoria" })).not.toBeInTheDocument();
  });

  it("hoje na loja é a data do relógio local, no formato do campo", () => {
    expect(hojeNaLoja(new Date("2026-10-17T15:00:00.000Z"))).toMatch(/^2026-10-1[67]$/);
  });
});

describe("opções do produto que o caixa usa", () => {
  const PRODUTO = {
    id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002",
    sku: "PAO",
    descricao: "Pão francês",
    descricaoPdv: "PAO FRANCES",
    tipo: "PESAVEL",
    unidade: "KG",
    precoVenda: "1690",
    referencias: [],
    embalagens: [],
    ativo: true,
    estoqueMinimo: "12000",
    fornecedorId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0701",
    imagemId: IMAGEM,
    botaoRapido: true,
  };

  const FORNECEDORES = {
    itens: [
      { id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0701", exibicao: "Moinho Bom Grão" },
      { id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0702", exibicao: "Distribuidora Sol" },
    ],
  };

  function telaDeProdutos(
    usuario: typeof GERENTE,
    produto: Record<string, unknown>,
    extras: Record<string, Manipulador | readonly Manipulador[]> = {},
  ): { readonly chamadas: Chamada[] } {
    return montar({
      "GET /api/acesso/eu": () => json(200, usuario),
      "GET /api/produtos": () => json(200, { itens: [produto] }),
      "GET /api/categorias": () => json(200, { itens: [] }),
      "GET /api/fornecedores": () => json(200, FORNECEDORES),
      [`PUT /api/produtos/${PRODUTO.id}`]: () => json(200, produto),
      "POST /api/produtos": () => json(201, produto),
      ...extras,
    });
  }

  function corpoSalvo(
    chamadas: readonly Chamada[],
    metodo: string,
  ): Record<string, unknown> {
    return chamadas.find((chamada) => chamada.metodo === metodo)?.corpo as Record<
      string,
      unknown
    >;
  }

  it("🔑 salvar a descrição não apaga a foto, o fornecedor, o mínimo nem o botão", async () => {
    const { chamadas } = telaDeProdutos(GERENTE, PRODUTO);

    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));

    const opcoes = await screen.findByRole("group", { name: "Mais opções" });
    expect(
      within(opcoes).getByRole("img", { name: "Foto do produto atual" }),
    ).toBeVisible();
    expect(
      within(opcoes).getByRole("checkbox", {
        name: "Mostrar como botão rápido no caixa",
      }),
    ).toBeChecked();
    expect(within(opcoes).getByLabelText("Estoque mínimo (kg)")).toHaveValue("12");
    await waitFor(() => {
      expect(within(opcoes).getByLabelText("Fornecedor principal")).toHaveDisplayValue(
        "Moinho Bom Grão",
      );
    });

    const descricao = screen.getByLabelText(/^Descrição \*/);
    await userEvent.type(descricao, " fresquinho");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(chamadas.some((chamada) => chamada.metodo === "PUT")).toBe(true);
    });
    expect(corpoSalvo(chamadas, "PUT")).toMatchObject({
      descricao: "Pão francês fresquinho",
      estoqueMinimo: "12000",
      fornecedorId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0701",
      imagemId: IMAGEM,
      botaoRapido: true,
    });
  });

  it("produto sem nada disso: as opções ficam recolhidas, e abrem num toque", async () => {
    const { chamadas } = telaDeProdutos(GERENTE, {
      ...PRODUTO,
      estoqueMinimo: undefined,
      fornecedorId: undefined,
      imagemId: undefined,
      botaoRapido: false,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await userEvent.click(screen.getByRole("button", { name: /Mais opções: foto/ }));

    const opcoes = screen.getByRole("group", { name: "Mais opções" });
    await userEvent.click(
      within(opcoes).getByRole("checkbox", {
        name: "Mostrar como botão rápido no caixa",
      }),
    );
    await userEvent.type(within(opcoes).getByLabelText("Estoque mínimo (kg)"), "1,5");
    await waitFor(() => {
      expect(
        within(opcoes).getByRole("option", { name: "Distribuidora Sol" }),
      ).toBeInTheDocument();
    });
    await userEvent.selectOptions(
      within(opcoes).getByLabelText("Fornecedor principal"),
      "Distribuidora Sol",
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(chamadas.some((chamada) => chamada.metodo === "PUT")).toBe(true);
    });
    const corpo = corpoSalvo(chamadas, "PUT");
    expect(corpo).toMatchObject({
      estoqueMinimo: "1500",
      fornecedorId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0702",
      botaoRapido: true,
    });
    expect(corpo["imagemId"]).toBeUndefined();
  });

  it("estoque mínimo torto é recusado antes da rede", async () => {
    const { chamadas } = telaDeProdutos(GERENTE, PRODUTO);

    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const minimo = await screen.findByLabelText("Estoque mínimo (kg)");
    await userEvent.clear(minimo);
    await userEvent.type(minimo, "1,2,3");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Estoque mínimo inválido.",
    );
    expect(chamadas.some((chamada) => chamada.metodo === "PUT")).toBe(false);
  });

  it("🔑 quem não vê fornecedores não vê o campo — e o fornecedor gravado vai junto", async () => {
    const { chamadas } = telaDeProdutos(ESTOQUISTA, PRODUTO);

    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await screen.findByRole("group", { name: "Mais opções" });
    expect(screen.queryByLabelText("Fornecedor principal")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(chamadas.some((chamada) => chamada.metodo === "PUT")).toBe(true);
    });
    expect(corpoSalvo(chamadas, "PUT")["fornecedorId"]).toBe(
      "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0701",
    );
    expect(chamadas.some((chamada) => chamada.caminho === "/api/fornecedores")).toBe(
      false,
    );
  });

  it("o fornecedor gravado que a lista não trouxe aparece como atual", async () => {
    telaDeProdutos(GERENTE, PRODUTO, {
      "GET /api/fornecedores": () => json(200, { itens: [FORNECEDORES.itens[1]] }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));

    const campo = await screen.findByLabelText("Fornecedor principal");
    await waitFor(() => {
      expect(
        within(campo).getByRole("option", { name: "Distribuidora Sol" }),
      ).toBeInTheDocument();
    });
    expect(campo).toHaveDisplayValue("Fornecedor atual");
  });

  it("a lista de fornecedores que falha não trava o cadastro", async () => {
    telaDeProdutos(GERENTE, PRODUTO, {
      "GET /api/fornecedores": () => recusa(500, "x"),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));

    expect(await screen.findByLabelText("Fornecedor principal")).toHaveDisplayValue(
      "Fornecedor atual",
    );
  });

  it("produto novo com foto enviada leva o identificador", async () => {
    const { chamadas } = telaDeProdutos(GERENTE, PRODUTO, {
      "POST /api/imagens": () => json(201, { id: IMAGEM }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Novo produto" }));
    await userEvent.type(screen.getByLabelText(/^Descrição \*/), "Bolo de fubá");
    await userEvent.type(screen.getByLabelText(/Código interno/), "BOLO1");
    const preco = screen.getByLabelText(/Preço de venda/);
    await userEvent.clear(preco);
    await userEvent.type(preco, "25,00");
    await userEvent.click(screen.getByRole("button", { name: /Mais opções: foto/ }));
    await userEvent.upload(
      screen.getByLabelText("Escolher foto"),
      new File([new Uint8Array(32)], "bolo.png", { type: "image/png" }),
    );
    await screen.findByRole("img", { name: "Foto do produto atual" });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(
        chamadas.some(
          (chamada) => chamada.metodo === "POST" && chamada.caminho === "/api/produtos",
        ),
      ).toBe(true);
    });
    expect(
      chamadas.find(
        (chamada) => chamada.metodo === "POST" && chamada.caminho === "/api/produtos",
      )?.corpo,
    ).toMatchObject({ imagemId: IMAGEM, botaoRapido: false });
  });
});

describe("cópias de segurança", () => {
  const ADMINISTRADOR = {
    ...GERENTE,
    nome: "Rui Administrador",
    papel: "ADMIN",
    permissoes: [...GERENTE.permissoes, "backup:executar", "config:backup"],
  };
  const GERENTE_COM_COPIA = {
    ...GERENTE,
    permissoes: [...GERENTE.permissoes, "backup:executar"],
  };

  const minutosAtras = (minutos: number) =>
    new Date(Date.now() - minutos * 60_000).toISOString();

  const RESUMO = {
    vendas: 1234,
    produtos: 300,
    clientes: 40,
    ultimaVenda: "2026-10-17T13:55:00.000Z",
    caixasAbertos: 0,
    versao: "20261017120000_backup_agenda",
  };

  const BOA = {
    nome: "copia-20261017-140000-automatica.dump",
    criadaEm: minutosAtras(10),
    origem: "AUTOMATICA",
    tamanhoBytes: 12_900_000,
    conferida: true,
    resumo: RESUMO,
  };

  const RUIM = {
    nome: "copia-20261017-130000-manual.dump",
    criadaEm: minutosAtras(70),
    origem: "MANUAL",
    tamanhoBytes: 850 * 1024,
    conferida: false,
    motivo: "o arquivo não restaurou",
  };

  function situacao(sobrescritas: Record<string, unknown> = {}) {
    return {
      configurada: true,
      pasta: "C:/ProgramData/ERP PDV/backup",
      copias: [BOA, RUIM],
      configuracao: { intervaloHoras: 1, aoFecharCaixa: true },
      ultimaTentativa: {
        origem: "AUTOMATICA",
        situacao: "CONCLUIDO",
        iniciadaEm: BOA.criadaEm,
      },
      emAndamento: false,
      proximaAutomatica: new Date(Date.now() + 50 * 60_000).toISOString(),
      ...sobrescritas,
    };
  }

  function telaDeCopias(
    extras: Record<string, Manipulador | readonly Manipulador[]> = {},
    usuario: typeof GERENTE = ADMINISTRADOR,
  ): { readonly chamadas: Chamada[] } {
    return montar({
      "GET /api/acesso/eu": () => json(200, usuario),
      "GET /api/produtos": () => json(200, { itens: [] }),
      "GET /api/categorias": () => json(200, { itens: [] }),
      "GET /api/copias-de-seguranca": () => json(200, situacao()),
      ...extras,
    });
  }

  it("🔑 o topo responde o que se perde se o computador queimar agora", async () => {
    telaDeCopias();
    await abrir("Cópias de segurança");

    expect(await screen.findByText(/Última cópia boa:/)).toHaveTextContent(
      "há 10 minutos) — 1.234 vendas, 300 produtos, 40 clientes.",
    );
    expect(
      screen.getByText(/Cópia automática: de hora em hora, e a cada fechamento de caixa/),
    ).toBeInTheDocument();

    const tabela = screen.getByRole("table", { name: "Cópias guardadas" });
    const linhas = within(tabela).getAllByRole("row");
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toHaveTextContent("Automática");
    expect(linhas[1]).toHaveTextContent("12,3 MB");
    expect(linhas[2]).toHaveTextContent(
      "Não restaurou na conferência: o arquivo não restaurou",
    );
    expect(linhas[2]).toHaveTextContent("850 KB");
    expect(
      screen.getByText(/copie os arquivos dessa pasta para um pendrive/),
    ).toHaveTextContent("C:/ProgramData/ERP PDV/backup");
  });

  it("🔑 sem cópia boa, pede uma agora; a tentativa que falhou aparece com o motivo", async () => {
    telaDeCopias({
      "GET /api/copias-de-seguranca": () =>
        json(
          200,
          situacao({
            copias: [RUIM],
            ultimaTentativa: {
              origem: "AUTOMATICA",
              situacao: "FALHOU",
              iniciadaEm: RUIM.criadaEm,
              erro: "O banco não respondeu. Detalhe para o suporte: connection refused",
            },
            proximaAutomatica: minutosAtras(1),
          }),
        ),
    });
    await abrir("Cópias de segurança");

    expect(
      await screen.findByText("Ainda não há nenhuma cópia conferida. Faça uma agora."),
    ).toBeInTheDocument();
    expect(screen.getByText(/A última tentativa, em/)).toHaveTextContent(
      "não deu certo: O banco não respondeu. Detalhe para o suporte: connection refused",
    );
    expect(screen.getByText(/Próxima: em instantes/)).toBeInTheDocument();
  });

  it("a cópia boa que ficou velha é avisada", async () => {
    telaDeCopias({
      "GET /api/copias-de-seguranca": () =>
        json(
          200,
          situacao({
            copias: [{ ...BOA, criadaEm: minutosAtras(60 * 30) }],
            configuracao: { intervaloHoras: 6, aoFecharCaixa: false },
            ultimaTentativa: undefined,
            proximaAutomatica: undefined,
          }),
        ),
    });
    await abrir("Cópias de segurança");

    expect(await screen.findByText(/Última cópia boa:/)).toHaveTextContent(
      "Ela está velha: faça uma cópia agora e, se falhar, chame o suporte.",
    );
    expect(screen.getByText(/Cópia automática: a cada 6 horas\./)).toBeInTheDocument();
  });

  it("🔑 fazer uma cópia agora: o botão fica ocupado, e depois a tela diz o que ficou", async () => {
    let soltar: () => void = () => undefined;
    const pronta = new Promise<void>((resolver) => {
      soltar = resolver;
    });
    const { chamadas } = telaDeCopias({
      "POST /api/copias-de-seguranca": () => pronta.then(() => json(201, { copia: BOA })),
    });
    await abrir("Cópias de segurança");

    await userEvent.click(
      await screen.findByRole("button", { name: "Fazer uma cópia agora" }),
    );

    // Enquanto o `pg_dump` roda: ocupado, e a frase de que o caixa segue.
    expect(
      await screen.findByRole("button", { name: "Fazendo a cópia…" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Pode levar alguns minutos. O caixa continua vendendo."),
    ).toBeInTheDocument();

    soltar();

    expect(
      await screen.findByText(/Cópia feita e conferida: 1.234 vendas/),
    ).toBeInTheDocument();
    // Depois da cópia, a lista é lida de novo.
    await waitFor(() => {
      expect(
        chamadas.filter(
          (chamada) =>
            chamada.caminho === "/api/copias-de-seguranca" && chamada.metodo === "GET",
        ),
      ).toHaveLength(2);
    });
  });

  it("a cópia que não passou na prova é avisada como problema", async () => {
    telaDeCopias({
      "POST /api/copias-de-seguranca": () => json(201, { copia: RUIM }),
    });
    await abrir("Cópias de segurança");
    await userEvent.click(
      await screen.findByRole("button", { name: "Fazer uma cópia agora" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A cópia foi feita, mas não passou na conferência (o arquivo não restaurou). Chame o suporte.",
    );
  });

  it("a falha ao copiar mostra a frase do servidor", async () => {
    telaDeCopias({
      "POST /api/copias-de-seguranca": () =>
        recusa(409, "O banco não deixou fazer a cópia de segurança."),
    });
    await abrir("Cópias de segurança");
    await userEvent.click(
      await screen.findByRole("button", { name: "Fazer uma cópia agora" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O banco não deixou fazer a cópia de segurança.",
    );
  });

  it("com uma cópia em andamento, o botão espera", async () => {
    telaDeCopias({
      "GET /api/copias-de-seguranca": () => json(200, situacao({ emAndamento: true })),
    });
    await abrir("Cópias de segurança");

    expect(
      await screen.findByText("Uma cópia está sendo feita agora."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fazer uma cópia agora" })).toBeDisabled();
  });

  it("🔑 o gerente faz cópia, mas não mexe na agenda nem restaura", async () => {
    telaDeCopias({}, GERENTE_COM_COPIA);
    await abrir("Cópias de segurança");

    expect(
      await screen.findByRole("button", { name: "Fazer uma cópia agora" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("form", { name: "Agenda das cópias" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Conferir e restaurar/ }),
    ).not.toBeInTheDocument();
  });

  it("🔑 o administrador muda a agenda — e a recusa do servidor aparece", async () => {
    const { chamadas } = telaDeCopias({
      "PUT /api/copias-de-seguranca/agenda": [
        (corpo) => json(200, { configuracao: corpo }),
        () =>
          recusa(
            400,
            "Escolha de quanto em quanto tempo sai a cópia entre as opções da lista.",
          ),
      ],
    });
    await abrir("Cópias de segurança");

    const agenda = await screen.findByRole("form", { name: "Agenda das cópias" });
    await userEvent.selectOptions(within(agenda).getByLabelText("Cópia automática"), "4");
    await userEvent.click(
      within(agenda).getByRole("checkbox", {
        name: "Fazer uma cópia a cada fechamento de caixa",
      }),
    );
    await userEvent.click(within(agenda).getByRole("button", { name: "Salvar agenda" }));

    expect(await within(agenda).findByText("Agenda salva.")).toBeInTheDocument();
    expect(chamadas.find((chamada) => chamada.metodo === "PUT")?.corpo).toEqual({
      intervaloHoras: 4,
      aoFecharCaixa: false,
    });
    expect(screen.getByText(/Cópia automática: a cada 4 horas\./)).toBeInTheDocument();

    await userEvent.click(within(agenda).getByRole("button", { name: "Salvar agenda" }));
    expect(await within(agenda).findByRole("alert")).toHaveTextContent(
      "Escolha de quanto em quanto tempo sai a cópia entre as opções da lista.",
    );
  });

  describe("restaurar", () => {
    const CONFERENCIA = {
      copia: BOA,
      restaurou: true,
      daCopia: { ...RESUMO, vendas: 1100 },
      atual: { ...RESUMO, ultimaVenda: "2026-10-17T15:02:00.000Z", caixasAbertos: 2 },
      compativel: true,
    };

    async function escolher(): Promise<HTMLElement> {
      await abrir("Cópias de segurança");
      await userEvent.click(
        (
          await screen.findAllByRole("button", {
            name: /Conferir e restaurar a cópia de/,
          })
        )[0] as HTMLElement,
      );
      return screen.findByRole("region", { name: /Restaurar a cópia de/ });
    }

    it("🔑 confere primeiro, mostra lado a lado e avisa dos caixas; só restaura com a palavra", async () => {
      const { chamadas } = telaDeCopias({
        [`POST /api/copias-de-seguranca/${BOA.nome}/conferencia`]: () =>
          json(200, { conferencia: CONFERENCIA }),
        [`POST /api/copias-de-seguranca/${BOA.nome}/restauracao`]: () =>
          json(200, {
            restaurada: BOA,
            copiaDeAntes: {
              ...BOA,
              nome: "copia-x.dump",
              origem: "ANTES_DE_RESTAURAR",
              criadaEm: "2026-10-17T15:10:00.000Z",
            },
          }),
      });

      const painel = await escolher();
      expect(painel).toHaveFocus();

      const tabela = await within(painel).findByRole("table", {
        name: "A cópia ao lado do banco de agora",
      });
      expect(within(tabela).getByRole("row", { name: /Vendas/ })).toHaveTextContent(
        "1.1001.234",
      );
      expect(within(painel).getByText(/Há 2 caixas abertos agora\./)).toBeInTheDocument();

      const restaurar = within(painel).getByRole("button", {
        name: "Restaurar esta cópia",
      });
      expect(restaurar).toBeDisabled();
      await userEvent.type(
        within(painel).getByLabelText("Para confirmar, digite RESTAURAR"),
        "restaurar",
      );
      // Com caixa aberto, a palavra não basta: é preciso pedir mesmo assim.
      expect(restaurar).toBeDisabled();
      await userEvent.click(
        within(painel).getByRole("checkbox", {
          name: /Restaurar mesmo com caixas abertos/,
        }),
      );
      expect(restaurar).toBeEnabled();
      await userEvent.click(restaurar);

      expect(
        await screen.findByText(
          /restaurada\. O banco de antes ficou guardado na cópia de/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: /Restaurar a cópia de/ }),
      ).not.toBeInTheDocument();
      expect(
        chamadas.find((chamada) => chamada.caminho.endsWith("/restauracao"))?.corpo,
      ).toEqual({
        confirmacao: "restaurar",
        comCaixasAbertos: true,
      });
    });

    it("um caixa aberto é dito no singular, e cancelar fecha sem restaurar", async () => {
      const { chamadas } = telaDeCopias({
        [`POST /api/copias-de-seguranca/${BOA.nome}/conferencia`]: () =>
          json(200, {
            conferencia: {
              ...CONFERENCIA,
              atual: { ...CONFERENCIA.atual, caixasAbertos: 1 },
            },
          }),
      });

      const painel = await escolher();
      expect(
        await within(painel).findByText(/Há 1 caixa aberto agora\./),
      ).toBeInTheDocument();
      await userEvent.click(within(painel).getByRole("button", { name: "Cancelar" }));

      expect(
        screen.queryByRole("region", { name: /Restaurar a cópia de/ }),
      ).not.toBeInTheDocument();
      expect(chamadas.some((chamada) => chamada.caminho.endsWith("/restauracao"))).toBe(
        false,
      );
    });

    it("sem caixa aberto, nenhum aviso de caixa", async () => {
      telaDeCopias({
        [`POST /api/copias-de-seguranca/${BOA.nome}/conferencia`]: () =>
          json(200, {
            conferencia: {
              ...CONFERENCIA,
              atual: { ...CONFERENCIA.atual, caixasAbertos: 0, ultimaVenda: undefined },
            },
          }),
      });

      const painel = await escolher();
      await within(painel).findByRole("table", {
        name: "A cópia ao lado do banco de agora",
      });
      expect(
        within(painel).queryByText(/caixa aberto|caixas abertos/),
      ).not.toBeInTheDocument();
      expect(within(painel).getByRole("row", { name: /Última venda/ })).toHaveTextContent(
        "—",
      );
    });

    it("🔑 cópia de outra versão: nada de restaurar, só fechar", async () => {
      telaDeCopias({
        [`POST /api/copias-de-seguranca/${BOA.nome}/conferencia`]: () =>
          json(200, { conferencia: { ...CONFERENCIA, compativel: false } }),
      });

      const painel = await escolher();
      expect(
        await within(painel).findByText(/é de outra versão do sistema/),
      ).toBeInTheDocument();
      expect(
        within(painel).queryByRole("button", { name: "Restaurar esta cópia" }),
      ).not.toBeInTheDocument();
      await userEvent.click(within(painel).getByRole("button", { name: "Fechar" }));
      expect(
        screen.queryByRole("region", { name: /Restaurar a cópia de/ }),
      ).not.toBeInTheDocument();
    });

    it("cópia que não restaurou na conferência pede outra", async () => {
      telaDeCopias({
        [`POST /api/copias-de-seguranca/${BOA.nome}/conferencia`]: () =>
          json(200, {
            conferencia: {
              copia: BOA,
              restaurou: false,
              motivo: "arquivo truncado",
              atual: RESUMO,
              compativel: false,
            },
          }),
      });

      const painel = await escolher();
      expect(await within(painel).findByRole("alert")).toHaveTextContent(
        "Esta cópia não restaurou na conferência (arquivo truncado). Escolha outra.",
      );
    });

    it("conferência que falha oferece tentar de novo", async () => {
      telaDeCopias({
        [`POST /api/copias-de-seguranca/${BOA.nome}/conferencia`]: [
          () => recusa(409, "Já há uma cópia de segurança em andamento."),
          () => json(200, { conferencia: CONFERENCIA }),
        ],
      });

      const painel = await escolher();
      expect(
        await within(painel).findByText("Já há uma cópia de segurança em andamento."),
      ).toBeInTheDocument();
      await userEvent.click(
        within(painel).getByRole("button", { name: /Tentar de novo/ }),
      );

      expect(
        await within(painel).findByRole("table", {
          name: "A cópia ao lado do banco de agora",
        }),
      ).toBeInTheDocument();
    });

    it("restauração recusada mostra a frase, e o painel continua aberto", async () => {
      const { chamadas } = telaDeCopias({
        [`POST /api/copias-de-seguranca/${BOA.nome}/conferencia`]: () =>
          json(200, {
            conferencia: {
              ...CONFERENCIA,
              atual: { ...CONFERENCIA.atual, caixasAbertos: 0 },
            },
          }),
        [`POST /api/copias-de-seguranca/${BOA.nome}/restauracao`]: () =>
          recusa(
            409,
            "A restauração não terminou, e o banco continua como estava. Chame o suporte.",
          ),
      });

      const painel = await escolher();
      await userEvent.type(
        await within(painel).findByLabelText("Para confirmar, digite RESTAURAR"),
        "RESTAURAR",
      );
      await userEvent.click(
        within(painel).getByRole("button", { name: "Restaurar esta cópia" }),
      );

      expect(
        await within(painel).findByText(
          "A restauração não terminou, e o banco continua como estava. Chame o suporte.",
        ),
      ).toHaveAttribute("role", "alert");
      expect(
        screen.getByRole("region", { name: /Restaurar a cópia de/ }),
      ).toBeInTheDocument();
      // Sem caixa aberto, a opção nem aparece — e não vai no pedido.
      expect(
        within(painel).queryByRole("checkbox", {
          name: /Restaurar mesmo com caixas abertos/,
        }),
      ).not.toBeInTheDocument();
      expect(
        chamadas.find((chamada) => chamada.caminho.endsWith("/restauracao"))?.corpo,
      ).toEqual({ confirmacao: "RESTAURAR" });
    });
  });

  it("sem cópias configuradas na instalação, a tela diz para chamar o suporte", async () => {
    telaDeCopias({
      "GET /api/copias-de-seguranca": () => json(200, { configurada: false }),
    });
    await abrir("Cópias de segurança");

    expect(
      await screen.findByText(
        "As cópias de segurança não estão configuradas nesta instalação.",
      ),
    ).toBeInTheDocument();
  });

  it("pasta vazia diz que a primeira cópia sai em instantes", async () => {
    telaDeCopias({
      "GET /api/copias-de-seguranca": () =>
        json(200, situacao({ copias: [], ultimaTentativa: undefined })),
    });
    await abrir("Cópias de segurança");

    expect(await screen.findByText("Nenhuma cópia na pasta ainda.")).toBeInTheDocument();
  });

  it("falha ao carregar oferece tentar de novo", async () => {
    telaDeCopias({
      "GET /api/copias-de-seguranca": [
        () => recusa(409, "A pasta das cópias de segurança não abriu."),
        () => json(200, situacao()),
      ],
    });
    await abrir("Cópias de segurança");

    expect(
      await screen.findByText("A pasta das cópias de segurança não abriu."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(await screen.findByText(/Última cópia boa:/)).toBeInTheDocument();
  });

  it("sem a permissão, a aba nem aparece", async () => {
    telaDeCopias({}, GERENTE);

    await screen.findByRole("button", { name: "Produtos" });
    expect(
      screen.queryByRole("button", { name: "Cópias de segurança" }),
    ).not.toBeInTheDocument();
  });

  it("há quanto tempo e o tamanho, em palavras", () => {
    const agora = new Date("2026-10-17T15:00:00.000Z");
    const antes = (minutos: number) =>
      new Date(agora.getTime() - minutos * 60_000).toISOString();

    expect(haQuantoTempo(antes(1), agora)).toBe("agora há pouco");
    expect(haQuantoTempo(antes(12), agora)).toBe("há 12 minutos");
    expect(haQuantoTempo(antes(60), agora)).toBe("há 1 hora");
    expect(haQuantoTempo(antes(180), agora)).toBe("há 3 horas");
    expect(haQuantoTempo(antes(60 * 72), agora)).toBe("há 3 dias");
    expect(formatarTamanho(100)).toBe("1 KB");
    expect(formatarTamanho(12_900_000)).toBe("12,3 MB");
  });
});
