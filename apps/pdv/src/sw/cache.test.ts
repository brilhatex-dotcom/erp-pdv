import { describe, expect, it, vi } from "vitest";

import {
  type Armazem,
  cachePrimeiro,
  type Dependencias,
  limparCachesAntigos,
  redePrimeiro,
} from "./cache.js";

/**
 * O comportamento que faz o PDV abrir com o servidor da loja fora do ar.
 *
 * É o coração do princípio 1 aplicado à tela. Um defeito aqui não aparece em
 * dia bom — aparece exatamente no dia em que a rede cai, que é o dia em que
 * ninguém tem paciência para descobrir o que houve.
 */

function resposta(corpo = "ok", status = 200): Response {
  return new Response(corpo, { status });
}

function montar(
  guardadas: Record<string, Response> = {},
  buscar: (pedido: Request) => Promise<Response> = () => Promise.resolve(resposta()),
): {
  readonly dependencias: Dependencias;
  readonly gravadas: { pedido: Request; resposta: Response }[];
} {
  const gravadas: { pedido: Request; resposta: Response }[] = [];

  const armazem: Armazem = {
    match: async (pedido) =>
      Promise.resolve(guardadas[new URL(pedido.url, "http://loja").pathname]),
    open: async () =>
      Promise.resolve({
        put: async (pedido: Request, valor: Response) => {
          gravadas.push({ pedido, resposta: valor });

          return Promise.resolve();
        },
      }),
  };

  return {
    dependencias: { armazem, buscar, nomeDoCache: "pdv-teste" },
    gravadas,
  };
}

/**
 * A spec **proíbe** construir um `Request` com `mode: "navigate"` — só o
 * navegador cria esse, ao seguir um link. Como é justamente o caso que
 * interessa, a propriedade é escrita por cima: é o que o service worker recebe
 * de verdade.
 */
function pedidoDe(caminho: string, modo: RequestMode = "cors"): Request {
  const pedido = new Request(`http://loja${caminho}`);

  Object.defineProperty(pedido, "mode", { value: modo });

  return pedido;
}

describe("cache primeiro", () => {
  it("serve do cache sem tocar na rede", async () => {
    const buscar = vi.fn(async () => Promise.resolve(resposta("da rede")));
    const { dependencias } = montar(
      { "/assets/x-a1b2c3d4.js": resposta("do cache") },
      buscar,
    );

    const devolvida = await cachePrimeiro(
      pedidoDe("/assets/x-a1b2c3d4.js"),
      dependencias,
    );

    await expect(devolvida.text()).resolves.toBe("do cache");
    expect(buscar).not.toHaveBeenCalled();
  });

  it("sem nada guardado, busca e guarda", async () => {
    const { dependencias, gravadas } = montar({}, async () =>
      Promise.resolve(resposta("da rede")),
    );

    const devolvida = await cachePrimeiro(
      pedidoDe("/assets/y-b2c3d4e5.js"),
      dependencias,
    );

    await expect(devolvida.text()).resolves.toBe("da rede");
    expect(gravadas).toHaveLength(1);
  });
});

describe("rede primeiro", () => {
  it("🔑 com rede, serve a versão nova — não a guardada", async () => {
    // Cache primeiro deixaria a estação rodando código velho até alguém
    // perceber. E ninguém percebe, porque tudo parece funcionar.
    const { dependencias } = montar({ "/": resposta("versão velha") }, async () =>
      Promise.resolve(resposta("versão nova")),
    );

    const devolvida = await redePrimeiro(pedidoDe("/", "navigate"), dependencias);

    await expect(devolvida.text()).resolves.toBe("versão nova");
  });

  it("🔑 rede caída serve o que estiver guardado", async () => {
    // É o caso que justifica o módulo inteiro: o servidor da loja desligou e a
    // tela precisa abrir mesmo assim.
    const { dependencias } = montar({ "/": resposta("do cache") }, async () =>
      Promise.reject(new Error("sem rede")),
    );

    const devolvida = await redePrimeiro(pedidoDe("/", "navigate"), dependencias);

    await expect(devolvida.text()).resolves.toBe("do cache");
  });

  it("🔑 navegação a endereço nunca visitado cai na raiz", async () => {
    // A aplicação é de página única: `/venda` e `/` são o mesmo documento. Sem
    // esta queda, abrir um atalho salvo com a rede fora mostraria o erro do
    // navegador, que fala de DNS para quem está com um cliente na frente.
    const { dependencias } = montar({ "/": resposta("aplicação") }, async () =>
      Promise.reject(new Error("sem rede")),
    );

    const devolvida = await redePrimeiro(pedidoDe("/venda", "navigate"), dependencias);

    await expect(devolvida.text()).resolves.toBe("aplicação");
  });

  it("🔑 sem rede e sem cache, o erro sobe — não vira resposta em branco", async () => {
    // Responder vazio faria a tela abrir quebrada, sem explicação. O erro do
    // navegador ao menos diz que não houve conexão.
    const { dependencias } = montar({}, async () =>
      Promise.reject(new Error("sem rede")),
    );

    await expect(redePrimeiro(pedidoDe("/assets/z.js"), dependencias)).rejects.toThrow(
      "sem rede",
    );
  });

  it("pedido comum sem rede e sem cache não cai na raiz", async () => {
    // A queda para a raiz vale só para navegação. Devolver o HTML da aplicação
    // no lugar de um `.js` produziria um erro de sintaxe incompreensível.
    const { dependencias } = montar({ "/": resposta("aplicação") }, async () =>
      Promise.reject(new Error("sem rede")),
    );

    await expect(redePrimeiro(pedidoDe("/assets/z.js"), dependencias)).rejects.toThrow();
  });

  it("🔑 resposta com erro não é guardada", async () => {
    // Guardar um 500 transformaria uma falha momentânea do servidor em falha
    // permanente da estação.
    const { dependencias, gravadas } = montar({}, async () =>
      Promise.resolve(resposta("erro", 500)),
    );

    await redePrimeiro(pedidoDe("/"), dependencias);

    expect(gravadas).toHaveLength(0);
  });
});

describe("limpeza de versões antigas", () => {
  it("🔑 apaga o que não é a versão atual", async () => {
    // A estação de caixa fica anos sem ser formatada. Sem limpeza, cada
    // atualização deixa um build inteiro para trás.
    const apagar = vi.fn(async () => Promise.resolve(true));

    const antigos = await limparCachesAntigos(
      ["pdv-v1", "pdv-v2", "pdv-v3"],
      "pdv-v3",
      apagar,
    );

    expect(antigos).toEqual(["pdv-v1", "pdv-v2"]);
    expect(apagar).toHaveBeenCalledTimes(2);
  });

  it("não apaga nada quando só existe a atual", async () => {
    const apagar = vi.fn(async () => Promise.resolve(true));

    await limparCachesAntigos(["pdv-v3"], "pdv-v3", apagar);

    expect(apagar).not.toHaveBeenCalled();
  });
});
