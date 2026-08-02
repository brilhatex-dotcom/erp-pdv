import { describe, expect, it, vi } from "vitest";

import {
  ESPACO_MINIMO_BYTES,
  espacoSuficiente,
  esperarServidor,
  portaLivre,
  type ResultadoDaVerificacao,
  resumir,
} from "./verificacao.js";

/**
 * A verificação que roda depois de instalar.
 *
 * O pior resultado possível de um instalador é terminar com "concluído" e
 * deixar um sistema que não sobe: o lojista acredita que está pronto, descobre
 * no dia seguinte com a loja cheia, e o suporte começa sem saber o que foi
 * feito.
 */

function relogioFalso(inicio = 0) {
  let agora = inicio;

  return {
    agora: () => agora,
    esperar: (ms: number) => {
      agora += ms;
      return Promise.resolve();
    },
  };
}

describe("espera pelo servidor", () => {
  it("aceita assim que responder", async () => {
    const buscar = vi.fn(() => Promise.resolve({ ok: true }));

    const resultado = await esperarServidor("http://localhost:3000/saude", {
      buscar,
      ...relogioFalso(),
    });

    expect(resultado.tipo).toBe("OK");
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("🔑 insiste enquanto a conexão é recusada — o start não é instantâneo", async () => {
    // Numa máquina de 4 GB com antivírus varrendo o instalador recém-escrito, o
    // primeiro start demora. Desistir na primeira tentativa produziria "falhou"
    // num sistema que subiria dois segundos depois.
    let tentativas = 0;

    const buscar = vi.fn(() => {
      tentativas += 1;

      if (tentativas < 4) return Promise.reject(new Error("ECONNREFUSED"));

      return Promise.resolve({ ok: true });
    });

    const resultado = await esperarServidor("http://localhost:3000/saude", {
      buscar,
      ...relogioFalso(),
    });

    expect(resultado.tipo).toBe("OK");
    expect(tentativas).toBe(4);
  });

  it("insiste também quando responde sem sucesso", async () => {
    let tentativas = 0;

    const buscar = vi.fn(() => {
      tentativas += 1;

      return Promise.resolve({ ok: tentativas >= 3 });
    });

    const resultado = await esperarServidor("http://localhost:3000/saude", {
      buscar,
      ...relogioFalso(),
    });

    expect(resultado.tipo).toBe("OK");
  });

  it("🔑 desiste com instrução do que fazer, não com erro técnico", async () => {
    // "ECONNREFUSED 127.0.0.1:3000" não diz nada a quem está instalando sozinho
    // na loja.
    const resultado = await esperarServidor(
      "http://localhost:3000/saude",
      { buscar: () => Promise.reject(new Error("ECONNREFUSED")), ...relogioFalso() },
      2_000,
    );

    expect(resultado.tipo).toBe("FALHOU");
    if (resultado.tipo !== "FALHOU") return;
    expect(resultado.comoResolver).toContain("Serviços do Windows");
    expect(resultado.comoResolver).not.toContain("ECONNREFUSED");
  });
});

describe("porta", () => {
  it("aprova porta livre", async () => {
    const resultado = await portaLivre(3000, () => Promise.resolve(true));

    expect(resultado.tipo).toBe("OK");
  });

  it("🔑 porta ocupada é descoberta antes de instalar, não depois", async () => {
    // Descobrir o conflito depois significa desinstalar, escolher outra porta e
    // repetir tudo.
    const resultado = await portaLivre(3000, () => Promise.resolve(false));

    expect(resultado.tipo).toBe("FALHOU");
    if (resultado.tipo !== "FALHOU") return;
    expect(resultado.comoResolver).toContain("3000");
    expect(resultado.comoResolver).toContain("outra porta");
  });
});

describe("espaço em disco", () => {
  it("aprova quando há folga", () => {
    const resultado = espacoSuficiente(50 * 1024 * 1024 * 1024);

    expect(resultado.tipo).toBe("OK");
    if (resultado.tipo !== "OK") return;
    expect(resultado.detalhe).toContain("GB");
  });

  it("🔑 recusa disco quase cheio, dizendo quanto falta", () => {
    // Instalar num disco cheio produz uma loja que para de vender no meio do
    // expediente, com o Postgres recusando escrita.
    const resultado = espacoSuficiente(100 * 1024 * 1024);

    expect(resultado.tipo).toBe("FALHOU");
    if (resultado.tipo !== "FALHOU") return;
    expect(resultado.comoResolver).toContain("2.0 GB");
    expect(resultado.comoResolver).toContain("0.1 GB");
  });

  it("aceita exatamente o mínimo", () => {
    expect(espacoSuficiente(ESPACO_MINIMO_BYTES).tipo).toBe("OK");
  });
});

describe("resumo", () => {
  it("tudo certo quando nada falhou", () => {
    const resultados: ResultadoDaVerificacao[] = [
      { tipo: "OK", nome: "Porta 3000" },
      { tipo: "OK", nome: "Servidor" },
    ];

    expect(resumir(resultados)).toEqual({ tudoCerto: true, problemas: [] });
  });

  it("🔑 junta todos os problemas, não só o primeiro", () => {
    // Corrigir um por execução é o instalador que ninguém termina.
    const resultados: ResultadoDaVerificacao[] = [
      { tipo: "FALHOU", nome: "Porta 3000", comoResolver: "Feche o outro programa." },
      { tipo: "OK", nome: "Servidor" },
      { tipo: "FALHOU", nome: "Espaço em disco", comoResolver: "Libere espaço." },
    ];

    const resumo = resumir(resultados);

    expect(resumo.tudoCerto).toBe(false);
    expect(resumo.problemas).toHaveLength(2);
    expect(resumo.problemas[0]).toContain("Porta 3000");
    expect(resumo.problemas[1]).toContain("Espaço em disco");
  });
});
