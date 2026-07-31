import { TENTATIVAS_ATE_BLOQUEIO } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarProduto,
  cadastrarUsuario,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
} from "./apoio.js";

let servidor: FastifyInstance;
let container: Container;

const PIN_OPERADOR = "419273";
const PIN_GERENTE = "573914";
const SENHA_GERENTE = "cavalo bateria grampo correto";

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

  await cadastrarUsuario(container, {
    matricula: "42",
    nome: "Maria da Silva",
    papel: "OPERADOR_CAIXA",
    pin: PIN_OPERADOR,
  });

  await cadastrarUsuario(container, {
    matricula: "1",
    nome: "Ana Gerente",
    papel: "GERENTE",
    pin: PIN_GERENTE,
    senha: SENHA_GERENTE,
  });
});

describe("Login", () => {
  it("🔑 entra com matrícula e PIN, devolvendo token e permissões", async () => {
    const { token, corpo } = await logar(servidor, "42", PIN_OPERADOR);

    expect(token).not.toBe("");

    const usuario = corpo["usuario"] as Record<string, unknown>;
    expect(usuario["nome"]).toBe("Maria da Silva");
    expect(usuario["papel"]).toBe("OPERADOR_CAIXA");
    expect(usuario["permissoes"]).toContain("venda:criar");
    expect(usuario["permissoes"]).not.toContain("caixa:sangria");
  });

  it("🔑 o refresh vai em cookie httpOnly, nunca no corpo", async () => {
    // Refresh acessível por JavaScript é refresh que qualquer XSS leva embora.
    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/acesso/login",
      payload: {
        matricula: "42",
        segredo: PIN_OPERADOR,
        contexto: "PDV",
        dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
      },
    });

    const refresh = resposta.cookies.find((c) => c.name === "erp_refresh");

    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.sameSite).toBe("Strict");
    expect(JSON.stringify(resposta.json())).not.toContain(String(refresh?.value));
  });

  it("🔑 responde 401 igual para matrícula inexistente e PIN errado", async () => {
    const inexistente = await servidor.inject({
      method: "POST",
      url: "/api/acesso/login",
      payload: {
        matricula: "999",
        segredo: PIN_OPERADOR,
        contexto: "PDV",
        dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
      },
    });

    const errado = await servidor.inject({
      method: "POST",
      url: "/api/acesso/login",
      payload: {
        matricula: "42",
        segredo: "000111",
        contexto: "PDV",
        dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
      },
    });

    expect(inexistente.statusCode).toBe(401);
    expect(errado.statusCode).toBe(401);
    expect(inexistente.json()).toEqual(errado.json());
  });

  it("o gerente entra na retaguarda com senha", async () => {
    const { token } = await logar(servidor, "1", SENHA_GERENTE, "RETAGUARDA");

    expect(token).not.toBe("");
  });

  it("recusa PIN do balcão como senha da retaguarda", async () => {
    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/acesso/login",
      payload: {
        matricula: "42",
        segredo: PIN_OPERADOR,
        contexto: "RETAGUARDA",
        dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
      },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it.each([
    ["corpo vazio", {}],
    ["sem contexto", { matricula: "42", segredo: PIN_OPERADOR }],
    [
      "dispositivo não-UUID",
      { matricula: "42", segredo: PIN_OPERADOR, contexto: "PDV", dispositivoId: "x" },
    ],
  ])("recusa requisição com %s", async (_descricao, payload) => {
    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/acesso/login",
      payload,
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "REQUISICAO_INVALIDA" } });
  });

  it("🔑 bloqueio devolve 429 e diz quanto falta", async () => {
    for (let i = 0; i < TENTATIVAS_ATE_BLOQUEIO; i += 1) {
      await servidor.inject({
        method: "POST",
        url: "/api/acesso/login",
        payload: {
          matricula: "42",
          segredo: "000111",
          contexto: "PDV",
          dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
        },
      });
    }

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/acesso/login",
      payload: {
        matricula: "42",
        segredo: PIN_OPERADOR,
        contexto: "PDV",
        dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
      },
    });

    // 429, não 401: é limitação de tentativa, e o cliente pode voltar depois.
    expect(resposta.statusCode).toBe(429);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "USUARIO_BLOQUEADO" } });
  });
});

describe("Renovação e saída", () => {
  it("🔑 renova a sessão e emite um refresh novo", async () => {
    const inicial = await logar(servidor, "42", PIN_OPERADOR);

    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/acesso/renovar",
      headers: { cookie: inicial.cookies },
    });

    expect(resposta.statusCode).toBe(200);

    const novoRefresh = resposta.cookies.find((c) => c.name === "erp_refresh");
    expect(novoRefresh?.value).not.toBe("");
    expect(inicial.cookies).not.toContain(String(novoRefresh?.value));
  });

  it("🔑 reúso do refresh antigo derruba a família e devolve 401", async () => {
    const inicial = await logar(servidor, "42", PIN_OPERADOR);

    const primeira = await servidor.inject({
      method: "POST",
      url: "/api/acesso/renovar",
      headers: { cookie: inicial.cookies },
    });
    expect(primeira.statusCode).toBe(200);

    const reuso = await servidor.inject({
      method: "POST",
      url: "/api/acesso/renovar",
      headers: { cookie: inicial.cookies },
    });

    expect(reuso.statusCode).toBe(401);
    expect(reuso.json()).toMatchObject({ erro: { codigo: "SESSAO_REUSO_DETECTADO" } });

    // A sessão nova, que o ladrão poderia estar usando, também caiu.
    const cookiesNovos = primeira.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const depois = await servidor.inject({
      method: "POST",
      url: "/api/acesso/renovar",
      headers: { cookie: cookiesNovos },
    });

    expect(depois.statusCode).toBe(401);
  });

  it("recusa renovar sem cookie", async () => {
    const resposta = await servidor.inject({
      method: "POST",
      url: "/api/acesso/renovar",
    });

    expect(resposta.statusCode).toBe(401);
  });

  it("sair encerra a sessão e o refresh deixa de valer", async () => {
    const inicial = await logar(servidor, "42", PIN_OPERADOR);

    const saida = await servidor.inject({
      method: "POST",
      url: "/api/acesso/sair",
      headers: { authorization: `Bearer ${inicial.token}` },
    });

    expect(saida.statusCode).toBe(204);

    const renovar = await servidor.inject({
      method: "POST",
      url: "/api/acesso/renovar",
      headers: { cookie: inicial.cookies },
    });

    expect(renovar.statusCode).toBe(401);
  });
});

describe("Rota protegida", () => {
  it("responde quem sou eu com as permissões vindas do banco", async () => {
    const { token } = await logar(servidor, "42", PIN_OPERADOR);

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/acesso/eu",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      matricula: "42",
      papel: "OPERADOR_CAIXA",
    });
  });

  it.each([
    ["sem cabeçalho", undefined, "TOKEN_AUSENTE"],
    ["com esquema errado", "Basic abc", "TOKEN_AUSENTE"],
    ["com token forjado", "Bearer nao.e.um.token", "TOKEN_INVALIDO"],
  ])("recusa acesso %s", async (_descricao, authorization, codigo) => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/acesso/eu",
      ...(authorization === undefined ? {} : { headers: { authorization } }),
    });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json()).toMatchObject({ erro: { codigo } });
  });

  it("🔑 token assinado com outro segredo não passa", async () => {
    // O que impede alguém de forjar o próprio token de ADMIN.
    const { token } = await logar(servidor, "42", PIN_OPERADOR);
    const adulterado = `${token.slice(0, -4)}AAAA`;

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/acesso/eu",
      headers: { authorization: `Bearer ${adulterado}` },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it("🔑 usuário desativado perde o acesso mesmo com token ainda válido", async () => {
    const { token } = await logar(servidor, "42", PIN_OPERADOR);

    await container.prisma.usuario.update({
      where: { matricula: "42" },
      data: { ativo: false },
    });

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/acesso/eu",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.statusCode).toBe(401);
  });
});

describe("Autorização por permissão", () => {
  it("🔑 o operador consulta produto; a permissão é decidida no servidor", async () => {
    await cadastrarProduto(container);
    const { token } = await logar(servidor, "42", PIN_OPERADOR);

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar?codigo=7891000315507",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ sku: "REF001", precoVenda: "990" });
  });

  it("🔑 o operador NÃO recebe o custo — nem escondido no JSON", async () => {
    // Esconder só na interface seria acordo de cavalheiros: quem abrisse a aba
    // de rede veria a margem da loja inteira.
    await cadastrarProduto(container);
    const { token } = await logar(servidor, "42", PIN_OPERADOR);

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar?codigo=REF001",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.json()).not.toHaveProperty("custo");
  });

  it("o gerente recebe o custo", async () => {
    await cadastrarProduto(container);
    const { token } = await logar(servidor, "1", PIN_GERENTE);

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar?codigo=REF001",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.json()).toMatchObject({ custo: "650" });
  });

  it("devolve 404 para código inexistente, sem vazar detalhe", async () => {
    const { token } = await logar(servidor, "42", PIN_OPERADOR);

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar?codigo=0000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "PRODUTO_NAO_ENCONTRADO" } });
  });

  it("🔑 quem não tem a permissão recebe 403, mesmo autenticado", async () => {
    // A rota exige `venda:criar`; o estoquista não vende. É o teste de que a
    // decisão acontece no servidor, e não na tela que esconde o botão.
    await cadastrarProduto(container);
    await cadastrarUsuario(container, {
      matricula: "9",
      nome: "Carlos Estoque",
      papel: "ESTOQUISTA",
      pin: "284617",
    });

    const { token } = await logar(servidor, "9", "284617");

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar?codigo=REF001",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "OPERACAO_NEGADA" } });
  });

  it("recusa consulta sem o parâmetro obrigatório", async () => {
    const { token } = await logar(servidor, "42", PIN_OPERADOR);

    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/produtos/buscar",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.statusCode).toBe(400);
  });
});

describe("Saúde", () => {
  it("responde vivo sem tocar no banco", async () => {
    const resposta = await servidor.inject({ method: "GET", url: "/saude" });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ estado: "ok" });
  });

  it("responde pronto quando o banco atende", async () => {
    const resposta = await servidor.inject({ method: "GET", url: "/saude/pronto" });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ estado: "pronto", banco: "ok" });
  });
});

describe("Erros nunca vazam detalhe técnico", () => {
  it("🔑 nenhuma resposta de erro contém stack trace ou nome de coluna", async () => {
    const respostas = await Promise.all([
      servidor.inject({ method: "GET", url: "/api/acesso/eu" }),
      servidor.inject({ method: "POST", url: "/api/acesso/login", payload: {} }),
      servidor.inject({ method: "GET", url: "/rota/que/nao/existe" }),
    ]);

    for (const resposta of respostas) {
      const texto = resposta.body;
      expect(texto).not.toContain("at ");
      expect(texto).not.toContain("prisma");
      expect(texto).not.toContain("PrismaClient");
      expect(texto).not.toContain("hash_pin");
    }
  });
});
