import {
  type AgendaDeCopias,
  type ArquivoGerado,
  type CopiaGuardada,
  ErroInfraestrutura,
  type FerramentaDeBackup,
  type PastaDeCopias,
  type ProvaDaCopia,
  type ResumoDoBanco,
} from "@erp/application";
import { PastaDeCopiasNoDisco } from "@erp/database";
import { Dinheiro, type DomainError, err, ok, Produto, type Result } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Container } from "../composicao/container.js";
import { baterAgendaDeCopias } from "../http/manutencao.js";
import {
  cadastrarProduto,
  cadastrarUsuario,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
  proximoId,
} from "./apoio.js";

/**
 * As cópias de segurança pela API, com o `pg_dump` de verdade.
 *
 * O que se prova é o caminho inteiro que o dono usa: fazer a cópia, ver que
 * ela foi conferida, mudar a agenda, conferir e restaurar — com o banco da
 * suíte trocado de verdade pela cópia, a auditoria no banco restaurado e a
 * API em manutenção enquanto isso.
 */

const PIN = { OPERADOR_CAIXA: "482913", GERENTE: "573914", ADMIN: "719264" } as const;
const MATRICULA = { OPERADOR_CAIXA: "42", GERENTE: "2", ADMIN: "1" } as const;
const NOME = { OPERADOR_CAIXA: "Maria", GERENTE: "Ana", ADMIN: "Rui" } as const;

type Papel = keyof typeof PIN;
type Cabecalho = { readonly authorization: string };

let servidor: FastifyInstance;
let container: Container;
let pasta: string;

beforeAll(async () => {
  prepararBanco();
  pasta = await mkdtemp(join(tmpdir(), "erp-copias-api-"));
  ({ servidor, container } = await montarServidorDeTeste({
    PASTA_COPIAS: pasta,
    PASTA_BINARIOS_POSTGRES: process.env["PASTA_BINARIOS_POSTGRES"] ?? "",
  }));
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
  await rm(pasta, { recursive: true, force: true });
});

beforeEach(async () => {
  await limparBanco(container);
});

async function entrar(papel: Papel): Promise<Cabecalho> {
  await cadastrarUsuario(container, {
    matricula: MATRICULA[papel],
    pin: PIN[papel],
    nome: NOME[papel],
    papel,
  });
  const { token } = await logar(servidor, MATRICULA[papel], PIN[papel]);

  return { authorization: `Bearer ${token}` };
}

async function situacao(cabecalho: Cabecalho) {
  const resposta = await servidor.inject({
    method: "GET",
    url: "/api/copias-de-seguranca",
    headers: cabecalho,
  });

  return resposta.json<{
    readonly configurada: boolean;
    readonly pasta: string;
    readonly copias: readonly {
      readonly nome: string;
      readonly origem: string;
      readonly conferida: boolean;
      readonly resumo?: { readonly produtos: number; readonly versao: string };
    }[];
    readonly configuracao: {
      readonly intervaloHoras: number;
      readonly aoFecharCaixa: boolean;
    };
    readonly ultimaTentativa?: { readonly situacao: string; readonly erro?: string };
    readonly emAndamento: boolean;
    readonly proximaAutomatica?: string;
  }>();
}

function agenda(): AgendaDeCopias {
  const copias = container.copias;
  if (copias === undefined) throw new Error("a suíte sobe com as cópias ligadas");
  return copias.agenda;
}

function copiar(cabecalho: Cabecalho) {
  return servidor.inject({
    method: "POST",
    url: "/api/copias-de-seguranca",
    headers: cabecalho,
  });
}

describe("quem pode o quê", () => {
  it("🔑 o operador nem vê; o gerente vê e copia; só o administrador mexe na agenda e restaura", async () => {
    const operador = await entrar("OPERADOR_CAIXA");
    const gerente = await entrar("GERENTE");

    const doOperador = await servidor.inject({
      method: "GET",
      url: "/api/copias-de-seguranca",
      headers: operador,
    });
    expect(doOperador.statusCode).toBe(403);

    expect((await copiar(gerente)).statusCode).toBe(201);

    const nome = (await situacao(gerente)).copias[0]?.nome ?? "";
    for (const pedido of [
      {
        method: "PUT" as const,
        url: "/api/copias-de-seguranca/agenda",
        payload: { intervaloHoras: 4, aoFecharCaixa: true },
      },
      { method: "POST" as const, url: `/api/copias-de-seguranca/${nome}/conferencia` },
      {
        method: "POST" as const,
        url: `/api/copias-de-seguranca/${nome}/restauracao`,
        payload: { confirmacao: "RESTAURAR" },
      },
    ]) {
      expect((await servidor.inject({ ...pedido, headers: gerente })).statusCode).toBe(
        403,
      );
    }
  });

  it("sem sessão, nada", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/copias-de-seguranca",
    });

    expect(resposta.statusCode).toBe(401);
  });
});

describe("fazer e ver as cópias", () => {
  it("🔑 a cópia feita à mão aparece conferida, com o que há dentro dela", async () => {
    const gerente = await entrar("GERENTE");
    await cadastrarProduto(container);

    const feita = await copiar(gerente);
    expect(feita.statusCode).toBe(201);
    expect(feita.json()).toMatchObject({
      copia: { origem: "MANUAL", conferida: true, resumo: { produtos: 1, vendas: 0 } },
    });

    const vista = await situacao(gerente);
    expect(vista).toMatchObject({
      configurada: true,
      pasta,
      configuracao: { intervaloHoras: 1, aoFecharCaixa: true },
      ultimaTentativa: { situacao: "CONCLUIDO" },
      emAndamento: false,
    });
    expect(vista.copias).toHaveLength(1);
    expect(vista.copias[0]?.resumo?.versao).toBe("20261017120000_backup_agenda");
    expect(new Date(vista.proximaAutomatica ?? "").getTime()).toBeGreaterThan(Date.now());
  });

  it("🔑 a agenda: o administrador muda, e o que não está na lista é recusado com palavras", async () => {
    const administrador = await entrar("ADMIN");

    const mudada = await servidor.inject({
      method: "PUT",
      url: "/api/copias-de-seguranca/agenda",
      headers: administrador,
      payload: { intervaloHoras: 4, aoFecharCaixa: false },
    });
    expect(mudada.statusCode).toBe(200);
    expect(mudada.json()).toEqual({
      configuracao: { intervaloHoras: 4, aoFecharCaixa: false },
    });
    expect((await situacao(administrador)).configuracao).toEqual({
      intervaloHoras: 4,
      aoFecharCaixa: false,
    });

    const fora = await servidor.inject({
      method: "PUT",
      url: "/api/copias-de-seguranca/agenda",
      headers: administrador,
      payload: { intervaloHoras: 3, aoFecharCaixa: true },
    });
    expect(fora.statusCode).toBe(400);
    expect(fora.json()).toMatchObject({
      erro: { codigo: "INTERVALO_DE_BACKUP_INVALIDO" },
    });

    const malformada = await servidor.inject({
      method: "PUT",
      url: "/api/copias-de-seguranca/agenda",
      headers: administrador,
      payload: { intervaloHoras: "toda hora" },
    });
    expect(malformada.statusCode).toBe(400);
  });
});

describe("conferir e restaurar", () => {
  it("🔑 conferir mostra a cópia ao lado do banco de agora, sem trocar nada", async () => {
    const administrador = await entrar("ADMIN");
    await cadastrarProduto(container);
    const nome = (await copiar(administrador)).json<{ copia: { nome: string } }>().copia
      .nome;

    const conferida = await servidor.inject({
      method: "POST",
      url: `/api/copias-de-seguranca/${nome}/conferencia`,
      headers: administrador,
    });

    expect(conferida.statusCode).toBe(200);
    expect(conferida.json()).toMatchObject({
      conferencia: {
        copia: { nome },
        restaurou: true,
        daCopia: { produtos: 1 },
        atual: { produtos: 1 },
        compativel: true,
      },
    });
  });

  it("🔑 restaurar: sem a palavra, nada; com ela, o banco volta ao da cópia — e a auditoria diz quem fez", async () => {
    const administrador = await entrar("ADMIN");
    await cadastrarProduto(container);
    const nome = (await copiar(administrador)).json<{ copia: { nome: string } }>().copia
      .nome;

    // Depois da cópia: um produto que a restauração vai levar embora.
    await container.leitura.produtos.salvar(
      Produto.criar({
        id: proximoId(),
        sku: "PAO01",
        descricao: "Pão Francês",
        tipo: "UNITARIO",
        unidadeBase: "UN",
        precoVenda: Dinheiro.deReais("0,75").unwrap(),
      }).unwrap(),
    );
    expect(await container.prisma.produto.count()).toBe(2);

    const semPalavra = await servidor.inject({
      method: "POST",
      url: `/api/copias-de-seguranca/${nome}/restauracao`,
      headers: administrador,
      payload: { confirmacao: "sim" },
    });
    expect(semPalavra.statusCode).toBe(400);
    expect(semPalavra.json()).toMatchObject({
      erro: { codigo: "CONFIRMACAO_INCORRETA" },
    });
    expect(await container.prisma.produto.count()).toBe(2);

    const restaurada = await servidor.inject({
      method: "POST",
      url: `/api/copias-de-seguranca/${nome}/restauracao`,
      headers: administrador,
      payload: { confirmacao: "restaurar" },
    });

    expect(restaurada.statusCode).toBe(200);
    const corpo = restaurada.json<{
      restaurada: { nome: string };
      copiaDeAntes: {
        nome: string;
        origem: string;
        conferida: boolean;
        resumo: { produtos: number };
      };
    }>();
    expect(corpo.restaurada.nome).toBe(nome);
    expect(corpo.copiaDeAntes).toMatchObject({
      origem: "ANTES_DE_RESTAURAR",
      conferida: true,
      resumo: { produtos: 2 },
    });

    // O banco é o da cópia, e o servidor continua atendendo com ele.
    expect(await container.prisma.produto.count()).toBe(1);

    const registro = await container.prisma.registroAuditoria.findFirst({
      where: { acao: "BACKUP_RESTAURADO" },
    });
    expect(registro?.descricao).toContain("por Rui (matrícula 1)");
    expect(registro?.descricao).toContain(corpo.copiaDeAntes.nome);

    // A cópia de antes está na lista: é por ela que se volta, se foi engano.
    const nomes = (await situacao(administrador)).copias.map((copia) => copia.nome);
    expect(nomes).toContain(corpo.copiaDeAntes.nome);
  });

  it("🔑 com caixa aberto, a restauração espera — ou vai mesmo assim, se pedido com todas as letras", async () => {
    const administrador = await entrar("ADMIN");
    const operador = await entrar("OPERADOR_CAIXA");
    const nome = (await copiar(administrador)).json<{ copia: { nome: string } }>().copia
      .nome;
    await servidor.inject({
      method: "POST",
      url: "/api/caixa/abrir",
      headers: operador,
      payload: { estacaoId: proximoId().valor, fundoTroco: "10000" },
    });

    const recusada = await servidor.inject({
      method: "POST",
      url: `/api/copias-de-seguranca/${nome}/restauracao`,
      headers: administrador,
      payload: { confirmacao: "RESTAURAR" },
    });
    expect(recusada.statusCode).toBe(422);
    expect(recusada.json()).toMatchObject({
      erro: {
        codigo: "CAIXAS_ABERTOS",
        mensagem: expect.stringContaining("Há 1 caixa aberto") as unknown,
      },
    });

    const mesmoAssim = await servidor.inject({
      method: "POST",
      url: `/api/copias-de-seguranca/${nome}/restauracao`,
      headers: administrador,
      payload: { confirmacao: "RESTAURAR", comCaixasAbertos: true },
    });
    expect(mesmoAssim.statusCode).toBe(200);
    // A cópia é de antes do caixa abrir: ele some junto.
    expect(await container.prisma.sessaoCaixa.count()).toBe(0);
  });

  it("cópia que não existe é avisada; nome fora do formato nem chega a ser procurado", async () => {
    const administrador = await entrar("ADMIN");

    const sumida = await servidor.inject({
      method: "POST",
      url: "/api/copias-de-seguranca/copia-20200101-000000-manual.dump/conferencia",
      headers: administrador,
    });
    expect(sumida.statusCode).toBe(404);
    expect(sumida.json()).toMatchObject({ erro: { codigo: "COPIA_NAO_ENCONTRADA" } });

    const vazia = await servidor.inject({
      method: "POST",
      url: "/api/copias-de-seguranca//restauracao",
      headers: administrador,
      payload: { confirmacao: "RESTAURAR" },
    });
    expect(vazia.statusCode).toBe(400);

    const semCorpo = await servidor.inject({
      method: "POST",
      url: "/api/copias-de-seguranca/copia-20200101-000000-manual.dump/restauracao",
      headers: administrador,
    });
    expect(semCorpo.statusCode).toBe(400);

    const traversal = await servidor.inject({
      method: "POST",
      url: `/api/copias-de-seguranca/${encodeURIComponent("../../segredo.dump")}/conferencia`,
      headers: administrador,
    });
    expect(traversal.statusCode).toBe(404);

    const semNome = await servidor.inject({
      method: "POST",
      url: "/api/copias-de-seguranca//conferencia",
      headers: administrador,
    });
    expect(semNome.statusCode).toBe(400);

    const nomeLongo = await servidor.inject({
      method: "POST",
      url: `/api/copias-de-seguranca/${"x".repeat(200)}/conferencia`,
      headers: administrador,
    });
    expect(nomeLongo.statusCode).toBe(414);
  });
});

describe("manutenção e agenda", () => {
  it("🔑 durante a restauração, a API responde 503 — que o caixa entende como servidor fora — e a saúde segue no ar", async () => {
    const gerente = await entrar("GERENTE");

    await container.manutencao.durante(async () => {
      const api = await servidor.inject({
        method: "GET",
        url: "/api/copias-de-seguranca",
        headers: gerente,
      });
      expect(api.statusCode).toBe(503);
      expect(api.headers["retry-after"]).toBe("60");
      expect(api.json()).toMatchObject({ erro: { codigo: "EM_MANUTENCAO" } });

      const saude = await servidor.inject({ method: "GET", url: "/saude" });
      expect(saude.statusCode).toBe(200);
    });

    const depois = await servidor.inject({
      method: "GET",
      url: "/api/copias-de-seguranca",
      headers: gerente,
    });
    expect(depois.statusCode).toBe(200);
  });

  it("🔑 o fechamento de caixa pede a cópia do dia, sem esperar por ela", async () => {
    const operador = await entrar("OPERADOR_CAIXA");
    const gerente = await entrar("GERENTE");
    const estacaoId = proximoId().valor;

    await servidor.inject({
      method: "POST",
      url: "/api/caixa/abrir",
      headers: operador,
      payload: { estacaoId, fundoTroco: "10000" },
    });
    const pedir = vi.spyOn(agenda(), "pedirCopiaDoFechamento");

    const fechado = await servidor.inject({
      method: "POST",
      url: "/api/caixa/fechar",
      headers: operador,
      payload: { estacaoId, contadoEmDinheiro: "10000" },
    });
    expect(fechado.statusCode).toBe(200);
    expect(pedir).toHaveBeenCalledTimes(1);

    // A cópia corre por fora; quando termina, aparece na lista — e a suíte
    // só segue depois dela, para não limpar o banco no meio do `pg_dump`.
    await vi.waitFor(
      async () => {
        const vista = await situacao(gerente);
        expect(vista.copias.map((copia) => copia.origem)).toContain(
          "FECHAMENTO_DE_CAIXA",
        );
        expect(vista.emAndamento).toBe(false);
      },
      { timeout: 15_000, interval: 200 },
    );
    pedir.mockRestore();
  });

  it("o fechamento que falha não pede cópia", async () => {
    const operador = await entrar("OPERADOR_CAIXA");
    const pedir = vi.spyOn(agenda(), "pedirCopiaDoFechamento");

    const semCaixa = await servidor.inject({
      method: "POST",
      url: "/api/caixa/fechar",
      headers: operador,
      payload: { estacaoId: proximoId().valor, contadoEmDinheiro: "0" },
    });

    expect(semCaixa.statusCode).toBeGreaterThanOrEqual(400);
    expect(pedir).not.toHaveBeenCalled();
    pedir.mockRestore();
  });

  it("🔑 o relógio da agenda bate depois de o servidor ficar pronto, e para quando ele fecha", async () => {
    const { servidor: outro, container: deOutro } = await montarServidorDeTeste();
    const agenda = { verificar: vi.fn(() => Promise.resolve(undefined)) };
    baterAgendaDeCopias(outro, agenda, 20);

    await outro.ready();
    await vi.waitFor(() => {
      expect(agenda.verificar).toHaveBeenCalled();
    });

    await outro.close();
    await deOutro.encerrar();
    const batidas = agenda.verificar.mock.calls.length;
    await new Promise((resolver) => setTimeout(resolver, 80));
    expect(agenda.verificar.mock.calls.length).toBe(batidas);
  });
});

describe("quando a cópia não dá certo", () => {
  /** Ferramenta que falha ao gerar, como o `pg_dump` sem o banco no ar. */
  class FerramentaQueFalha implements FerramentaDeBackup {
    gerar(): Promise<Result<ArquivoGerado, DomainError>> {
      return Promise.resolve(
        err(
          new ErroInfraestrutura(
            "BACKUP_FALHOU",
            "O banco não deixou fazer a cópia de segurança.",
            {
              causa: "pg_dump: error: connection refused",
            },
          ),
        ),
      );
    }
    provar(): Promise<ProvaDaCopia> {
      return Promise.resolve({ restaurou: false, motivo: "não usado" });
    }
    resumoAtual(): Promise<ResumoDoBanco> {
      return Promise.reject(new Error("não usado"));
    }
    restaurar(): Promise<Result<void, DomainError>> {
      return Promise.reject(new Error("não usado"));
    }
  }

  class PastaVazia implements PastaDeCopias {
    listar(): Promise<readonly CopiaGuardada[]> {
      return Promise.resolve([]);
    }
    guardar(): Promise<CopiaGuardada> {
      return Promise.reject(new Error("não usado"));
    }
    caminhoDe(): Promise<string | undefined> {
      return Promise.resolve(undefined);
    }
    apagar(): Promise<void> {
      return Promise.resolve();
    }
  }

  it("🔑 a falha volta com palavras, e a tela vê a última tentativa com o detalhe para o suporte", async () => {
    const montado = await montarServidorDeTeste(
      { PASTA_COPIAS: pasta },
      { copias: { ferramenta: new FerramentaQueFalha(), pasta: new PastaVazia() } },
    );
    const [antigoServidor, antigoContainer] = [servidor, container];
    ({ servidor, container } = montado);

    try {
      const gerente = await entrar("GERENTE");

      const feita = await copiar(gerente);
      expect(feita.statusCode).toBe(409);
      expect(feita.json()).toMatchObject({ erro: { codigo: "BACKUP_FALHOU" } });
      expect(JSON.stringify(feita.json())).not.toContain("connection refused");

      expect((await situacao(gerente)).ultimaTentativa).toMatchObject({
        situacao: "FALHOU",
        erro: "O banco não deixou fazer a cópia de segurança. Detalhe para o suporte: pg_dump: error: connection refused",
      });
    } finally {
      await servidor.close();
      await container.encerrar();
      [servidor, container] = [antigoServidor, antigoContainer];
    }
  });

  it("🔑 a cópia que não passa na prova aparece como não conferida, com o motivo", async () => {
    /** Gera um arquivo de verdade, mas a "prova" dele falha — o disco que corrompe. */
    class FerramentaQueProvaMal implements FerramentaDeBackup {
      async gerar(): Promise<Result<ArquivoGerado, DomainError>> {
        const caminho = join(pasta, `gerado-${String(Date.now())}.parcial`);
        await writeFile(caminho, "cópia corrompida");
        return ok({ caminho, tamanhoBytes: 16, sha256: "a".repeat(64) });
      }
      provar(): Promise<ProvaDaCopia> {
        return Promise.resolve({ restaurou: false, motivo: "o arquivo não restaurou" });
      }
      resumoAtual(): Promise<ResumoDoBanco> {
        return Promise.resolve({
          vendas: 0,
          produtos: 0,
          clientes: 0,
          caixasAbertos: 0,
          migracoes: [],
        });
      }
      restaurar(): Promise<Result<void, DomainError>> {
        return Promise.reject(new Error("não usado"));
      }
    }

    const montado = await montarServidorDeTeste(
      { PASTA_COPIAS: pasta },
      {
        copias: {
          ferramenta: new FerramentaQueProvaMal(),
          pasta: new PastaDeCopiasNoDisco(pasta),
        },
      },
    );
    const [antigoServidor, antigoContainer] = [servidor, container];
    ({ servidor, container } = montado);

    try {
      const administrador = await entrar("ADMIN");

      const feita = await copiar(administrador);
      expect(feita.statusCode).toBe(201);
      const copia = feita.json<{ copia: { nome: string } }>().copia;
      expect(copia).toMatchObject({
        conferida: false,
        motivo: "o arquivo não restaurou",
      });

      const conferida = await servidor.inject({
        method: "POST",
        url: `/api/copias-de-seguranca/${copia.nome}/conferencia`,
        headers: administrador,
      });
      expect(conferida.json()).toMatchObject({
        conferencia: {
          restaurou: false,
          motivo: "o arquivo não restaurou",
          compativel: false,
        },
      });
    } finally {
      await servidor.close();
      await container.encerrar();
      [servidor, container] = [antigoServidor, antigoContainer];
    }
  });

  it("🔑 a pasta que não abre é dita com palavras", async () => {
    const arquivo = join(pasta, "nao-e-pasta");
    await writeFile(arquivo, "x");
    const montado = await montarServidorDeTeste({ PASTA_COPIAS: arquivo });
    const [antigoServidor, antigoContainer] = [servidor, container];
    ({ servidor, container } = montado);

    try {
      const gerente = await entrar("GERENTE");

      const vista = await servidor.inject({
        method: "GET",
        url: "/api/copias-de-seguranca",
        headers: gerente,
      });

      expect(vista.statusCode).toBe(409);
      expect(vista.json()).toMatchObject({
        erro: { codigo: "PASTA_DE_COPIAS_INACESSIVEL" },
      });
    } finally {
      await servidor.close();
      await container.encerrar();
      [servidor, container] = [antigoServidor, antigoContainer];
    }
  });

  it("🔑 sem pasta configurada (só fora da produção), a tela sabe, e nada é feito", async () => {
    const montado = await montarServidorDeTeste();
    const [antigoServidor, antigoContainer] = [servidor, container];
    ({ servidor, container } = montado);

    try {
      const administrador = await entrar("ADMIN");

      expect(await situacao(administrador)).toEqual({ configurada: false });

      for (const pedido of [
        { method: "POST" as const, url: "/api/copias-de-seguranca" },
        {
          method: "PUT" as const,
          url: "/api/copias-de-seguranca/agenda",
          payload: { intervaloHoras: 4, aoFecharCaixa: true },
        },
        {
          method: "POST" as const,
          url: "/api/copias-de-seguranca/copia-20200101-000000-manual.dump/conferencia",
        },
        {
          method: "POST" as const,
          url: "/api/copias-de-seguranca/copia-20200101-000000-manual.dump/restauracao",
          payload: { confirmacao: "RESTAURAR" },
        },
      ]) {
        const resposta = await servidor.inject({ ...pedido, headers: administrador });
        expect(resposta.statusCode).toBe(422);
        expect(resposta.json()).toMatchObject({
          erro: { codigo: "COPIAS_NAO_CONFIGURADAS" },
        });
      }
    } finally {
      await servidor.close();
      await container.encerrar();
      [servidor, container] = [antigoServidor, antigoContainer];
    }
  });
});
