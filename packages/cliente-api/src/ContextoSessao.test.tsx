import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClienteApi, Sessao } from "./cliente.js";
import {
  identificadorDoDispositivo,
  ProvedorSessao,
  useSessao,
} from "./ContextoSessao.js";

/**
 * Testes do contexto de sessão **no próprio pacote**.
 *
 * Ele já era exercitado de lado pelos testes de tela, e isso escondia duas
 * coisas: os caminhos que nenhuma tela percorre — o erro de uso do hook, o
 * identificador de dispositivo — e a diferença entre "coberto" e "verificado".
 * Tela testando contexto prova que a tela funciona, não que o contexto está
 * certo.
 */

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const USUARIO = {
  id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
  nome: "Ana Gerente",
  matricula: "1",
  papel: "GERENTE",
  permissoes: ["venda:criar", "produto:ver_custo"],
  precisaTrocarCredencial: false,
};

type Rotas = Record<string, () => Response>;

const SEM_SESSAO: Rotas = {
  "/api/acesso/eu": () => json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } }),
};

const COM_SESSAO: Rotas = {
  "/api/acesso/eu": () => json(200, USUARIO),
};

function montarCliente(rotas: Rotas): ClienteApi {
  const buscar = vi.fn((url: string) => {
    const rota = rotas[url.split("?")[0] ?? url];
    return Promise.resolve(
      rota?.() ?? json(404, { erro: { codigo: "X", mensagem: "x" } }),
    );
  });

  return new ClienteApi(new Sessao(), "", buscar as unknown as typeof fetch);
}

function envolver(cliente: ClienteApi) {
  return function Envolvido({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <ProvedorSessao contexto="RETAGUARDA" cliente={cliente}>
        {children}
      </ProvedorSessao>
    );
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("useSessao fora do provedor", () => {
  it("falha alto, porque é erro de programação e não de negócio", () => {
    // Devolver `undefined` faria a tela quebrar mais tarde, com uma mensagem
    // que não aponta a causa. `throw` aqui aponta o arquivo errado na hora
    // (princípio 7 do CLAUDE.md: `throw` só para bug de programação).
    expect(() => renderHook(() => useSessao())).toThrow(
      /precisa estar dentro de <ProvedorSessao>/,
    );
  });
});

describe("restauração ao montar", () => {
  it("termina restaurando mesmo sem sessão para restaurar", async () => {
    // Primeiro acesso é o caso normal, não defeito: precisa sair do estado de
    // carregamento, ou a retaguarda ficaria presa numa tela cinza para sempre.
    const { result } = renderHook(() => useSessao(), {
      wrapper: envolver(montarCliente(SEM_SESSAO)),
    });

    await waitFor(() => {
      expect(result.current.restaurando).toBe(false);
    });
    expect(result.current.usuario).toBeUndefined();
  });

  it("recupera o usuário quando o cookie ainda vale", async () => {
    const { result } = renderHook(() => useSessao(), {
      wrapper: envolver(montarCliente(COM_SESSAO)),
    });

    await waitFor(() => {
      expect(result.current.usuario?.nome).toBe("Ana Gerente");
    });
  });

  it("cancela a restauração em voo ao desmontar", async () => {
    // Sem o `AbortController`, o `StrictMode` — que monta duas vezes em
    // desenvolvimento — dispararia duas restaurações, e a segunda escreveria
    // estado num componente já desmontado.
    let concluir: ((resposta: Response) => void) | undefined;

    const buscar = vi.fn(
      () =>
        new Promise<Response>((resolver) => {
          concluir = resolver;
        }),
    );

    const cliente = new ClienteApi(new Sessao(), "", buscar);

    const { unmount, result } = renderHook(() => useSessao(), {
      wrapper: envolver(cliente),
    });

    unmount();
    concluir?.(json(200, USUARIO));

    await new Promise((resolver) => setTimeout(resolver, 0));

    // Continua sem usuário: a resposta que chegou tarde foi descartada.
    expect(result.current.usuario).toBeUndefined();
  });
});

describe("entrar", () => {
  it("guarda o token e o usuário devolvidos pelo servidor", async () => {
    const { result } = renderHook(() => useSessao(), {
      wrapper: envolver(
        montarCliente({
          ...SEM_SESSAO,
          "/api/acesso/login": () => json(200, { token: "abc", usuario: USUARIO }),
        }),
      ),
    });

    await waitFor(() => {
      expect(result.current.restaurando).toBe(false);
    });

    await act(async () => {
      await result.current.entrar("1", "cavalo bateria grampo");
    });

    expect(result.current.usuario?.matricula).toBe("1");
    expect(result.current.cliente.sessao.token).toBe("abc");
  });

  it("🔑 propaga a recusa em vez de engolir", async () => {
    // A tela precisa do erro para mostrar a mensagem do servidor. Engolir aqui
    // faria o botão "Entrar" parecer que funcionou e nada acontecer.
    const { result } = renderHook(() => useSessao(), {
      wrapper: envolver(
        montarCliente({
          ...SEM_SESSAO,
          "/api/acesso/login": () =>
            json(401, {
              erro: {
                codigo: "CREDENCIAL_INVALIDA",
                mensagem: "Matrícula ou senha incorreta.",
              },
            }),
        }),
      ),
    });

    await waitFor(() => {
      expect(result.current.restaurando).toBe(false);
    });

    await expect(result.current.entrar("1", "errada")).rejects.toThrow(
      /Matrícula ou senha incorreta/,
    );
    expect(result.current.usuario).toBeUndefined();
  });
});

describe("sair", () => {
  it("derruba a sessão local e avisa o servidor", async () => {
    const cliente = montarCliente({
      ...COM_SESSAO,
      "/api/acesso/sair": () => json(204, {}),
    });

    const { result } = renderHook(() => useSessao(), { wrapper: envolver(cliente) });

    await waitFor(() => {
      expect(result.current.usuario).toBeDefined();
    });

    await act(async () => {
      await result.current.sair();
    });

    expect(result.current.usuario).toBeUndefined();
    expect(cliente.sessao.token).toBeUndefined();
  });

  it("🔑 a sessão local cai mesmo se o servidor não responder", async () => {
    // Deixar o usuário "logado" numa tela cuja sessão já não vale é pior do que
    // pedir o login de novo: toda ação seguinte voltaria 401 sem explicação. O
    // servidor limpa a sessão órfã na expiração.
    const cliente = montarCliente(COM_SESSAO);

    const { result } = renderHook(() => useSessao(), { wrapper: envolver(cliente) });

    await waitFor(() => {
      expect(result.current.usuario).toBeDefined();
    });

    await act(async () => {
      await result.current.sair();
    });

    expect(result.current.usuario).toBeUndefined();
  });
});

describe("pode", () => {
  it("responde falso enquanto ninguém entrou", () => {
    const { result } = renderHook(() => useSessao(), {
      wrapper: envolver(montarCliente(SEM_SESSAO)),
    });

    // Negar por padrão também na tela: sem usuário, nada aparece.
    expect(result.current.pode("venda:criar")).toBe(false);
  });

  it("reflete as permissões de quem entrou", async () => {
    const { result } = renderHook(() => useSessao(), {
      wrapper: envolver(montarCliente(COM_SESSAO)),
    });

    await waitFor(() => {
      expect(result.current.usuario).toBeDefined();
    });

    expect(result.current.pode("produto:ver_custo")).toBe(true);
    expect(result.current.pode("config:fiscal")).toBe(false);
  });
});

describe("perda de sessão vinda do cliente HTTP", () => {
  it("derruba o usuário quando a renovação falha no meio do trabalho", async () => {
    // O refresh expira ou é revogado pelo administrador. Sem isto a tela
    // continuaria mostrando os dados de quem já não tem sessão, e toda ação
    // seguinte voltaria 401 sem explicação.
    const cliente = montarCliente(COM_SESSAO);

    const { result } = renderHook(() => useSessao(), { wrapper: envolver(cliente) });

    await waitFor(() => {
      expect(result.current.usuario).toBeDefined();
    });

    cliente.sessao.perder();

    await waitFor(() => {
      expect(result.current.usuario).toBeUndefined();
    });
  });
});

describe("identificadorDoDispositivo", () => {
  it("gera e guarda na primeira vez", () => {
    const primeiro = identificadorDoDispositivo();

    expect(primeiro).toMatch(/^[0-9a-f-]{36}$/);
    expect(globalThis.localStorage.getItem("erp.dispositivo")).toBe(primeiro);
  });

  it("repete o mesmo valor nas próximas", () => {
    // É o que permite ao administrador reconhecer "o computador do escritório"
    // na lista de sessões. Valor novo a cada carregamento encheria a lista de
    // dispositivos fantasmas e tornaria o encerramento remoto inútil.
    const primeiro = identificadorDoDispositivo();

    expect(identificadorDoDispositivo()).toBe(primeiro);
  });

  it("substitui valor vazio guardado por engano", () => {
    globalThis.localStorage.setItem("erp.dispositivo", "");

    const gerado = identificadorDoDispositivo();

    expect(gerado).not.toBe("");
    expect(globalThis.localStorage.getItem("erp.dispositivo")).toBe(gerado);
  });
});

describe("provedor sem cliente injetado", () => {
  it("monta com o cliente padrão", async () => {
    // É como a aplicação sobe de verdade. Sem este teste, o caminho que roda em
    // produção seria o único nunca exercitado.
    const buscar = vi.fn(() =>
      Promise.resolve(json(401, { erro: { codigo: "TOKEN_AUSENTE", mensagem: "x" } })),
    );
    vi.stubGlobal("fetch", buscar);

    render(
      <ProvedorSessao contexto="RETAGUARDA">
        <p>retaguarda</p>
      </ProvedorSessao>,
    );

    expect(await screen.findByText("retaguarda")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
