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

/**
 * Cadastro da empresa da instalação, pela fronteira HTTP.
 *
 * O que esta suíte guarda é a autorização: quem lê o cabeçalho da loja e quem
 * pode trocar o emitente. Deixar a segunda com o operador de caixa seria o
 * cadastro fiscal da loja alterável de dentro do PDV.
 */

let servidor: FastifyInstance;
let container: Container;

const PIN = "419273";

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

async function comoPapel(
  papel: "OPERADOR_CAIXA" | "GERENTE",
  matricula = "1",
): Promise<{ authorization: string }> {
  await cadastrarUsuario(container, {
    matricula,
    nome: `Usuário ${papel}`,
    papel,
    pin: PIN,
  });

  const { token } = await logar(servidor, matricula, PIN);
  return { authorization: `Bearer ${token}` };
}

type Cabecalho = { readonly authorization: string };

function corpo(sobrescritas: Record<string, unknown> = {}) {
  return {
    razaoSocial: "Mercadinho Bom Preço Ltda",
    nomeFantasia: "Bom Preço",
    cnpj: "11.222.333/0001-81",
    inscricaoEstadual: "110042490114",
    regimeTributario: "SIMPLES_NACIONAL",
    endereco: {
      logradouro: "Rua das Flores",
      numero: "120",
      bairro: "Centro",
      municipio: "Campinas",
      uf: "SP",
      cep: "13010000",
    },
    ...sobrescritas,
  };
}

function put(cabecalho: Cabecalho, payload: Record<string, unknown>) {
  return servidor.inject({
    method: "PUT",
    url: "/api/empresa",
    headers: cabecalho,
    payload,
  });
}

function get(cabecalho: Cabecalho) {
  return servidor.inject({ method: "GET", url: "/api/empresa", headers: cabecalho });
}

describe("GET /api/empresa", () => {
  it("🔑 devolve 204 quando a instalação ainda não foi configurada", async () => {
    // Não é 404: a loja recém-instalada não perdeu um cadastro, ela ainda não o
    // fez. A tela precisa abrir o formulário em branco, não dizer "não
    // encontrado" no primeiro uso do sistema.
    const resposta = await get(await comoPapel("GERENTE"));

    expect(resposta.statusCode).toBe(204);
  });

  it("🔑 o operador de caixa lê o cadastro", async () => {
    // Razão social e CNPJ saem impressos em todo cupom que o cliente leva para
    // casa; esconder do operador o que está no papel na mão dele não protege
    // nada e trava a tela de retaguarda.
    await put(await comoPapel("GERENTE"), corpo());

    const resposta = await get(await comoPapel("OPERADOR_CAIXA", "2"));

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ exibicao: "Bom Preço" });
  });

  it("exige autenticação", async () => {
    const resposta = await servidor.inject({ method: "GET", url: "/api/empresa" });

    expect(resposta.statusCode).toBe(401);
  });
});

describe("PUT /api/empresa", () => {
  it("cadastra e devolve o que a tela mostra", async () => {
    const resposta = await put(await comoPapel("GERENTE"), corpo());

    expect(resposta.statusCode).toBe(200);

    expect(resposta.json()).toMatchObject({
      razaoSocial: "Mercadinho Bom Preço Ltda",
      cnpj: "11222333000181",
      cnpjFormatado: "11.222.333/0001-81",
      endereco: { municipio: "Campinas" },
      aptaAEmitir: true,
    });
  });

  it("🔑 devolve todo campo opcional que foi preenchido", async () => {
    // Campo que entra no cadastro e some na resposta é o defeito que a tela não
    // acusa: o lojista salva, recarrega e encontra o telefone em branco sem
    // nenhum erro ter aparecido.
    const resposta = await put(
      await comoPapel("GERENTE"),
      corpo({
        inscricaoMunicipal: "998877",
        telefone: "1938887777",
        email: "contato@bompreco.com.br",
        endereco: {
          logradouro: "Rua das Flores",
          numero: "120",
          complemento: "Loja 2",
          bairro: "Centro",
          municipio: "Campinas",
          codigoMunicipioIbge: "3509502",
          uf: "SP",
          cep: "13010000",
        },
      }),
    );

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      nomeFantasia: "Bom Preço",
      inscricaoEstadual: "110042490114",
      inscricaoMunicipal: "998877",
      telefone: "1938887777",
      email: "contato@bompreco.com.br",
      endereco: { complemento: "Loja 2", codigoMunicipioIbge: "3509502" },
    });
  });

  it("campo opcional em branco volta ausente, não vazio", async () => {
    const resposta = await put(
      await comoPapel("GERENTE"),
      corpo({ nomeFantasia: undefined }),
    );

    expect(resposta.json()).not.toHaveProperty("nomeFantasia");
    // Sem fantasia, o cupom sai com a razão social — nunca em branco.
    expect(resposta.json()).toMatchObject({ exibicao: "Mercadinho Bom Preço Ltda" });
  });

  it("🔑 o operador de caixa não altera o emitente", async () => {
    // 403, e não 401: a sessão vale — falta alçada. 401 faria o cliente tentar
    // renovar a sessão e despejar o operador na tela de login.
    const resposta = await put(await comoPapel("OPERADOR_CAIXA"), corpo());

    expect(resposta.statusCode).toBe(403);
  });

  it("salvar de novo atualiza, sem criar a segunda empresa", async () => {
    const cabecalho = await comoPapel("GERENTE");

    await put(cabecalho, corpo());
    const segunda = await put(cabecalho, corpo({ nomeFantasia: "Bom Preço Centro" }));

    expect(segunda.statusCode).toBe(200);
    expect(segunda.json()).toMatchObject({ exibicao: "Bom Preço Centro" });
    expect(await container.prisma.empresa.count()).toBe(1);
  });

  it("recusa corpo sem endereço com mensagem que o lojista entende", async () => {
    const semEndereco = corpo();
    delete (semEndereco as Record<string, unknown>).endereco;

    const resposta = await put(await comoPapel("GERENTE"), semEndereco);

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({
      erro: {
        codigo: "REQUISICAO_INVALIDA",
        mensagem: expect.stringContaining("endereço"),
      },
    });
  });

  it("🔑 CNPJ com dígito verificador errado é recusado pelo domínio", async () => {
    // Passa pelo Zod, que só confere o tamanho, e morre no objeto de valor. É o
    // caminho de um dígito trocado na digitação — e a mensagem que volta é a do
    // domínio, escrita para o lojista, não um erro técnico.
    const resposta = await put(
      await comoPapel("GERENTE"),
      corpo({ cnpj: "11222333000182" }),
    );

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "CNPJ_INVALIDO" } });
  });

  it("recusa regime tributário que não existe", async () => {
    const resposta = await put(
      await comoPapel("GERENTE"),
      corpo({ regimeTributario: "LUCRO_MARCIANO" }),
    );

    expect(resposta.statusCode).toBe(400);
  });

  it("🔑 avisa que falta inscrição estadual sem impedir o cadastro", async () => {
    // O módulo fiscal é opcional (ADR-0016): a loja vende sem ele. O aviso
    // existe para o lojista descobrir antes da habilitação, não na primeira
    // tentativa de emissão.
    const resposta = await put(
      await comoPapel("GERENTE"),
      corpo({ inscricaoEstadual: undefined }),
    );

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ aptaAEmitir: false });
  });
});
