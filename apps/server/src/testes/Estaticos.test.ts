import type { FastifyInstance } from "fastify";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import { ehCaminhoDeTela } from "../http/estaticos.js";

import { montarServidorDeTeste, prepararBanco } from "./apoio.js";

/**
 * O servidor da loja entregando as telas.
 *
 * Sem isto o service worker do PDV **nunca registra**: ele exige mesma origem,
 * e enquanto a tela vinha do Vite numa porta e a API em outra, a PWA existia no
 * código e não no navegador (ADR-0023).
 *
 * As telas de mentira são escritas em disco de propósito. Simular o sistema de
 * arquivos aqui testaria o simulador — e o que pode dar errado é exatamente o
 * caminho: pasta que não existe, `index.html` que falta, prefixo trocado.
 */

let servidor: FastifyInstance;
let container: Container;
let pasta: string;

function escrever(caminho: string, conteudo: string): void {
  mkdirSync(join(pasta, caminho, ".."), { recursive: true });
  writeFileSync(join(pasta, caminho), conteudo);
}

beforeAll(async () => {
  prepararBanco();

  pasta = mkdtempSync(join(tmpdir(), "erp-telas-"));

  mkdirSync(join(pasta, "pdv/assets"), { recursive: true });
  mkdirSync(join(pasta, "web/assets"), { recursive: true });

  escrever("pdv/index.html", "<html><body>PDV</body></html>");
  escrever("pdv/sw.js", "// service worker");
  escrever("pdv/manifest.webmanifest", '{"name":"PDV"}');
  escrever("pdv/assets/principal-a1b2c3d4.js", "console.log('pdv')");
  escrever("web/index.html", "<html><body>RETAGUARDA</body></html>");

  const montado = await montarServidorDeTeste({
    PASTA_PDV: join(pasta, "pdv"),
    PASTA_RETAGUARDA: join(pasta, "web"),
  });

  servidor = montado.servidor;
  container = montado.container;
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
  rmSync(pasta, { recursive: true, force: true });
});

function get(url: string) {
  return servidor.inject({ method: "GET", url });
}

describe("entrega das telas", () => {
  it("🔑 o PDV fica na raiz — é o que a casca de quiosque abre", async () => {
    const resposta = await get("/");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("PDV");
  });

  it("a retaguarda fica no próprio prefixo", async () => {
    const resposta = await get("/retaguarda/");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("RETAGUARDA");
  });

  it("🔑 o service worker é servido na raiz, que é onde ele precisa estar", async () => {
    // Service worker registrado em `/sw.js` controla o site inteiro. Servido de
    // uma subpasta, o escopo dele encolheria e o cache não valeria para a tela.
    const resposta = await get("/sw.js");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("service worker");
  });

  it("o manifesto é servido, senão não há o que instalar", async () => {
    expect((await get("/manifest.webmanifest")).statusCode).toBe(200);
  });
});

describe("cache", () => {
  it("🔑 o service worker nunca é cacheado pelo navegador", async () => {
    // É ele que decide o que fica em cache. Uma versão velha presa no cache do
    // navegador congelaria a estação numa versão antiga do sistema — e no
    // balcão ninguém vai limpar navegador.
    const resposta = await get("/sw.js");

    expect(resposta.headers["cache-control"]).toBe("no-cache");
  });

  it("🔑 arquivo com hash no nome é cacheado por um ano", async () => {
    // O conteúdo não muda, por construção. Revalidar a cada abertura gastaria a
    // rede da loja sem ganho nenhum.
    const resposta = await get("/assets/principal-a1b2c3d4.js");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("arquivo sem hash não é cacheado", async () => {
    expect((await get("/manifest.webmanifest")).headers["cache-control"]).toBe(
      "no-cache",
    );
  });
});

describe("página única", () => {
  it("🔑 recarregar uma tela interna devolve a aplicação, não 404", async () => {
    // O caminho é interpretado pelo JavaScript, não pelo servidor. Sem isto, o
    // operador que aperta F5 no meio de uma venda cai em "não encontrado".
    const resposta = await get("/venda");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("PDV");
  });

  it("recarregar na retaguarda devolve a retaguarda, não o PDV", async () => {
    const resposta = await get("/retaguarda/financeiro");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("RETAGUARDA");
  });

  it("🔑 rota de API inexistente devolve JSON, não HTML", async () => {
    // Devolver a aplicação aqui faria o cliente receber HTML onde espera JSON,
    // e o erro chegaria como falha de sintaxe em vez de "não encontrado".
    const resposta = await get("/api/inexistente");

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "NAO_ENCONTRADO" } });
  });

  it("método que não é GET não recebe a tela", async () => {
    const resposta = await servidor.inject({ method: "POST", url: "/qualquer-coisa" });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "NAO_ENCONTRADO" } });
  });
});

describe("quando o build não existe", () => {
  it("🔑 pasta ausente não derruba o servidor — a API continua de pé", async () => {
    // Em desenvolvimento o `dist/` pode não ter sido construído, e é o Vite que
    // serve. Registrar um diretório inexistente derrubaria o servidor na subida,
    // tirando também a API — e o sintoma seria "nada funciona" para quem só
    // esqueceu de rodar o build.
    const semTelas = await montarServidorDeTeste({
      PASTA_PDV: join(pasta, "nao-existe"),
      PASTA_RETAGUARDA: join(pasta, "tambem-nao"),
    });

    try {
      const saude = await semTelas.servidor.inject({ method: "GET", url: "/saude" });
      expect(saude.statusCode).toBe(200);

      // Sem telas, a raiz devolve o 404 padrão do Fastify — não uma exceção.
      const raiz = await semTelas.servidor.inject({ method: "GET", url: "/" });
      expect(raiz.statusCode).toBe(404);
    } finally {
      await semTelas.servidor.close();
      await semTelas.container.encerrar();
    }
  });

  it("só a retaguarda construída ainda serve a retaguarda", async () => {
    const soRetaguarda = await montarServidorDeTeste({
      PASTA_PDV: join(pasta, "nao-existe"),
      PASTA_RETAGUARDA: join(pasta, "web"),
    });

    try {
      const resposta = await soRetaguarda.servidor.inject({
        method: "GET",
        url: "/retaguarda/",
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.body).toContain("RETAGUARDA");
    } finally {
      await soRetaguarda.servidor.close();
      await soRetaguarda.container.encerrar();
    }
  });
});

describe("classificação de caminho", () => {
  it("separa tela de API", () => {
    expect(ehCaminhoDeTela("/")).toBe(true);
    expect(ehCaminhoDeTela("/venda")).toBe(true);
    expect(ehCaminhoDeTela("/retaguarda/produtos")).toBe(true);

    expect(ehCaminhoDeTela("/api/produtos")).toBe(false);
    expect(ehCaminhoDeTela("/saude")).toBe(false);
  });
});
