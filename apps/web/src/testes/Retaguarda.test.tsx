import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App.js";
import { hojeNaLoja } from "../telas/Auditoria.js";

/**
 * As telas que dizem como a loja vende e quem mexeu em quê — e as opções do
 * produto que o caixa usa (foto, botão rápido, estoque mínimo, fornecedor).
 */

type Manipulador = (corpo: unknown, consulta: URLSearchParams) => Response;

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
