import type { ArquivoGerado, ProvaDaCopia } from "@erp/application";
import {
  Dinheiro,
  Identificador,
  Produto,
  Quantidade,
  SessaoCaixa,
  Venda,
} from "@erp/domain";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resumirArquivo } from "../backup/arquivo.js";
import {
  conexaoDe,
  detalheDe,
  executar,
  FalhaDeFerramenta,
  programa,
} from "../backup/ferramentas.js";
import { FerramentaPostgres } from "../backup/FerramentaPostgres.js";
import { PastaDeCopiasNoDisco } from "../backup/PastaDeCopiasNoDisco.js";
import type { PrismaClient } from "../gerado/index.js";
import { CaixaRepositorioPrisma } from "../repositorios/CaixaRepositorioPrisma.js";
import { ProdutoRepositorioPrisma } from "../repositorios/ProdutoRepositorioPrisma.js";
import { VendaRepositorioPrisma } from "../repositorios/VendaRepositorioPrisma.js";
import {
  criarClienteDeTeste,
  garantirUsuario,
  limparBanco,
  prepararBanco,
  urlComBanco,
} from "./banco.js";

/**
 * A cópia de segurança com o PostgreSQL de verdade.
 *
 * Num banco só desta suíte: a restauração troca o banco inteiro, e fazer isso
 * no banco das outras suítes apagaria o chão delas no meio do teste.
 *
 * As ferramentas são as do PATH, ou as de `PASTA_BINARIOS_POSTGRES` — no CI, as
 * da mesma versão do servidor, porque `pg_dump` recusa servidor mais novo que
 * ele.
 */

const BANCO = "erp_teste_copias";
const URL = urlComBanco(BANCO);
const PASTA_BINARIOS = process.env["PASTA_BINARIOS_POSTGRES"];

const administrador = criarClienteDeTeste(urlComBanco("postgres"));
let prisma: PrismaClient;
let pasta: string;

function id(sufixo: string): Identificador {
  return Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-1c2d3e7c${sufixo}`).unwrap();
}

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

const OPERADOR = id("0001");
const ESTACAO = id("0002");
const CAIXA = id("0003");

function ferramenta(opcoes: { readonly reservaMinimaBytes?: number } = {}) {
  return new FerramentaPostgres({
    urlBanco: URL,
    pastaBinarios: PASTA_BINARIOS,
    pastaDeTrabalho: join(pasta, ".em-andamento"),
    reservaMinimaBytes: opcoes.reservaMinimaBytes ?? 0,
  });
}

async function cadastrarProduto(sufixo: string, descricao: string): Promise<void> {
  await new ProdutoRepositorioPrisma(prisma).salvar(
    Produto.criar({
      id: id(`1${sufixo}`),
      sku: `SKU${sufixo}`,
      descricao,
      tipo: "UNITARIO",
      unidadeBase: "UN",
      precoVenda: reais("12,50"),
    }).unwrap(),
  );
}

async function venderUm(numero: number, quando: Date): Promise<void> {
  const venda = Venda.iniciar({
    id: id(`2${String(numero).padStart(3, "0")}`),
    numero,
    sessaoCaixaId: CAIXA,
    operadorId: OPERADOR,
    estacaoId: ESTACAO,
    abertaEm: quando,
  }).unwrap();
  venda
    .adicionarItem({
      produtoId: id("1001"),
      descricao: "Bolo de Fubá",
      quantidade: Quantidade.de("1", "UN").unwrap(),
      precoUnitario: reais("12,50"),
      custoUnitario: reais("7,30"),
    })
    .unwrap();
  venda.registrarPagamento("DINHEIRO", venda.total).unwrap();
  venda.finalizar(quando).unwrap();
  await new VendaRepositorioPrisma(prisma).salvar(venda);
}

async function produtos(): Promise<readonly string[]> {
  const linhas = await prisma.produto.findMany({ orderBy: { sku: "asc" } });
  return linhas.map((linha) => linha.descricao);
}

beforeAll(async () => {
  await administrador.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`,
  );
  await administrador.$executeRawUnsafe(`CREATE DATABASE "${BANCO}"`);
  prepararBanco(URL);
  prisma = criarClienteDeTeste(URL);
});

afterAll(async () => {
  await prisma.$disconnect();
  await administrador.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`,
  );
  await administrador.$disconnect();
});

beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "erp-copias-"));

  await limparBanco(prisma);
  await garantirUsuario(prisma, OPERADOR.valor, "42");
  await cadastrarProduto("001", "Bolo de Fubá");
  await new CaixaRepositorioPrisma(prisma).salvar(
    SessaoCaixa.abrir({
      id: CAIXA,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
      abertaEm: new Date("2026-10-17T08:00:00.000Z"),
    }).unwrap(),
  );
  await venderUm(1, new Date("2026-10-17T09:00:00.000Z"));
  await venderUm(2, new Date("2026-10-17T10:30:00.000Z"));

  return () => rm(pasta, { recursive: true, force: true });
});

describe("gerar e provar a cópia", () => {
  it("🔑 a cópia restaura numa base à parte, e o resumo dela é o do banco", async () => {
    const copiadora = ferramenta();

    const gerado = (await copiadora.gerar()).unwrap();
    expect(gerado.tamanhoBytes).toBeGreaterThan(0);
    expect(gerado.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await resumirArquivo(gerado.caminho)).toEqual({
      tamanhoBytes: gerado.tamanhoBytes,
      sha256: gerado.sha256,
    });

    const prova = await copiadora.provar(gerado.caminho);
    const atual = await copiadora.resumoAtual();

    expect(prova).toEqual({ restaurou: true, resumo: atual });
    expect(atual).toMatchObject({
      vendas: 2,
      produtos: 1,
      clientes: 0,
      caixasAbertos: 1,
      primeiraVenda: new Date("2026-10-17T09:00:00.000Z"),
      ultimaVenda: new Date("2026-10-17T10:30:00.000Z"),
    });
    expect(atual.migracoes).toContain("20261017120000_backup_agenda");

    // A base descartável não fica para trás. Só as deste processo: a suíte do
    // servidor, rodando ao mesmo tempo no mesmo PostgreSQL, faz as dela.
    expect(
      (await basesDeProva()).filter((base) => base.includes(`_${String(process.pid)}_`)),
    ).toEqual([]);
  });

  it("🔑 o banco sem venda nenhuma também se resume, sem período", async () => {
    await limparBanco(prisma);

    const resumo = await ferramenta().resumoAtual();

    expect(resumo).toMatchObject({ vendas: 0, produtos: 0, clientes: 0 });
    expect(resumo.primeiraVenda).toBeUndefined();
    expect(resumo.ultimaVenda).toBeUndefined();
  });

  it("🔑 o arquivo pela metade não restaura — e o motivo vai para o suporte", async () => {
    const copiadora = ferramenta();
    const gerado = (await copiadora.gerar()).unwrap();
    await truncate(gerado.caminho, Math.floor(gerado.tamanhoBytes / 2));

    const prova = await copiadora.provar(gerado.caminho);

    expect(prova.restaurou).toBe(false);
    expect(!prova.restaurou && prova.motivo).toContain(
      "o arquivo não restaurou (detalhe para o suporte: ",
    );
  });

  it("🔑 com o disco quase cheio, não copia — e diz quanto há e quanto precisa", async () => {
    const resultado = await ferramenta({
      reservaMinimaBytes: Number.MAX_SAFE_INTEGER,
    }).gerar();

    expect(resultado.isErr() && resultado.error.codigo).toBe("POUCO_ESPACO_NO_DISCO");
    expect(resultado.isErr() && resultado.error.mensagem).toContain("livres");
  });

  it("🔑 sem as ferramentas do banco, a falha diz o que é, sem deixar arquivo", async () => {
    const vazia = join(pasta, "sem-ferramentas");
    await mkdir(vazia);
    const copiadora = new FerramentaPostgres({
      urlBanco: URL,
      pastaBinarios: vazia,
      pastaDeTrabalho: join(pasta, ".em-andamento"),
      reservaMinimaBytes: 0,
    });

    const resultado = await copiadora.gerar();

    expect(resultado.isErr() && resultado.error.codigo).toBe("BACKUP_FALHOU");
    expect(resultado.isErr() && resultado.error.detalhes?.["causa"]).toContain("ENOENT");
    expect(await readdirSeguro(join(pasta, ".em-andamento"))).toEqual([]);
  });

  it("o resto de uma cópia interrompida é limpo antes da próxima", async () => {
    const trabalho = join(pasta, ".em-andamento");
    await mkdir(join(trabalho, "pasta-velha"), { recursive: true });
    await writeFile(join(trabalho, "copia-velha.parcial"), "pela metade");

    const gerado = (await ferramenta().gerar()).unwrap();

    expect(await readdirSeguro(trabalho)).toEqual([nomeDe(gerado)]);
  });

  it("🔑 a base de uma prova esquecida por um servidor que caiu sai na próxima prova", async () => {
    const velha = `erp_prova_${String(Math.floor(Date.now() / 1000) - 7200)}_esquecida`;
    const nova = `erp_prova_${String(Math.floor(Date.now() / 1000))}_trabalhando`;
    const lixo = "erp_prova_lixo";
    // Velha e com aspas no nome: não é das nossas, e o nome não vira SQL.
    const estranha = `erp_prova_${String(Math.floor(Date.now() / 1000) - 7200)}_x"y`;
    for (const base of [velha, nova, lixo]) {
      await administrador.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${base}"`);
      await administrador.$executeRawUnsafe(`CREATE DATABASE "${base}"`);
    }
    await administrador.$executeRawUnsafe(
      `CREATE DATABASE "${estranha.replace('"', '""')}"`,
    );

    const copiadora = ferramenta();
    await copiadora.provar((await copiadora.gerar()).unwrap().caminho);

    const restantes = await basesDeProva();

    // A velha sai; a nova pode ser de outro processo ainda trabalhando, e a de
    // nome estranho não é nossa para apagar.
    expect(restantes).not.toContain(velha);
    expect(restantes).toEqual(expect.arrayContaining([nova, lixo, estranha]));

    for (const base of [nova, lixo, estranha]) {
      await administrador.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${base.replace('"', '""')}"`,
      );
    }
  });
});

describe("restaurar", () => {
  it("🔑 o banco volta a ser o da cópia — e o servidor segue usando a mesma conexão", async () => {
    const copiadora = ferramenta();
    const gerado = (await copiadora.gerar()).unwrap();

    await cadastrarProduto("002", "Pão de Queijo");
    await venderUm(3, new Date("2026-10-17T11:00:00.000Z"));
    expect(await produtos()).toEqual(["Bolo de Fubá", "Pão de Queijo"]);

    (await copiadora.restaurar(gerado.caminho)).unwrap();

    // O mesmo PrismaClient, com as consultas já preparadas antes da troca:
    // é o caso do servidor, que não reinicia depois de restaurar.
    expect(await produtos()).toEqual(["Bolo de Fubá"]);
    expect(await prisma.venda.count()).toBe(2);
    expect((await copiadora.resumoAtual()).vendas).toBe(2);

    // E continua gravando: as restrições e os gatilhos voltaram junto.
    await cadastrarProduto("003", "Sonho");
    expect(await produtos()).toEqual(["Bolo de Fubá", "Sonho"]);
  });

  it("🔑 restauração que falha no meio não deixa banco pela metade", async () => {
    const copiadora = ferramenta();
    const gerado = (await copiadora.gerar()).unwrap();
    await truncate(gerado.caminho, Math.floor(gerado.tamanhoBytes * 0.8));
    await cadastrarProduto("002", "Pão de Queijo");

    const resultado = await copiadora.restaurar(gerado.caminho);

    expect(resultado.isErr() && resultado.error.codigo).toBe("RESTAURACAO_FALHOU");
    expect(resultado.isErr() && resultado.error.mensagem).toBe(
      "A restauração não terminou, e o banco continua como estava. Chame o suporte.",
    );
    expect(await produtos()).toEqual(["Bolo de Fubá", "Pão de Queijo"]);
    expect(await prisma.venda.count()).toBe(2);
  });
});

describe("com o servidor de banco fora do ar", () => {
  // Porta 1: ninguém escuta, e a conexão é recusada na hora.
  const foraDoAr = () =>
    new FerramentaPostgres({
      urlBanco: "postgresql://erp:senha@127.0.0.1:1/erp_pdv",
      pastaBinarios: PASTA_BINARIOS,
      pastaDeTrabalho: join(pasta, ".em-andamento"),
      reservaMinimaBytes: 0,
    });

  it("🔑 a cópia falha com palavras, e o detalhe técnico fica para o suporte", async () => {
    const resultado = await foraDoAr().gerar();

    expect(resultado.isErr() && resultado.error.codigo).toBe("BACKUP_FALHOU");
    expect(resultado.isErr() && resultado.error.mensagem).toContain(
      "Confira se o serviço do banco está ligado",
    );
    expect(resultado.isErr() && String(resultado.error.detalhes?.["causa"])).toMatch(
      /connection|conex/i,
    );
  });

  it("🔑 a prova diz que não restaurou — sem lançar", async () => {
    const gerado = (await ferramenta().gerar()).unwrap();

    const prova = await foraDoAr().provar(gerado.caminho);

    expect(prova.restaurou).toBe(false);
  });

  it("a restauração diz que nada mudou", async () => {
    const gerado = (await ferramenta().gerar()).unwrap();

    const resultado = await foraDoAr().restaurar(gerado.caminho);

    expect(resultado.isErr() && resultado.error.codigo).toBe("RESTAURACAO_FALHOU");
  });

  it("o resumo do banco de agora sobe como falha de leitura", async () => {
    await expect(foraDoAr().resumoAtual()).rejects.toBeInstanceOf(FalhaDeFerramenta);
  });
});

describe("a pasta das cópias", () => {
  const PROVADA: ProvaDaCopia = {
    restaurou: true,
    resumo: {
      vendas: 2,
      produtos: 1,
      clientes: 0,
      primeiraVenda: new Date("2026-10-17T09:00:00.000Z"),
      ultimaVenda: new Date("2026-10-17T10:30:00.000Z"),
      caixasAbertos: 0,
      migracoes: ["20261017120000_backup_agenda"],
    },
  };

  async function gerado(conteudo = "conteúdo da cópia"): Promise<ArquivoGerado> {
    const trabalho = join(pasta, ".em-andamento");
    await mkdir(trabalho, { recursive: true });
    const caminho = join(trabalho, `gerado-${String(Math.random()).slice(2)}.parcial`);
    await writeFile(caminho, conteudo);
    return { caminho, ...(await resumirArquivo(caminho)) };
  }

  const CRIADA_EM = new Date(2026, 9, 17, 14, 0, 0);

  it("🔑 guarda o arquivo com a ficha ao lado, e lista o que guardou", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);

    const guardada = await copias.guardar(await gerado(), {
      origem: "AUTOMATICA",
      criadaEm: CRIADA_EM,
      prova: PROVADA,
    });

    expect(guardada.nome).toBe("copia-20261017-140000-automatica.dump");
    expect(await copias.listar()).toEqual([guardada]);
    expect(await copias.caminhoDe(guardada.nome)).toBe(join(pasta, guardada.nome));

    const ficha: unknown = JSON.parse(
      await readFile(join(pasta, "copia-20261017-140000-automatica.json"), "utf8"),
    );
    expect(ficha).toMatchObject({
      versao: 1,
      origem: "AUTOMATICA",
      prova: { restaurou: true },
    });
  });

  it("guarda a cópia que não restaurou, com o motivo", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const falha: ProvaDaCopia = { restaurou: false, motivo: "arquivo truncado" };

    await copias.guardar(await gerado(), {
      origem: "MANUAL",
      criadaEm: CRIADA_EM,
      prova: falha,
    });

    expect((await copias.listar())[0]?.prova).toEqual(falha);
  });

  it("duas cópias no mesmo segundo não se sobrescrevem", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const dados = { origem: "MANUAL" as const, criadaEm: CRIADA_EM, prova: PROVADA };

    const primeira = await copias.guardar(await gerado("a"), dados);
    const segunda = await copias.guardar(await gerado("b"), dados);

    expect(primeira.nome).toBe("copia-20261017-140000-manual.dump");
    expect(segunda.nome).toBe("copia-20261017-140000-2-manual.dump");
    expect(await copias.listar()).toHaveLength(2);
  });

  it("cada origem tem o seu nome no disco", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const nomes: string[] = [];

    for (const origem of ["FECHAMENTO_DE_CAIXA", "ANTES_DE_RESTAURAR"] as const) {
      nomes.push(
        (
          await copias.guardar(await gerado(), {
            origem,
            criadaEm: CRIADA_EM,
            prova: PROVADA,
          })
        ).nome,
      );
    }

    expect(nomes).toEqual([
      "copia-20261017-140000-fechamento.dump",
      "copia-20261017-140000-antes-de-restaurar.dump",
    ]);
  });

  it("🔑 nome de fora do formato nunca vira caminho — nem para ler, nem para apagar", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const alheio = join(pasta, "..", "segredo.dump");
    await writeFile(alheio, "não é cópia");

    for (const nome of ["../segredo.dump", "copia-x.dump", "/etc/passwd", ""]) {
      expect(await copias.caminhoDe(nome)).toBeUndefined();
      await copias.apagar(nome);
    }

    expect((await stat(alheio)).isFile()).toBe(true);
    await rm(alheio);
  });

  it("🔑 só aparece o que tem ficha boa e arquivo — o resto é ignorado", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const boa = await copias.guardar(await gerado(), {
      origem: "AUTOMATICA",
      criadaEm: CRIADA_EM,
      prova: PROVADA,
    });

    // Arquivo sem ficha, ficha que não é JSON, ficha fora do esquema, ficha
    // sem arquivo, e lixo com outro nome.
    await writeFile(join(pasta, "copia-20261017-150000-manual.dump"), "sem ficha");
    await writeFile(join(pasta, "copia-20261017-160000-manual.dump"), "x");
    await writeFile(join(pasta, "copia-20261017-160000-manual.json"), "{ quebrado");
    await writeFile(join(pasta, "copia-20261017-170000-manual.dump"), "x");
    await writeFile(join(pasta, "copia-20261017-170000-manual.json"), '{"versao": 2}');
    await writeFile(
      join(pasta, "copia-20261017-180000-manual.json"),
      await readFile(join(pasta, "copia-20261017-140000-automatica.json"), "utf8"),
    );
    await writeFile(join(pasta, "anotacoes.txt"), "lixo");

    expect((await copias.listar()).map((copia) => copia.nome)).toEqual([boa.nome]);
    expect(await copias.caminhoDe("copia-20261017-150000-manual.dump")).toBeUndefined();
    expect(await copias.caminhoDe("copia-20261017-180000-manual.dump")).toBeUndefined();
  });

  it("🔑 o arquivo que mudou de tamanho depois de provado deixa de valer como provado", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const guardada = await copias.guardar(await gerado("conteúdo original"), {
      origem: "AUTOMATICA",
      criadaEm: CRIADA_EM,
      prova: PROVADA,
    });
    await writeFile(join(pasta, guardada.nome), "outro");

    const [lida] = await copias.listar();

    expect(lida?.prova.restaurou).toBe(false);
    expect(lida?.prova.restaurou === false && lida.prova.motivo).toContain(
      "o arquivo mudou de tamanho depois de conferido",
    );
  });

  it("apaga o arquivo e a ficha; e apagar o que não existe não é erro", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const guardada = await copias.guardar(await gerado(), {
      origem: "AUTOMATICA",
      criadaEm: CRIADA_EM,
      prova: PROVADA,
    });

    await copias.apagar(guardada.nome);
    await copias.apagar(guardada.nome);

    expect(await copias.listar()).toEqual([]);
    expect(await readdirSeguro(pasta)).toEqual([".em-andamento"]);
  });

  it("🔑 apagar nunca lança — o arquivo preso sai na próxima vez", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    // Uma pasta com o nome da ficha: o `rm` sem `recursive` recusa.
    await mkdir(join(pasta, "copia-20261017-140000-manual.json", "dentro"), {
      recursive: true,
    });

    await expect(
      copias.apagar("copia-20261017-140000-manual.dump"),
    ).resolves.toBeUndefined();
  });

  it("antes da primeira cópia, a pasta nem existe — e a lista é vazia", async () => {
    expect(await new PastaDeCopiasNoDisco(join(pasta, "ainda-nao")).listar()).toEqual([]);
  });

  it("🔑 a pasta que existe mas não abre é erro, e não lista vazia", async () => {
    const arquivo = join(pasta, "nao-e-pasta");
    await writeFile(arquivo, "x");

    await expect(new PastaDeCopiasNoDisco(arquivo).listar()).rejects.toThrow();
  });

  it("a ficha de antes dos caixas abertos no resumo continua valendo", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const guardada = await copias.guardar(await gerado(), {
      origem: "AUTOMATICA",
      criadaEm: CRIADA_EM,
      prova: PROVADA,
    });
    const caminhoDaFicha = join(pasta, "copia-20261017-140000-automatica.json");
    const ficha = JSON.parse(await readFile(caminhoDaFicha, "utf8")) as {
      prova: { resumo: Record<string, unknown> };
    };
    delete ficha.prova.resumo["caixasAbertos"];
    await writeFile(caminhoDaFicha, JSON.stringify(ficha));

    const [lida] = await copias.listar();

    expect(lida?.nome).toBe(guardada.nome);
    expect(lida?.prova.restaurou === true && lida.prova.resumo.caixasAbertos).toBe(0);
  });

  it("a cópia sem resumo de período volta sem datas", async () => {
    const copias = new PastaDeCopiasNoDisco(pasta);
    const semVendas: ProvaDaCopia = {
      restaurou: true,
      resumo: { vendas: 0, produtos: 0, clientes: 0, caixasAbertos: 0, migracoes: [] },
    };

    await copias.guardar(await gerado(), {
      origem: "MANUAL",
      criadaEm: CRIADA_EM,
      prova: semVendas,
    });

    const [lida] = await copias.listar();
    expect(lida?.prova).toEqual(semVendas);
  });
});

describe("as ferramentas", () => {
  it("🔑 a senha vai em variável de ambiente, nunca na linha de comando", () => {
    expect(
      conexaoDe("postgresql://erp:s%40nha@127.0.0.1:5433/erp_pdv?schema=public"),
    ).toEqual({
      banco: "erp_pdv",
      variaveis: {
        PGHOST: "127.0.0.1",
        PGPORT: "5433",
        PGUSER: "erp",
        PGPASSWORD: "s@nha",
      },
    });
  });

  it("porta padrão, IPv6, soquete e SSL", () => {
    expect(conexaoDe("postgresql://erp@[::1]/erp_pdv").variaveis).toEqual({
      PGHOST: "::1",
      PGPORT: "5432",
      PGUSER: "erp",
    });
    expect(
      conexaoDe(
        "postgresql://erp@localhost/erp_pdv?host=/var/run/postgresql&sslmode=require",
      ).variaveis,
    ).toMatchObject({ PGHOST: "/var/run/postgresql", PGSSLMODE: "require" });
  });

  it("no Windows, o programa é o .exe da pasta da instalação", () => {
    expect(programa("pg_dump", "C:\\ERP\\postgres\\bin", "win32")).toMatch(
      /pg_dump\.exe$/,
    );
    expect(programa("psql", undefined, "linux")).toBe("psql");
    expect(programa("pg_restore", "/opt/pg/bin", "linux")).toBe("/opt/pg/bin/pg_restore");
  });

  it("o detalhe é o fim da saída de erro — ou a mensagem, quando ela está vazia", () => {
    expect(
      detalheDe(new FalhaDeFerramenta("pg_dump", "falhou", "  erro de verdade \n")),
    ).toBe("erro de verdade");
    expect(detalheDe(new FalhaDeFerramenta("pg_dump", "spawn ENOENT", ""))).toBe(
      "spawn ENOENT",
    );
    expect(detalheDe(new Error("outro"))).toBe("outro");
    expect(detalheDe("texto solto")).toBe("texto solto");

    const comprido = detalheDe(new FalhaDeFerramenta("x", "y", "z".repeat(1000)));
    expect(comprido).toHaveLength(401);
    expect(comprido.startsWith("…")).toBe(true);
  });

  it("a ferramenta que sai com erro rejeita com a saída de erro dela", async () => {
    await expect(
      executar(programa("psql", PASTA_BINARIOS), ["--no-psqlrc", "--command=SELEC 1"], {
        variaveis: conexaoDe(URL).variaveis,
        tempoLimiteMs: 60_000,
      }),
    ).rejects.toBeInstanceOf(FalhaDeFerramenta);
  });
});

function nomeDe(gerado: ArquivoGerado): string {
  return gerado.caminho.split(/[\\/]/).at(-1) ?? "";
}

async function readdirSeguro(caminho: string): Promise<readonly string[]> {
  try {
    return (await readdir(caminho)).sort();
  } catch {
    return [];
  }
}

async function basesDeProva(): Promise<readonly string[]> {
  const linhas = await administrador.$queryRawUnsafe<{ readonly datname: string }[]>(
    "SELECT datname FROM pg_database WHERE starts_with(datname, 'erp_prova_') ORDER BY 1",
  );
  return linhas.map((linha) => linha.datname);
}
