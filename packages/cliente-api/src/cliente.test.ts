import { describe, expect, it, vi } from "vitest";

import { ClienteApi, ErroDaApi, mensagemDe, Sessao } from "./cliente.js";

/** Constrói uma resposta como o `fetch` devolveria. */
function resposta(status: number, corpo?: unknown): Response {
  if (status === 204) return new Response(null, { status });

  return new Response(JSON.stringify(corpo ?? {}), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function erroDe(codigo: string, mensagem: string) {
  return { erro: { codigo, mensagem } };
}

function montar(respostas: readonly Response[]) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  let indice = 0;

  const buscar = vi.fn((url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const proxima = respostas[indice] ?? resposta(500);
    indice += 1;
    return Promise.resolve(proxima);
  });

  const sessao = new Sessao();
  const cliente = new ClienteApi(sessao, "", buscar as unknown as typeof fetch);

  return { cliente, sessao, chamadas, buscar };
}

describe("Chamada à API", () => {
  it("envia o token quando existe, e não envia quando não existe", async () => {
    const { cliente, sessao, chamadas } = montar([
      resposta(200, { ok: true }),
      resposta(200, {}),
    ]);

    await cliente.requisitar("/api/x");
    expect(
      (chamadas[0]?.init.headers as Record<string, string>)["authorization"],
    ).toBeUndefined();

    sessao.definir("token-abc");
    await cliente.requisitar("/api/x");
    expect((chamadas[1]?.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer token-abc",
    );
  });

  it("🔑 manda o cookie junto — sem isso a renovação falha em silêncio", () => {
    const { cliente, chamadas } = montar([resposta(200, {})]);

    void cliente.requisitar("/api/x");

    expect(chamadas[0]?.init.credentials).toBe("include");
  });

  it("serializa o corpo e declara o tipo", async () => {
    const { cliente, chamadas } = montar([resposta(200, {})]);

    await cliente.requisitar("/api/x", { metodo: "POST", corpo: { matricula: "42" } });

    expect(chamadas[0]?.init.method).toBe("POST");
    expect(chamadas[0]?.init.body).toBe('{"matricula":"42"}');
    expect((chamadas[0]?.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });

  it("aceita 204 sem corpo", async () => {
    const { cliente } = montar([resposta(204)]);

    await expect(
      cliente.requisitar("/api/acesso/sair", { metodo: "POST" }),
    ).resolves.toBeUndefined();
  });
});

describe("Tradução de erro", () => {
  it("🔑 entrega a mensagem que o domínio escreveu para o operador", async () => {
    const { cliente } = montar([
      resposta(
        404,
        erroDe("PRODUTO_NAO_ENCONTRADO", "Produto não encontrado. Confira o código."),
      ),
    ]);

    await expect(cliente.requisitar("/api/produtos/buscar")).rejects.toMatchObject({
      codigo: "PRODUTO_NAO_ENCONTRADO",
      mensagemAmigavel: "Produto não encontrado. Confira o código.",
      status: 404,
    });
  });

  it("🔑 502 com HTML não vira SyntaxError incompreensível", async () => {
    // Um proxy fora do ar devolve HTML. Deixar o `json()` estourar substituiria
    // a mensagem útil por um erro que não diz nada a ninguém.
    const { cliente } = montar([
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    ]);

    const promessa = cliente.requisitar("/api/x");

    await expect(promessa).rejects.toBeInstanceOf(ErroDaApi);
    await expect(promessa).rejects.toMatchObject({
      codigo: "FALHA_DESCONHECIDA",
      mensagemAmigavel: "Não foi possível concluir a operação. Tente novamente.",
    });
  });

  it("marca 401 como exigindo novo login", async () => {
    const { cliente } = montar([
      resposta(401, erroDe("SESSAO_INVALIDA", "Sua sessão expirou.")),
      resposta(401, erroDe("SESSAO_INVALIDA", "Sua sessão expirou.")),
    ]);

    await expect(cliente.requisitar("/api/x")).rejects.toMatchObject({
      exigeNovoLogin: true,
    });
  });

  it("🔑 rede caída vira frase que diz o que fazer", () => {
    // `TypeError: Failed to fetch` é incompreensível para quem opera a loja.
    expect(mensagemDe(new TypeError("Failed to fetch"))).toBe(
      "Sem conexão com o servidor da loja. Verifique a rede e tente de novo.",
    );
    expect(mensagemDe(new ErroDaApi("X", "Estoque insuficiente.", 422))).toBe(
      "Estoque insuficiente.",
    );
    expect(mensagemDe("qualquer coisa")).toBe(
      "Não foi possível concluir a operação. Tente novamente.",
    );
  });
});

describe("Renovação transparente", () => {
  it("🔑 renova e repete a requisição sem o operador perceber", async () => {
    // Token vale 15 min; um gerente parado 20 min numa tela de relatório não
    // pode ser jogado para fora.
    const { cliente, sessao, chamadas } = montar([
      resposta(401, erroDe("TOKEN_INVALIDO", "Expirou.")),
      resposta(200, { token: "token-novo" }),
      resposta(200, { nome: "Ana" }),
    ]);

    sessao.definir("token-velho");
    const resultado = await cliente.requisitar<{ nome: string }>("/api/acesso/eu");

    expect(resultado.nome).toBe("Ana");
    expect(sessao.token).toBe("token-novo");
    expect(chamadas.map((c) => c.url)).toEqual([
      "/api/acesso/eu",
      "/api/acesso/renovar",
      "/api/acesso/eu",
    ]);
  });

  it("🔑 não repete em laço quando a renovação também falha", async () => {
    // Repetir indefinidamente transformaria sessão morta em tempestade de
    // requisições contra o servidor da loja.
    const perdeu = vi.fn();
    const { cliente, sessao, chamadas } = montar([
      resposta(401, erroDe("TOKEN_INVALIDO", "Expirou.")),
      resposta(401, erroDe("SESSAO_INVALIDA", "Sessão encerrada.")),
    ]);

    sessao.definir("token-velho");
    sessao.aoPerderSessao(perdeu);

    await expect(cliente.requisitar("/api/acesso/eu")).rejects.toBeInstanceOf(ErroDaApi);

    expect(chamadas).toHaveLength(2);
    expect(perdeu).toHaveBeenCalledOnce();
    expect(sessao.token).toBeUndefined();
  });

  it("🔑 requisições paralelas disparam UMA renovação só", async () => {
    // Três renovações concorrentes gastariam o refresh que a primeira acabou de
    // emitir — e é justamente o padrão que o servidor trata como roubo de
    // token, derrubando a sessão inteira. O cliente atacaria a si mesmo.
    let renovacoes = 0;

    const buscar = vi.fn((url: string) => {
      if (url === "/api/acesso/renovar") {
        renovacoes += 1;
        return Promise.resolve(resposta(200, { token: "novo" }));
      }
      // Sempre 401 na primeira passada de cada caminho; depois de renovar,
      // o token novo faz passar.
      return Promise.resolve(
        renovacoes === 0
          ? resposta(401, erroDe("TOKEN_INVALIDO", "x"))
          : resposta(200, { ok: 1 }),
      );
    });

    const sessao = new Sessao();
    const cliente = new ClienteApi(sessao, "", buscar as unknown as typeof fetch);
    sessao.definir("velho");

    await Promise.all([
      cliente.requisitar("/api/a"),
      cliente.requisitar("/api/b"),
      cliente.requisitar("/api/c"),
    ]);

    expect(renovacoes).toBe(1);
  });

  it("não tenta renovar a própria renovação", async () => {
    const { cliente, chamadas } = montar([resposta(401, erroDe("SESSAO_INVALIDA", "x"))]);

    await expect(
      cliente.requisitar("/api/acesso/renovar", { metodo: "POST" }),
    ).rejects.toBeInstanceOf(ErroDaApi);

    expect(chamadas).toHaveLength(1);
  });

  it("desiste quando a renovação responde sem token", async () => {
    const { cliente, sessao } = montar([
      resposta(401, erroDe("TOKEN_INVALIDO", "x")),
      resposta(200, { semToken: true }),
    ]);

    sessao.definir("velho");

    await expect(cliente.requisitar("/api/x")).rejects.toBeInstanceOf(ErroDaApi);
    expect(sessao.token).toBeUndefined();
  });
});
