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

/**
 * A rota que alimenta a réplica da estação.
 *
 * Dois riscos aqui, e nenhum deles é de desempenho: a resposta é a **tabela de
 * preços inteira da loja**, e ela vai parar no disco de uma máquina de balcão.
 */

let servidor: FastifyInstance;
let container: Container;
let cabecalho: { authorization: string };

const PIN = "419273";

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
  await cadastrarProduto(container);
  await cadastrarUsuario(container, {
    matricula: "1",
    nome: "Ana Gerente",
    papel: "GERENTE",
    pin: PIN,
  });
  cabecalho = { authorization: `Bearer ${(await logar(servidor, "1", PIN)).token}` };
});

function baixar(headers: Record<string, string> = cabecalho) {
  return servidor.inject({ method: "GET", url: "/api/catalogo/replica", headers });
}

describe("GET /api/catalogo/replica", () => {
  it("🔑 exige autenticação", async () => {
    // Sem isto, bastaria estar na rede da loja para baixar a tabela de preços
    // completa de um concorrente.
    const resposta = await baixar({});

    expect(resposta.statusCode).toBe(401);
  });

  it("devolve o catálogo no formato que a réplica grava", async () => {
    const resposta = await baixar();

    expect(resposta.statusCode).toBe(200);

    const corpo = resposta.json<{
      atualizadoEm: string;
      produtos: Record<string, unknown>[];
    }>();

    expect(corpo.atualizadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(corpo.produtos).toHaveLength(1);
    expect(corpo.produtos[0]).toMatchObject({
      sku: "REF001",
      descricaoPdv: "REFRI COLA 2L",
      unidade: "UN",
      codigoBarras: "7891000315507",
      ativo: true,
    });
  });

  it("🔑 dinheiro vai como texto, nunca como número", async () => {
    // `JSON.parse` transforma número em `double`, e o centavo some no
    // fechamento do caixa (ADR-0019).
    const corpo = resposta();
    const produtos = (await corpo).produtos;

    expect(produtos[0]?.["precoVenda"]).toBe("990");
    expect(typeof produtos[0]?.["precoVenda"]).toBe("string");
  });

  it("🔑 não expõe o custo do produto", async () => {
    // Margem replicada em toda estação é margem exposta a quem abrir o arquivo
    // no disco da máquina de balcão.
    const { produtos } = await resposta();

    expect(produtos[0]).not.toHaveProperty("custo");
    expect(JSON.stringify(produtos)).not.toContain("650");
  });

  it("não manda produto inativo pela rede da loja", async () => {
    // Em loja com histórico longo, o inativo é a maior parte do cadastro.
    const produto = await container.leitura.produtos.porCodigo("REF001");
    expect(produto).toBeDefined();
    if (produto === undefined) return;

    produto.desativar(container.relogio.agora());
    await container.leitura.produtos.salvar(produto);

    const { produtos } = await resposta();

    expect(produtos).toHaveLength(0);
  });
});

async function resposta(): Promise<{ produtos: Record<string, unknown>[] }> {
  return (await baixar()).json<{ produtos: Record<string, unknown>[] }>();
}
