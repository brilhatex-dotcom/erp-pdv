import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarUsuario,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
} from "./apoio.js";

let servidor: FastifyInstance;
let container: Container;

const PIN = "419273";
const SENHA = "cavalo bateria grampo";

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
});

async function comoAdmin(): Promise<{ authorization: string }> {
  await cadastrarUsuario(container, {
    matricula: "1",
    nome: "Ana Administradora",
    papel: "ADMIN",
    pin: PIN,
    senha: SENHA,
  });

  return { authorization: `Bearer ${(await logar(servidor, "1", PIN)).token}` };
}

function chamar(
  method: "GET" | "POST" | "PUT",
  url: string,
  headers?: { authorization: string },
  payload: Record<string, unknown> = {},
) {
  // O cabeçalho vai sempre presente: `inject` muda de tipo quando a chave é
  // omitida condicionalmente, e o vazio funciona igual.
  return servidor.inject({ method, url, headers: headers ?? {}, payload });
}

describe("Instalação nova", () => {
  it("🔑 anuncia que precisa de configuração, sem exigir login", async () => {
    // É a pergunta que a tela faz antes de existir alguém para autenticar. Sem
    // ela, o produto instala e não abre.
    const resposta = await chamar("GET", "/api/instalacao/situacao");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<{ precisaConfiguracao: boolean }>().precisaConfiguracao).toBe(
      true,
    );
  });

  it("🔑 cria o primeiro administrador sem autenticação", async () => {
    const criado = await chamar(
      "POST",
      "/api/instalacao/primeiro-administrador",
      undefined,
      {
        matricula: "1",
        nome: "Ana Administradora",
        senha: SENHA,
      },
    );

    expect(criado.statusCode).toBe(201);
    expect(criado.json<{ papel: string }>().papel).toBe("ADMIN");
    // Não exige troca: quem escolheu a senha foi quem está instalando.
    expect(
      criado.json<{ precisaTrocarCredencial: boolean }>().precisaTrocarCredencial,
    ).toBe(false);

    const depois = await chamar("GET", "/api/instalacao/situacao");
    expect(depois.json<{ precisaConfiguracao: boolean }>().precisaConfiguracao).toBe(
      false,
    );
  });

  it("🔑 a porta se tranca sozinha depois do primeiro", async () => {
    // Não depende de ninguém lembrar de desativar a configuração inicial.
    await chamar("POST", "/api/instalacao/primeiro-administrador", undefined, {
      matricula: "1",
      nome: "Ana",
      senha: SENHA,
    });

    const segundo = await chamar(
      "POST",
      "/api/instalacao/primeiro-administrador",
      undefined,
      {
        matricula: "666",
        nome: "Invasor",
        senha: "outra-senha-bem-longa",
      },
    );

    expect(segundo.statusCode).toBeGreaterThanOrEqual(400);
    expect(segundo.statusCode).toBeLessThan(500);
    expect(await container.prisma.usuario.count()).toBe(1);
  });

  it("🔑 senha curta é recusada com a razão, não com 'inválido'", async () => {
    // "Requisição inválida" faz o instalador tentar às cegas e ligar ao suporte.
    const curta = await chamar(
      "POST",
      "/api/instalacao/primeiro-administrador",
      undefined,
      {
        matricula: "1",
        nome: "Ana",
        senha: "curta",
      },
    );

    expect(curta.statusCode).toBe(400);
    expect(curta.json<{ erro: { mensagem: string } }>().erro.mensagem).toContain("12");
  });

  it("depois de criado, o administrador consegue entrar", async () => {
    await chamar("POST", "/api/instalacao/primeiro-administrador", undefined, {
      matricula: "1",
      nome: "Ana",
      senha: SENHA,
      pin: PIN,
    });

    const entrada = await logar(servidor, "1", PIN);
    expect(entrada.token).toBeDefined();
  });
});

describe("Gestão de usuários", () => {
  it("cadastra operador com PIN e lista", async () => {
    const cabecalho = await comoAdmin();

    const criado = await chamar("POST", "/api/usuarios", cabecalho, {
      matricula: "42",
      nome: "Maria da Silva",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });

    expect(criado.statusCode).toBe(201);
    expect(criado.json<{ temPin: boolean; temSenha: boolean }>()).toMatchObject({
      temPin: true,
      temSenha: false,
    });

    const lista = await chamar("GET", "/api/usuarios", cabecalho);
    expect(lista.json<{ itens: unknown[] }>().itens).toHaveLength(2);
  });

  it("🔑 nenhuma resposta traz hash de credencial", async () => {
    // Hash exibido é hash no cache do navegador, no log do proxy e na captura
    // de tela do suporte.
    const cabecalho = await comoAdmin();

    const criado = await chamar("POST", "/api/usuarios", cabecalho, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });

    const corpo = JSON.stringify(criado.json());
    expect(corpo).not.toContain("argon2");
    expect(corpo).not.toContain("hash");

    const lista = await chamar("GET", "/api/usuarios", cabecalho);
    expect(JSON.stringify(lista.json())).not.toContain("argon2");
  });

  it("🔑 PIN fraco é recusado — no balcão ele vale por todos os outros controles", async () => {
    // O ataque ao PIN exige só presença física (ADR-0011).
    const cabecalho = await comoAdmin();

    for (const pin of ["1234", "12345678", "abcdef", ""]) {
      const resposta = await chamar("POST", "/api/usuarios", cabecalho, {
        matricula: "42",
        nome: "Maria",
        papel: "OPERADOR_CAIXA",
        pin,
      });

      expect(resposta.statusCode).toBe(400);
    }
  });

  it("matrícula repetida é recusada", async () => {
    const cabecalho = await comoAdmin();

    const repetida = await chamar("POST", "/api/usuarios", cabecalho, {
      matricula: "1",
      nome: "Outra",
      papel: "GERENTE",
      senha: SENHA,
    });

    expect(repetida.statusCode).toBe(409);
  });

  it("usuário sem credencial nenhuma é recusado", async () => {
    const cabecalho = await comoAdmin();

    const resposta = await chamar("POST", "/api/usuarios", cabecalho, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
    });

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    expect(resposta.statusCode).toBeLessThan(500);
  });

  it("altera nome, papel e situação", async () => {
    const cabecalho = await comoAdmin();
    const criado = await chamar("POST", "/api/usuarios", cabecalho, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });
    const { id } = criado.json<{ id: string }>();

    const alterado = await chamar("PUT", `/api/usuarios/${id}`, cabecalho, {
      nome: "Maria da Silva Souza",
      papel: "SUPERVISOR",
      ativo: false,
    });

    expect(alterado.json<{ nome: string }>().nome).toBe("Maria da Silva Souza");
    expect(alterado.json<{ papel: string }>().papel).toBe("SUPERVISOR");
    expect(alterado.json<{ ativo: boolean }>().ativo).toBe(false);
  });

  it("🔑 o administrador não desativa o próprio acesso", async () => {
    // É trancar a chave dentro do carro: sem outro administrador, o conserto
    // vira intervenção no banco, na loja do cliente.
    const cabecalho = await comoAdmin();
    const eu = (await chamar("GET", "/api/usuarios", cabecalho))
      .json<{
        itens: { id: string; matricula: string }[];
      }>()
      .itens.find((u) => u.matricula === "1");

    const tentativa = await chamar("PUT", `/api/usuarios/${eu?.id ?? ""}`, cabecalho, {
      nome: "Ana",
      papel: "ADMIN",
      ativo: false,
    });

    expect(tentativa.statusCode).toBeGreaterThanOrEqual(400);
    expect(tentativa.statusCode).toBeLessThan(500);
  });

  it("🔑 quem executa vem do token, não do corpo", async () => {
    // Aceitá-lo do cliente permitiria contornar a guarda acima passando o id de
    // outra pessoa.
    const cabecalho = await comoAdmin();
    const eu = (await chamar("GET", "/api/usuarios", cabecalho)).json<{
      itens: { id: string }[];
    }>().itens[0];

    const tentativa = await chamar("PUT", `/api/usuarios/${eu?.id ?? ""}`, cabecalho, {
      nome: "Ana",
      papel: "ADMIN",
      ativo: false,
      executadoPor: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e800099",
    });

    expect(tentativa.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("id malformado e corpo inválido são 400", async () => {
    const cabecalho = await comoAdmin();

    expect(
      (
        await chamar("PUT", "/api/usuarios/xpto", cabecalho, {
          nome: "x",
          papel: "ADMIN",
          ativo: true,
        })
      ).statusCode,
    ).toBe(400);
    expect((await chamar("POST", "/api/usuarios", cabecalho, {})).statusCode).toBe(400);
    expect(
      (
        await chamar("POST", "/api/usuarios", cabecalho, {
          matricula: "42",
          nome: "Maria",
          papel: "INVENTADO",
          pin: "999888",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("usuário inexistente na alteração é recusado", async () => {
    const cabecalho = await comoAdmin();

    const resposta = await chamar(
      "PUT",
      "/api/usuarios/018f3a2b-7c1d-7e4f-8a9b-1c2d3e809999",
      cabecalho,
      { nome: "Fantasma", papel: "GERENTE", ativo: true },
    );

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    expect(resposta.statusCode).toBeLessThan(500);
  });
});

describe("Credenciais", () => {
  it("🔑 o administrador repõe o PIN e o operador volta a entrar", async () => {
    // É o chamado mais comum do módulo.
    const cabecalho = await comoAdmin();
    const criado = await chamar("POST", "/api/usuarios", cabecalho, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });
    const { id } = criado.json<{ id: string }>();

    const reposto = await chamar("PUT", `/api/usuarios/${id}/credencial`, cabecalho, {
      pin: "111222",
    });

    expect(reposto.statusCode).toBe(204);

    const entrada = await logar(servidor, "42", "111222");
    expect(entrada.token).toBeDefined();
  });

  it("🔑 o operador troca a própria credencial sem permissão administrativa", async () => {
    // Quem foi obrigado a trocar no primeiro acesso é justamente quem não tem
    // permissão de gerir usuários. Sem esta rota, ele não cumpriria a exigência
    // que o próprio sistema criou.
    const admin = await comoAdmin();
    await chamar("POST", "/api/usuarios", admin, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });

    const dela = {
      authorization: `Bearer ${(await logar(servidor, "42", "999888")).token}`,
    };

    const trocada = await chamar("PUT", "/api/acesso/minha-credencial", dela, {
      pin: "333444",
    });

    expect(trocada.statusCode).toBe(204);

    const novaEntrada = await logar(servidor, "42", "333444");
    expect(novaEntrada.token).toBeDefined();
  });

  it("🔑 o operador NÃO troca a credencial de outra pessoa", async () => {
    const admin = await comoAdmin();
    const criado = await chamar("POST", "/api/usuarios", admin, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });

    const dela = {
      authorization: `Bearer ${(await logar(servidor, "42", "999888")).token}`,
    };

    const tentativa = await chamar(
      "PUT",
      `/api/usuarios/${criado.json<{ id: string }>().id}/credencial`,
      dela,
      { pin: "555666" },
    );

    expect(tentativa.statusCode).toBe(403);
  });

  it("credencial fraca é recusada nas duas rotas", async () => {
    const cabecalho = await comoAdmin();
    const eu = (await chamar("GET", "/api/usuarios", cabecalho)).json<{
      itens: { id: string }[];
    }>().itens[0];

    expect(
      (
        await chamar("PUT", `/api/usuarios/${eu?.id ?? ""}/credencial`, cabecalho, {
          pin: "12",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await chamar("PUT", "/api/acesso/minha-credencial", cabecalho, { senha: "curta" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await chamar("PUT", "/api/acesso/minha-credencial", cabecalho, {})).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });

  it("id malformado na credencial é 400", async () => {
    const cabecalho = await comoAdmin();

    expect(
      (await chamar("PUT", "/api/usuarios/xpto/credencial", cabecalho, { pin: "111222" }))
        .statusCode,
    ).toBe(400);
  });

  it("credencial de usuário inexistente é recusada", async () => {
    const cabecalho = await comoAdmin();

    const resposta = await chamar(
      "PUT",
      "/api/usuarios/018f3a2b-7c1d-7e4f-8a9b-1c2d3e809999/credencial",
      cabecalho,
      { pin: "111222" },
    );

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    expect(resposta.statusCode).toBeLessThan(500);
  });
});

describe("Sem permissão", () => {
  it("🔑 o operador de caixa não gere usuários", async () => {
    const admin = await comoAdmin();
    await chamar("POST", "/api/usuarios", admin, {
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "999888",
    });

    const dela = {
      authorization: `Bearer ${(await logar(servidor, "42", "999888")).token}`,
    };

    expect((await chamar("GET", "/api/usuarios", dela)).statusCode).toBe(403);
    expect(
      (
        await chamar("POST", "/api/usuarios", dela, {
          matricula: "43",
          nome: "X",
          papel: "ADMIN",
          pin: "111222",
        })
      ).statusCode,
    ).toBe(403);
  });

  it("sem token, nada", async () => {
    expect((await chamar("GET", "/api/usuarios")).statusCode).toBe(401);
    expect((await chamar("POST", "/api/usuarios", undefined, {})).statusCode).toBe(401);
    expect(
      (await chamar("PUT", "/api/acesso/minha-credencial", undefined, { pin: "111222" }))
        .statusCode,
    ).toBe(401);
  });
});
