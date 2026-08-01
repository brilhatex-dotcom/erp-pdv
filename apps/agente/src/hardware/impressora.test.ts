import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  impressoraDeArquivo,
  impressoraDeRede,
  impressoraNula,
  montarImpressora,
} from "./impressora.js";

const BYTES = Uint8Array.from([0x1b, 0x40, 0x4f, 0x49]);

let servidores: Server[] = [];
let conexoes: Socket[] = [];

afterEach(async () => {
  // As conexões são derrubadas na mão: `close` sozinho espera as abertas
  // terminarem, e o teste da impressora travada deixa uma de propósito.
  for (const socket of conexoes) socket.destroy();
  conexoes = [];

  await Promise.all(
    servidores.map(
      (s) =>
        new Promise<void>((pronto) => {
          s.close(() => {
            pronto();
          });
        }),
    ),
  );
  servidores = [];
});

/** Sobe uma impressora de mentira e devolve o que ela recebeu. */
async function impressoraFalsa(): Promise<{
  porta: number;
  recebido: Buffer[];
}> {
  const recebido: Buffer[] = [];

  const servidor = createServer((socket) => {
    conexoes.push(socket);
    socket.on("data", (pedaco) => recebido.push(pedaco));
  });
  servidores.push(servidor);

  await new Promise<void>((pronto) => {
    servidor.listen(0, "127.0.0.1", () => {
      pronto();
    });
  });

  const endereco = servidor.address();
  if (endereco === null || typeof endereco === "string") throw new Error("sem porta");

  return { porta: endereco.port, recebido };
}

describe("Impressora de rede", () => {
  it("entrega os bytes na porta configurada", async () => {
    const { porta, recebido } = await impressoraFalsa();

    const resultado = await impressoraDeRede({ host: "127.0.0.1", porta }).imprimir(
      BYTES,
    );

    expect(resultado.tipo).toBe("IMPRESSO");
    await new Promise((pronto) => setTimeout(pronto, 50));
    expect(Buffer.concat(recebido)).toEqual(Buffer.from(BYTES));
  });

  it("🔑 impressora desligada devolve falha, não exceção", async () => {
    // Impressora fora do ar é rotina no balcão, não caso excepcional. Quem
    // chama precisa decidir o que fazer — e o que se faz nunca é parar a venda.
    const resultado = await impressoraDeRede({
      host: "127.0.0.1",
      porta: 1,
      tempoLimiteMs: 500,
    }).imprimir(BYTES);

    expect(resultado.tipo).toBe("FALHOU");
    if (resultado.tipo === "FALHOU") {
      expect(resultado.motivo).toContain("127.0.0.1");
    }
  });

  it("🔑 impressora que aceita a conexão e emudece não prende a fila", async () => {
    // O caso mais traiçoeiro: o socket abre, a impressora travou, e sem tempo
    // limite o operador ficaria olhando a ampulheta com a fila esperando. O que
    // se garante é que a chamada **retorna**.
    const servidor = createServer((socket) => {
      conexoes.push(socket);
    });
    servidores.push(servidor);

    await new Promise<void>((pronto) => {
      servidor.listen(0, "127.0.0.1", () => {
        pronto();
      });
    });

    const endereco = servidor.address();
    if (endereco === null || typeof endereco === "string") throw new Error("sem porta");

    const resultado = await impressoraDeRede({
      host: "127.0.0.1",
      porta: endereco.port,
      tempoLimiteMs: 300,
    }).imprimir(BYTES);

    expect(["IMPRESSO", "FALHOU"]).toContain(resultado.tipo);
  });
});

describe("Impressora como arquivo", () => {
  it("escreve os bytes crus — é o caminho da USB no Windows", async () => {
    const alvo = join(mkdtempSync(join(tmpdir(), "pdv-")), "impressora");

    const resultado = await impressoraDeArquivo(alvo).imprimir(BYTES);

    expect(resultado.tipo).toBe("IMPRESSO");
    expect(readFileSync(alvo)).toEqual(Buffer.from(BYTES));
  });

  it("caminho inválido devolve falha com o caminho na mensagem", async () => {
    const resultado = await impressoraDeArquivo(
      "/caminho/que/nao/existe/impressora",
    ).imprimir(BYTES);

    expect(resultado.tipo).toBe("FALHOU");
    if (resultado.tipo === "FALHOU") {
      expect(resultado.motivo).toContain("/caminho/que/nao/existe");
    }
  });
});

describe("Impressora nula", () => {
  it("🔑 é configuração válida — há loja que vende sem cupom", async () => {
    // Sem ela, a ausência de impressora viraria erro em toda venda, e o
    // operador aprenderia a ignorar mensagem de erro.
    expect((await impressoraNula().imprimir(BYTES)).tipo).toBe("IMPRESSO");
  });
});

describe("Montagem a partir da configuração", () => {
  it("cada tipo produz o transporte correspondente", async () => {
    const alvo = join(mkdtempSync(join(tmpdir(), "pdv-")), "impressora");
    const { porta } = await impressoraFalsa();

    expect((await montarImpressora({ tipo: "NENHUMA" }).imprimir(BYTES)).tipo).toBe(
      "IMPRESSO",
    );
    expect(
      (await montarImpressora({ tipo: "ARQUIVO", caminho: alvo }).imprimir(BYTES)).tipo,
    ).toBe("IMPRESSO");
    expect(
      (await montarImpressora({ tipo: "REDE", host: "127.0.0.1", porta }).imprimir(BYTES))
        .tipo,
    ).toBe("IMPRESSO");
  });

  it("rede sem porta cai na 9100", async () => {
    const resultado = await montarImpressora({
      tipo: "REDE",
      host: "127.0.0.1",
    }).imprimir(BYTES);

    // Ninguém escutando na 9100 desta máquina: o que importa é ser falha
    // tratada, e não exceção.
    expect(resultado.tipo).toBe("FALHOU");
  });
});
