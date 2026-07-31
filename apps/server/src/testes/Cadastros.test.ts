import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarUsuario,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
} from "./apoio.js";

let servidor: FastifyInstance;
let container: Container;

const PIN = "419273";
const CNPJ = "11222333000181";
const CPF = "52998224725";

beforeAll(async () => {
  prepararBanco();
  const montado = await montarServidorDeTeste();
  servidor = montado.servidor;
  container = montado.container;
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
});

beforeEach(async () => {
  await limparBanco(container);
});

/** Loga com o papel pedido e devolve o cabeçalho pronto. */
async function comoPapel(
  papel: "OPERADOR_CAIXA" | "SUPERVISOR" | "ESTOQUISTA" | "GERENTE" | "CONTADOR",
  matricula = "1",
): Promise<{ authorization: string }> {
  await cadastrarUsuario(container, {
    matricula,
    nome: `Usuário ${papel}`,
    papel,
    pin: PIN,
  });

  const { token } = await logar(servidor, matricula, PIN);
  return { authorization: `Bearer ${token}` };
}

type Cabecalho = { readonly authorization: string };
type Corpo = Record<string, unknown>;

function post(url: string, headers: Cabecalho, payload: Corpo) {
  return servidor.inject({ method: "POST", url, headers, payload });
}

function put(url: string, headers: Cabecalho, payload: Corpo) {
  return servidor.inject({ method: "PUT", url, headers, payload });
}

function get(url: string, headers: Cabecalho) {
  return servidor.inject({ method: "GET", url, headers });
}

describe("Categorias", () => {
  it("cadastra, lista e altera", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");

    const criada = await post("/api/categorias", cabecalho, { nome: "Bebidas" });
    expect(criada.statusCode).toBe(201);

    const { id } = criada.json<{ id: string }>();

    const lista = await get("/api/categorias", cabecalho);
    expect(lista.json<{ itens: unknown[] }>().itens).toHaveLength(1);

    const alterada = await put(`/api/categorias/${id}`, cabecalho, {
      nome: "Bebidas e sucos",
      ativa: true,
    });

    expect(alterada.json<{ nome: string }>().nome).toBe("Bebidas e sucos");
  });

  it("🔑 recusa a segunda categoria com o mesmo nome", async () => {
    // Duas "Bebidas" parecem a mesma na tela e dividem o faturamento em duas
    // linhas do relatório.
    const cabecalho = await comoPapel("ESTOQUISTA");
    await post("/api/categorias", cabecalho, { nome: "Bebidas" });

    const repetida = await post("/api/categorias", cabecalho, { nome: "  bebidas " });

    expect(repetida.statusCode).toBeGreaterThanOrEqual(400);
    expect(repetida.statusCode).toBeLessThan(500);
  });

  it("nome vazio é 400, não erro interno", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");

    for (const payload of [{}, { nome: "   " }, { nome: "x".repeat(61) }]) {
      expect((await post("/api/categorias", cabecalho, payload)).statusCode).toBe(400);
    }
  });

  it("categoria inexistente na alteração é recusada", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");

    const semId = await put("/api/categorias/nao-e-uuid", cabecalho, {
      nome: "Bebidas",
      ativa: true,
    });
    expect(semId.statusCode).toBe(400);

    const inexistente = await put(
      "/api/categorias/018f3a2b-7c1d-7e4f-8a9b-1c2d3e7f0001",
      cabecalho,
      { nome: "Bebidas", ativa: true },
    );
    expect(inexistente.statusCode).toBe(404);
  });

  it("🔑 o operador de caixa não cria categoria", async () => {
    const cabecalho = await comoPapel("OPERADOR_CAIXA");

    expect((await post("/api/categorias", cabecalho, { nome: "X" })).statusCode).toBe(
      403,
    );
  });
});

describe("Clientes", () => {
  it("🔑 o balcão cadastra o cliente do fiado sem chamar supervisor", async () => {
    // Quem pede fiado quase nunca está cadastrado. Exigir supervisor nesse
    // momento para a venda com a fila esperando.
    const cabecalho = await comoPapel("OPERADOR_CAIXA");

    const criado = await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
    });

    expect(criado.statusCode).toBe(201);
    expect(criado.json<{ limiteCredito: string }>().limiteCredito).toBe("0");
    expect(criado.json<{ vendeAPrazo: boolean }>().vendeAPrazo).toBe(false);
  });

  it("🔑 o operador NÃO define limite de crédito — é decisão de quem responde pelo dinheiro", async () => {
    // Sem esta separação, qualquer operador se autorizaria a vender a prazo.
    const cabecalho = await comoPapel("OPERADOR_CAIXA");

    const recusado = await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
      limiteCredito: "50000",
    });

    expect(recusado.statusCode).toBe(403);
    expect(recusado.json<{ erro: { mensagem: string } }>().erro.mensagem).toMatch(
      /supervisor/i,
    );
  });

  it("limite zero passa pelo balcão — cadastrar quem não compra a prazo é rotina", async () => {
    const cabecalho = await comoPapel("OPERADOR_CAIXA");

    const criado = await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
      limiteCredito: "0",
    });

    expect(criado.statusCode).toBe(201);
  });

  it("o gerente define o limite, e ele volta em centavos", async () => {
    const cabecalho = await comoPapel("GERENTE");

    const criado = await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
      limiteCredito: "123456",
    });

    expect(criado.statusCode).toBe(201);
    expect(criado.json<{ limiteCredito: string }>().limiteCredito).toBe("123456");
    expect(criado.json<{ vendeAPrazo: boolean }>().vendeAPrazo).toBe(true);
  });

  it("🔑 acha pelo documento antes de cadastrar de novo", async () => {
    // É o que impede o mesmo CPF de entrar duas vezes e dividir o histórico de
    // compra entre dois registros.
    const cabecalho = await comoPapel("GERENTE");
    await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
      documento: CPF,
    });

    const achado = await get(`/api/clientes/por-documento/${CPF}`, cabecalho);
    expect(achado.json<{ nome: string }>().nome).toBe("Ana Maria de Souza");

    const naoAchado = await get("/api/clientes/por-documento/11122233396", cabecalho);
    expect(naoAchado.statusCode).toBe(404);
  });

  it("documento malformado na consulta é 400", async () => {
    const cabecalho = await comoPapel("GERENTE");

    expect((await get("/api/clientes/por-documento/123", cabecalho)).statusCode).toBe(
      400,
    );
  });

  it("busca por termo devolve só o que casa", async () => {
    const cabecalho = await comoPapel("GERENTE");

    for (const nome of ["Ângela Ribeiro", "Bruno Alves"]) {
      await post("/api/clientes", cabecalho, { nome, tipoPessoa: "FISICA" });
    }

    const achados = await get("/api/clientes?termo=ANGE", cabecalho);
    expect(achados.json<{ itens: unknown[] }>().itens).toHaveLength(1);

    const todos = await get("/api/clientes", cabecalho);
    expect(todos.json<{ itens: unknown[] }>().itens).toHaveLength(2);
  });

  it("limite absurdo na busca é recusado antes de chegar ao banco", async () => {
    const cabecalho = await comoPapel("GERENTE");

    expect((await get("/api/clientes?limite=99999", cabecalho)).statusCode).toBe(400);
  });

  it("altera o cliente pelo estado completo, preservando o endereço", async () => {
    const cabecalho = await comoPapel("GERENTE");

    const criado = await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
    });
    const { id } = criado.json<{ id: string }>();

    const alterado = await put(`/api/clientes/${id}`, cabecalho, {
      nome: "Ana Maria de Souza Lima",
      apelido: "Aninha",
      telefone: "19998887766",
      email: "ana@exemplo.com.br",
      endereco: {
        logradouro: "Rua das Acácias",
        numero: "120",
        bairro: "Centro",
        municipio: "Piracicaba",
        uf: "SP",
        cep: "13400000",
      },
      ativo: true,
    });

    expect(alterado.statusCode).toBe(200);

    const corpo = alterado.json<{
      apelido: string;
      endereco: { municipio: string };
      telefone: string;
    }>();

    expect(corpo.apelido).toBe("Aninha");
    expect(corpo.endereco.municipio).toBe("Piracicaba");
    expect(corpo.telefone).toBe("19998887766");
  });

  it("🔑 o operador consulta, mas não edita", async () => {
    const gerente = await comoPapel("GERENTE");
    const criado = await post("/api/clientes", gerente, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
    });
    const { id } = criado.json<{ id: string }>();

    const operador = await comoPapel("OPERADOR_CAIXA", "42");

    expect((await get(`/api/clientes/${id}`, operador)).statusCode).toBe(200);
    expect(
      (await put(`/api/clientes/${id}`, operador, { nome: "Outro", ativo: true }))
        .statusCode,
    ).toBe(403);
  });

  it("cliente inexistente e id malformado", async () => {
    const cabecalho = await comoPapel("GERENTE");

    expect((await get("/api/clientes/xpto", cabecalho)).statusCode).toBe(400);
    expect(
      (await get("/api/clientes/018f3a2b-7c1d-7e4f-8a9b-1c2d3e7f0002", cabecalho))
        .statusCode,
    ).toBe(404);
  });

  it("corpo inválido é 400", async () => {
    const cabecalho = await comoPapel("GERENTE");

    expect((await post("/api/clientes", cabecalho, {})).statusCode).toBe(400);
    expect(
      (await post("/api/clientes", cabecalho, { nome: "Ana", tipoPessoa: "X" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await put("/api/clientes/xpto", cabecalho, { nome: "Ana", ativo: true }))
        .statusCode,
    ).toBe(400);
  });
});

describe("Fornecedores", () => {
  it("cadastra com documento obrigatório e busca", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");

    const criado = await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      documento: CNPJ,
      prazoEntregaDias: 7,
    });

    expect(criado.statusCode).toBe(201);
    expect(criado.json<{ documento: string }>().documento).toBe(CNPJ);

    const achados = await get("/api/fornecedores?termo=distribuidora", cabecalho);
    expect(achados.json<{ itens: unknown[] }>().itens).toHaveLength(1);
  });

  it("🔑 fornecedor sem documento é recusado", async () => {
    // Fornecedor existe para sustentar entrada de mercadoria, e toda entrada
    // chega com nota. Sem documento, o cadastro não fecha com nota nenhuma.
    const cabecalho = await comoPapel("ESTOQUISTA");

    const recusado = await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Distribuidora Sem CNPJ",
    });

    expect(recusado.statusCode).toBe(400);
  });

  it("recusa o mesmo documento duas vezes", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");
    await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      documento: CNPJ,
    });

    const repetido = await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Outra Razão Ltda",
      documento: CNPJ,
    });

    expect(repetido.statusCode).toBeGreaterThanOrEqual(400);
    expect(repetido.statusCode).toBeLessThan(500);
  });

  it("altera e desativa", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");
    const criado = await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      documento: CNPJ,
    });
    const { id } = criado.json<{ id: string }>();

    const alterado = await put(`/api/fornecedores/${id}`, cabecalho, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      nomeFantasia: "Bebidas Boas",
      documento: CNPJ,
      ativo: false,
    });

    expect(alterado.json<{ ativo: boolean }>().ativo).toBe(false);
    expect(alterado.json<{ nomeFantasia: string }>().nomeFantasia).toBe("Bebidas Boas");

    const ativos = await get("/api/fornecedores", cabecalho);
    expect(ativos.json<{ itens: unknown[] }>().itens).toHaveLength(0);
  });

  it("consulta por id, id malformado e inexistente", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");
    const criado = await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      documento: CNPJ,
    });
    const { id } = criado.json<{ id: string }>();

    expect((await get(`/api/fornecedores/${id}`, cabecalho)).statusCode).toBe(200);
    expect((await get("/api/fornecedores/xpto", cabecalho)).statusCode).toBe(400);
    expect(
      (await get("/api/fornecedores/018f3a2b-7c1d-7e4f-8a9b-1c2d3e7f0003", cabecalho))
        .statusCode,
    ).toBe(404);
  });

  it("corpo e consulta inválidos são 400", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");

    expect((await get("/api/fornecedores?limite=0", cabecalho)).statusCode).toBe(400);
    expect((await put("/api/fornecedores/xpto", cabecalho, {})).statusCode).toBe(400);
    expect(
      (
        await put("/api/fornecedores/018f3a2b-7c1d-7e4f-8a9b-1c2d3e7f0004", cabecalho, {
          razaoSocial: "X",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("🔑 o contador enxerga, mas não altera nada", async () => {
    // Papel de leitura: existe para o escritório de contabilidade acompanhar
    // sem poder mexer no cadastro do cliente.
    const estoquista = await comoPapel("ESTOQUISTA");
    await post("/api/fornecedores", estoquista, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      documento: CNPJ,
    });

    const contador = await comoPapel("CONTADOR", "99");

    expect((await get("/api/fornecedores", contador)).statusCode).toBe(200);
    expect(
      (await post("/api/fornecedores", contador, { razaoSocial: "X", documento: CNPJ }))
        .statusCode,
    ).toBe(403);
  });
});

describe("Sem autenticação", () => {
  it("🔑 nenhuma rota de cadastro responde sem token", async () => {
    const rotas = [
      { method: "GET" as const, url: "/api/categorias" },
      { method: "POST" as const, url: "/api/categorias" },
      { method: "GET" as const, url: "/api/clientes" },
      { method: "POST" as const, url: "/api/clientes" },
      { method: "GET" as const, url: "/api/fornecedores" },
      { method: "POST" as const, url: "/api/fornecedores" },
    ];

    for (const rota of rotas) {
      const resposta = await servidor.inject({ ...rota, payload: {} });
      expect(resposta.statusCode).toBe(401);
    }
  });
});

describe("Limite de tentativas de login", () => {
  it("🔑 o login tem rédea curta, mesmo com o limite geral folgado", async () => {
    // Cada tentativa custa um Argon2id na mesma máquina que roda o caixa: sem
    // este limite, o custo do hash vira a arma de quem varre matrículas. O
    // limite geral é outro e é generoso, porque o PDV faz uma requisição por
    // bipada — apertá-lo travaria a venda sem dificultar ataque nenhum.
    const proprio = await montarServidorDeTeste({ LIMITE_LOGIN_MINUTO: "3" });

    try {
      const respostas = await Promise.all(
        Array.from({ length: 5 }, () =>
          proprio.servidor.inject({
            method: "POST",
            url: "/api/acesso/login",
            payload: { matricula: "1", segredo: "000000", contexto: "PDV" },
          }),
        ),
      );

      expect(respostas.some((r) => r.statusCode === 429)).toBe(true);

      // O caminho operacional não é atingido pelo limite do login.
      const saude = await proprio.servidor.inject({ method: "GET", url: "/saude" });
      expect(saude.statusCode).toBeLessThan(400);
    } finally {
      await proprio.servidor.close();
      await proprio.container.encerrar();
    }
  });
});

describe("Recusas na alteração", () => {
  it("corpo inválido com id válido é 400", async () => {
    const cabecalho = await comoPapel("GERENTE");

    const categoria = await post("/api/categorias", cabecalho, { nome: "Bebidas" });
    const idCategoria = categoria.json<{ id: string }>().id;

    expect(
      (await put(`/api/categorias/${idCategoria}`, cabecalho, { ativa: true }))
        .statusCode,
    ).toBe(400);

    const cliente = await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
    });
    const idCliente = cliente.json<{ id: string }>().id;

    expect(
      (await put(`/api/clientes/${idCliente}`, cabecalho, { nome: "Ana" })).statusCode,
    ).toBe(400);
  });

  it("🔑 alterar para um documento que já é de outro cadastro é recusado", async () => {
    // Sem isto, dois cadastros passariam a apontar para o mesmo CPF e o
    // histórico de compra ficaria dividido — o defeito que a rota por documento
    // existe para evitar.
    const cabecalho = await comoPapel("GERENTE");

    await post("/api/clientes", cabecalho, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
      documento: CPF,
    });

    const outro = await post("/api/clientes", cabecalho, {
      nome: "Bruno Alves",
      tipoPessoa: "FISICA",
    });

    const conflito = await put(
      `/api/clientes/${outro.json<{ id: string }>().id}`,
      cabecalho,
      { nome: "Bruno Alves", documento: CPF, ativo: true },
    );

    expect(conflito.statusCode).toBeGreaterThanOrEqual(400);
    expect(conflito.statusCode).toBeLessThan(500);
  });

  it("mesma recusa vale para o fornecedor", async () => {
    const cabecalho = await comoPapel("ESTOQUISTA");

    await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      documento: CNPJ,
    });

    const outro = await post("/api/fornecedores", cabecalho, {
      razaoSocial: "Outra Distribuidora Ltda",
      documento: "11444777000161",
    });

    const conflito = await put(
      `/api/fornecedores/${outro.json<{ id: string }>().id}`,
      cabecalho,
      { razaoSocial: "Outra Distribuidora Ltda", documento: CNPJ, ativo: true },
    );

    expect(conflito.statusCode).toBeGreaterThanOrEqual(400);
    expect(conflito.statusCode).toBeLessThan(500);
  });

  it("🔑 o supervisor edita o cliente, mas não mexe no limite de crédito", async () => {
    // Ele tem `cliente:editar` e não tem `cliente:definir_limite`: pode
    // corrigir um telefone errado sem poder se autorizar a vender a prazo.
    const gerente = await comoPapel("GERENTE");
    const criado = await post("/api/clientes", gerente, {
      nome: "Ana Maria de Souza",
      tipoPessoa: "FISICA",
    });
    const { id } = criado.json<{ id: string }>();

    const supervisor = await comoPapel("SUPERVISOR", "42");

    const semLimite = await put(`/api/clientes/${id}`, supervisor, {
      nome: "Ana Maria de Souza",
      telefone: "19998887766",
      ativo: true,
    });
    expect(semLimite.statusCode).toBe(200);

    const comLimite = await put(`/api/clientes/${id}`, supervisor, {
      nome: "Ana Maria de Souza",
      limiteCredito: "50000",
      ativo: true,
    });
    expect(comLimite.statusCode).toBe(403);
  });

  it("inscrição estadual vai e volta em cliente jurídico e em fornecedor", async () => {
    const cabecalho = await comoPapel("GERENTE");

    const empresa = await post("/api/clientes", cabecalho, {
      nome: "Padaria do Bairro Ltda",
      tipoPessoa: "JURIDICA",
      documento: CNPJ,
      inscricaoEstadual: "ISENTO",
    });
    expect(empresa.json<{ inscricaoEstadual: string }>().inscricaoEstadual).toBe(
      "ISENTO",
    );

    const estoquista = await comoPapel("ESTOQUISTA", "43");
    const distribuidora = await post("/api/fornecedores", estoquista, {
      razaoSocial: "Distribuidora Bebidas Boas Ltda",
      documento: "11444777000161",
      inscricaoEstadual: "123456789012",
    });
    expect(distribuidora.json<{ inscricaoEstadual: string }>().inscricaoEstadual).toBe(
      "123456789012",
    );
  });
});
