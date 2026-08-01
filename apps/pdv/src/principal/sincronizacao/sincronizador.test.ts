import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilaDeVendas, type VendaPendente } from "../armazenamento-local/filaDeVendas.js";
import {
  type EnvioDeVendas,
  LIMITE_CRITICO_MS,
  type ResultadoEnvio,
  Sincronizador,
} from "./sincronizador.js";

let fila: FilaDeVendas;
let relogio: Date;

beforeEach(() => {
  fila = new FilaDeVendas(join(mkdtempSync(join(tmpdir(), "sinc-")), "vendas.ndjson"));
  relogio = new Date("2026-07-31T14:00:00.000Z");
});

function venda(id: string): VendaPendente {
  return {
    id,
    estacaoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
    operadorId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002",
    registradaEm: "2026-07-31T13:59:00.000Z",
    itens: [{ codigo: "7891000315507" }],
    pagamentos: [{ forma: "DINHEIRO", valor: "990" }],
    total: "990",
  };
}

function montar(respostas: ResultadoEnvio[] | ((v: VendaPendente) => ResultadoEnvio)) {
  const enviadas: VendaPendente[] = [];
  let indice = 0;

  const envio: EnvioDeVendas = {
    enviar(v) {
      enviadas.push(v);
      const resposta =
        typeof respostas === "function"
          ? respostas(v)
          : (respostas[indice++] ?? { tipo: "ACEITA" as const });
      return Promise.resolve(resposta);
    },
  };

  const registrar = vi.fn();

  return {
    enviadas,
    registrar,
    sincronizador: new Sincronizador({
      fila,
      envio,
      agora: () => relogio,
      registrar,
    }),
  };
}

describe("Fila vazia", () => {
  it("sincronizar sem pendências não faz nada", async () => {
    const { sincronizador, enviadas } = montar([]);

    expect(await sincronizador.sincronizar()).toEqual({
      enviadas: 0,
      recusadas: 0,
      interrompida: false,
    });
    expect(enviadas).toHaveLength(0);
  });
});

describe("Envio bem-sucedido", () => {
  it("envia todas e esvazia a fila", async () => {
    for (const id of ["v1", "v2", "v3"]) fila.enfileirar(venda(id));

    const { sincronizador } = montar([]);
    const resumo = await sincronizador.sincronizar();

    expect(resumo.enviadas).toBe(3);
    expect(fila.quantidadePendente()).toBe(0);
  });

  it("🔑 envia na ordem em que as vendas aconteceram", async () => {
    // Fora de ordem, o relatório do dia não bate com a fita do caixa.
    for (const id of ["v1", "v2", "v3"]) fila.enfileirar(venda(id));

    const { sincronizador, enviadas } = montar([]);
    await sincronizador.sincronizar();

    expect(enviadas.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("🔑 'já existia' vale como aceita — é o reenvio funcionando", async () => {
    // A resposta do servidor pode se perder depois de ele ter gravado. Se o
    // reenvio criasse uma segunda venda, o caixa acusaria dinheiro que não
    // existe.
    fila.enfileirar(venda("v1"));

    const { sincronizador } = montar([{ tipo: "JA_EXISTIA" }]);
    const resumo = await sincronizador.sincronizar();

    expect(resumo.enviadas).toBe(1);
    expect(fila.quantidadePendente()).toBe(0);
  });
});

describe("Servidor fora do ar", () => {
  it("🔑 para na primeira indisponibilidade, sem furar a ordem", async () => {
    // Insistir nas seguintes gastaria a rede para colher o mesmo erro, e a
    // próxima venda chegaria antes de uma que falhou.
    for (const id of ["v1", "v2", "v3"]) fila.enfileirar(venda(id));

    const { sincronizador, enviadas } = montar([
      { tipo: "ACEITA" },
      { tipo: "INDISPONIVEL", motivo: "ECONNREFUSED" },
    ]);

    const resumo = await sincronizador.sincronizar();

    expect(resumo).toMatchObject({ enviadas: 1, interrompida: true });
    expect(enviadas.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(fila.ler().pendentes.map((v) => v.id)).toEqual(["v2", "v3"]);
  });

  it("🔑 o recuo dobra a cada falha, com teto", async () => {
    // Sem teto, a estação demoraria horas para tentar de novo depois de uma
    // noite offline. Sem recuo, martelaria a rede pela qual o outro caixa está
    // tentando vender.
    fila.enfileirar(venda("v1"));

    const { sincronizador } = montar(() => ({
      tipo: "INDISPONIVEL",
      motivo: "sem rede",
    }));

    expect(sincronizador.proximaTentativaEmMs).toBe(1000);

    await sincronizador.sincronizar();
    expect(sincronizador.proximaTentativaEmMs).toBe(2000);

    await sincronizador.sincronizar();
    expect(sincronizador.proximaTentativaEmMs).toBe(4000);

    for (let i = 0; i < 20; i += 1) await sincronizador.sincronizar();
    expect(sincronizador.proximaTentativaEmMs).toBe(60_000);
  });

  it("o recuo volta ao início quando o servidor responde", async () => {
    fila.enfileirar(venda("v1"));

    let disponivel = false;
    const { sincronizador } = montar(() =>
      disponivel ? { tipo: "ACEITA" } : { tipo: "INDISPONIVEL", motivo: "x" },
    );

    await sincronizador.sincronizar();
    await sincronizador.sincronizar();
    expect(sincronizador.proximaTentativaEmMs).toBeGreaterThan(1000);

    disponivel = true;
    await sincronizador.sincronizar();

    expect(sincronizador.proximaTentativaEmMs).toBe(1000);
  });
});

describe("Venda recusada por regra", () => {
  it("🔑 sai da fila — insistir não resolveria e a fila nunca esvaziaria", async () => {
    fila.enfileirar(venda("v1"));
    fila.enfileirar(venda("v2"));

    const { sincronizador, registrar } = montar([
      { tipo: "RECUSADA", motivo: "Caixa já fechado" },
      { tipo: "ACEITA" },
    ]);

    const resumo = await sincronizador.sincronizar();

    expect(resumo).toMatchObject({ enviadas: 1, recusadas: 1, interrompida: false });
    expect(fila.quantidadePendente()).toBe(0);
    // A recusa fica registrada para o gerente resolver.
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("Caixa já fechado"));
  });
});

describe("Estado que o operador vê", () => {
  it("conectado enquanto tudo vai bem", async () => {
    const { sincronizador } = montar([]);

    expect(sincronizador.estado()).toEqual({ tipo: "CONECTADO", pendentes: 0 });

    fila.enfileirar(venda("v1"));
    await sincronizador.sincronizar();

    expect(sincronizador.estado()).toEqual({ tipo: "CONECTADO", pendentes: 0 });
  });

  it("🔑 offline mostra quantas vendas estão esperando", async () => {
    // O operador precisa saber o estado sem entender de tecnologia (§12.4).
    for (const id of ["v1", "v2"]) fila.enfileirar(venda(id));

    const { sincronizador } = montar(() => ({
      tipo: "INDISPONIVEL",
      motivo: "sem rede",
    }));

    await sincronizador.sincronizar();

    expect(sincronizador.estado()).toEqual({ tipo: "OFFLINE", pendentes: 2 });
  });

  it("🔑 passadas quatro horas, vira alerta para o gerente", async () => {
    // Deixa de ser problema do caixa e passa a ser de quem responde pela loja.
    fila.enfileirar(venda("v1"));

    const { sincronizador } = montar(() => ({
      tipo: "INDISPONIVEL",
      motivo: "sem rede",
    }));

    await sincronizador.sincronizar();
    expect(sincronizador.estado().tipo).toBe("OFFLINE");

    relogio = new Date(relogio.getTime() + LIMITE_CRITICO_MS);
    await sincronizador.sincronizar();

    const estado = sincronizador.estado();
    expect(estado.tipo).toBe("OFFLINE_CRITICO");
    if (estado.tipo === "OFFLINE_CRITICO") {
      expect(estado.pendentes).toBe(1);
      expect(estado.desdeMs).toBeGreaterThanOrEqual(LIMITE_CRITICO_MS);
    }
  });

  it("volta a conectado assim que o servidor responde", async () => {
    fila.enfileirar(venda("v1"));

    let disponivel = false;
    const { sincronizador } = montar(() =>
      disponivel ? { tipo: "ACEITA" } : { tipo: "INDISPONIVEL", motivo: "x" },
    );

    await sincronizador.sincronizar();
    expect(sincronizador.estado().tipo).toBe("OFFLINE");

    disponivel = true;
    await sincronizador.sincronizar();

    expect(sincronizador.estado()).toEqual({ tipo: "CONECTADO", pendentes: 0 });
  });
});

describe("Sem relógio nem log injetados", () => {
  it("funciona com os padrões — é como o processo principal o constrói", async () => {
    // O `main.ts` não passa relógio nem registrador: usa o relógio do sistema e
    // engole o log. Se os padrões quebrassem, o defeito só apareceria na loja.
    fila.enfileirar(venda("v1"));

    const sincronizador = new Sincronizador({
      fila,
      envio: { enviar: () => Promise.resolve({ tipo: "ACEITA" as const }) },
    });

    expect(await sincronizador.sincronizar()).toMatchObject({ enviadas: 1 });
    expect(sincronizador.estado()).toEqual({ tipo: "CONECTADO", pendentes: 0 });
  });

  it("o registrador padrão não estoura ao receber uma falha", async () => {
    fila.enfileirar(venda("v1"));

    const sincronizador = new Sincronizador({
      fila,
      envio: {
        enviar: () =>
          Promise.resolve({ tipo: "INDISPONIVEL" as const, motivo: "sem rede" }),
      },
    });

    await sincronizador.sincronizar();

    expect(sincronizador.estado().tipo).toBe("OFFLINE");
  });
});
