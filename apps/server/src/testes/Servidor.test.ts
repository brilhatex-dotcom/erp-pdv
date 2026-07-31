import { afterAll, describe, expect, it } from "vitest";

import { carregarAmbiente } from "../ambiente.js";
import { montarContainer, novoDispositivoId } from "../composicao/container.js";
import { montarServidor } from "../servidor.js";
import { urlBancoDeTeste } from "./apoio.js";

/**
 * Variações de configuração que mudam o comportamento do servidor.
 *
 * Vão aqui em vez de na suíte de acesso porque cada uma precisa de um servidor
 * montado com ambiente diferente — e o de lá é compartilhado entre os casos.
 */
function ambienteDe(extra: Record<string, string> = {}) {
  return carregarAmbiente({
    NODE_ENV: "test",
    DATABASE_URL: urlBancoDeTeste(),
    SEGREDO_TOKEN: "segredo-de-teste-com-mais-de-32-caracteres",
    ...extra,
  });
}

const encerradores: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const encerrar of encerradores) await encerrar();
});

async function servidorCom(extra: Record<string, string> = {}) {
  const container = montarContainer(ambienteDe(extra));
  const servidor = await montarServidor(container);

  encerradores.push(async () => {
    await servidor.close();
    await container.encerrar();
  });

  return { servidor, container };
}

describe("Origens permitidas", () => {
  it("🔑 sem lista configurada, recusa qualquer origem cruzada", async () => {
    // `origin: true` refletiria qualquer origem, o que anula o CORS
    // justamente onde ele protege — e os cookies vão junto.
    const { servidor } = await servidorCom();

    const resposta = await servidor.inject({
      method: "GET",
      url: "/saude",
      headers: { origin: "http://invasor.local" },
    });

    expect(resposta.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("libera exatamente a origem declarada", async () => {
    const { servidor } = await servidorCom({
      ORIGENS_PERMITIDAS: "http://localhost:5173",
    });

    const permitida = await servidor.inject({
      method: "GET",
      url: "/saude",
      headers: { origin: "http://localhost:5173" },
    });
    const outra = await servidor.inject({
      method: "GET",
      url: "/saude",
      headers: { origin: "http://invasor.local" },
    });

    expect(permitida.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(outra.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Saúde sob banco indisponível", () => {
  it("🔑 responde 503, não 500 — é indisponibilidade, e o cliente deve repetir", async () => {
    const { servidor, container } = await servidorCom();

    // Desconecta por baixo: é o que acontece quando o Postgres cai ou ainda
    // não subiu depois de um reinício da máquina da loja.
    await container.prisma.$disconnect();
    await container.prisma.$executeRawUnsafe("SELECT 1").catch(() => undefined);

    const original = container.prisma.$queryRaw.bind(container.prisma);
    Object.assign(container.prisma, {
      $queryRaw: () => Promise.reject(new Error("banco fora")),
    });

    const resposta = await servidor.inject({ method: "GET", url: "/saude/pronto" });

    Object.assign(container.prisma, { $queryRaw: original });

    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({ estado: "indisponivel", banco: "falha" });
  });

  it("🔑 /saude continua respondendo mesmo assim", async () => {
    // Confundir as duas rotas é o que faz um supervisor de processo reiniciar
    // o servidor em loop porque o Postgres demorou a subir.
    const { servidor } = await servidorCom();

    const resposta = await servidor.inject({ method: "GET", url: "/saude" });

    expect(resposta.statusCode).toBe(200);
  });
});

describe("Modo produção", () => {
  it("🔑 marca os cookies como Secure só quando é produção", () => {
    // Em desenvolvimento o servidor roda em HTTP, e o navegador descartaria um
    // cookie `Secure` silenciosamente — quebrando o login sem mensagem alguma.
    const desenvolvimento = ambienteDe();
    const producao = ambienteDe({ NODE_ENV: "production" });

    expect(desenvolvimento.ehProducao).toBe(false);
    expect(producao.ehProducao).toBe(true);
  });
});

describe("Servidor em produção", () => {
  it("sobe com a configuração de produção", async () => {
    // O nível de log e o `Secure` dos cookies mudam com o ambiente; subir o
    // servidor nesse modo garante que a diferença não quebra a montagem.
    const { servidor } = await servidorCom({ NODE_ENV: "production" });

    const resposta = await servidor.inject({ method: "GET", url: "/saude" });

    expect(resposta.statusCode).toBe(200);
  });
});

describe("Identificador de dispositivo", () => {
  it("gera um UUID diferente a cada chamada", () => {
    const a = novoDispositivoId();
    const b = novoDispositivoId();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});
