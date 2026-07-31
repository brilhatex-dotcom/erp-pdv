import { zRespostaProntidao, zRespostaSaude } from "@erp/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  criarAmbienteFalso,
  criarContainerFalso,
  RelogioFixo,
} from "../../testes/dubles.js";
import { criarServidor } from "../servidor.js";

const INSTANTE = new Date("2026-07-31T14:05:09.000Z");

let servidor: FastifyInstance | undefined;

afterEach(async () => {
  await servidor?.close();
  servidor = undefined;
});

async function levantar(
  container = criarContainerFalso({ relogio: new RelogioFixo(INSTANTE) }),
): Promise<FastifyInstance> {
  servidor = await criarServidor({
    ambiente: criarAmbienteFalso(),
    container,
    versao: "1.2.3",
    tempoNoArSegundos: () => 12.5,
  });

  return servidor;
}

describe("GET /saude", () => {
  it("responde 200 no formato do contrato", async () => {
    const app = await levantar();

    const resposta = await app.inject({ method: "GET", url: "/saude" });

    expect(resposta.statusCode).toBe(200);
    expect(zRespostaSaude.parse(resposta.json())).toEqual({
      status: "ok",
      versao: "1.2.3",
      agora: INSTANTE.toISOString(),
      tempoNoArSegundos: 12.5,
    });
  });

  it("responde 200 mesmo com o banco fora", async () => {
    // Se dependesse do banco, uma indisponibilidade momentânea faria o
    // supervisor de serviço reiniciar a aplicação — trocando um problema que se
    // resolve sozinho por uma parada de verdade.
    const app = await levantar(
      criarContainerFalso({
        relogio: new RelogioFixo(INSTANTE),
        banco: { ok: false, latenciaMs: 2_000 },
      }),
    );

    const resposta = await app.inject({ method: "GET", url: "/saude" });

    expect(resposta.statusCode).toBe(200);
  });

  it("expõe a hora do servidor, para detectar relógio errado na estação", async () => {
    const app = await levantar();

    const { agora } = zRespostaSaude.parse(
      (await app.inject({ method: "GET", url: "/saude" })).json(),
    );

    expect(new Date(agora).getTime()).toBe(INSTANTE.getTime());
  });

  it("não revela nada além de versão, hora e tempo no ar", async () => {
    const app = await levantar();

    const corpo = (await app.inject({ method: "GET", url: "/saude" })).json();

    expect(Object.keys(corpo as object).sort()).toEqual([
      "agora",
      "status",
      "tempoNoArSegundos",
      "versao",
    ]);
  });
});

describe("GET /pronto", () => {
  it("responde 200 quando o banco responde", async () => {
    const app = await levantar(
      criarContainerFalso({
        relogio: new RelogioFixo(INSTANTE),
        banco: { ok: true, latenciaMs: 3 },
      }),
    );

    const resposta = await app.inject({ method: "GET", url: "/pronto" });

    expect(resposta.statusCode).toBe(200);
    expect(zRespostaProntidao.parse(resposta.json())).toEqual({
      pronto: true,
      verificacoes: { banco: { ok: true, latenciaMs: 3 } },
    });
  });

  it("responde 503 quando o banco não responde", async () => {
    // O status é o que importa: é por ele que o instalador decide se terminou, o
    // atualizador se faz rollback e o PDV se entra em contingência. Devolver 200
    // com `pronto: false` faria os três acharem que está tudo bem.
    const app = await levantar(
      criarContainerFalso({
        relogio: new RelogioFixo(INSTANTE),
        banco: { ok: false, latenciaMs: 2_000 },
      }),
    );

    const resposta = await app.inject({ method: "GET", url: "/pronto" });

    expect(resposta.statusCode).toBe(503);
    expect(zRespostaProntidao.parse(resposta.json())).toEqual({
      pronto: false,
      verificacoes: { banco: { ok: false, latenciaMs: 2_000 } },
    });
  });

  it("informa a latência, porque latência crescente antecede a falha", async () => {
    const app = await levantar(
      criarContainerFalso({
        relogio: new RelogioFixo(INSTANTE),
        banco: { ok: true, latenciaMs: 480 },
      }),
    );

    const corpo = zRespostaProntidao.parse(
      (await app.inject({ method: "GET", url: "/pronto" })).json(),
    );

    expect(corpo.verificacoes.banco.latenciaMs).toBe(480);
  });
});
