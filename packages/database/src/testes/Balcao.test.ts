import {
  CodigoBarras,
  ConfiguracaoLoja,
  Devolucao,
  Dinheiro,
  Identificador,
  Produto,
  Quantidade,
  SessaoCaixa,
  Venda,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  maisVendidos,
  registrosDeAuditoria,
  vendasRecentes,
} from "../consultas/balcao.js";
import {
  AuditoriaRepositorioPrisma,
  ConfiguracaoLojaRepositorioPrisma,
  DevolucaoRepositorioPrisma,
  ImagemRepositorioPrisma,
} from "../repositorios/BalcaoRepositoriosPrisma.js";
import { CaixaRepositorioPrisma } from "../repositorios/CaixaRepositorioPrisma.js";
import { ProdutoRepositorioPrisma } from "../repositorios/ProdutoRepositorioPrisma.js";
import { VendaRepositorioPrisma } from "../repositorios/VendaRepositorioPrisma.js";
import {
  criarClienteDeTeste,
  garantirUsuario,
  limparBanco,
  prepararBanco,
} from "./banco.js";

/**
 * O que o balcão grava, de volta como foi gravado.
 *
 * Cada campo novo da venda — guardada, cancelada, pagamento com chave e
 * confirmação, custo congelado no item — passa por coluna, CHECK e mapeador.
 * Um campo que se perde no caminho só apareceria no relatório do mês, como
 * margem errada ou cancelamento sem responsável.
 */

const prisma = criarClienteDeTeste();

function id(sufixo: string): Identificador {
  return Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-1c2d3e6b${sufixo}`).unwrap();
}

const ESTACAO = id("0001");
const OPERADOR = id("0002");
const SUPERVISOR = id("0003");
const CAIXA = id("0004");
const PRODUTO = id("0005");
const AGORA = new Date("2026-08-01T10:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;
  return id(`9${sequencia.toString().padStart(3, "0")}`);
}

beforeAll(() => {
  prepararBanco();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
  await garantirUsuario(prisma, OPERADOR.valor, "42");
  await garantirUsuario(prisma, SUPERVISOR.valor, "7");

  await new ProdutoRepositorioPrisma(prisma).salvar(
    Produto.criar({
      id: PRODUTO,
      sku: "BOL001",
      descricao: "Bolo de Fubá",
      tipo: "UNITARIO",
      unidadeBase: "UN",
      precoVenda: reais("12,50"),
      codigoBarras: CodigoBarras.criar("7891000315507").unwrap(),
    }).unwrap(),
  );

  await new CaixaRepositorioPrisma(prisma).salvar(
    SessaoCaixa.abrir({
      id: CAIXA,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
      abertaEm: AGORA,
    }).unwrap(),
  );
});

async function vendaComBolo(numero = 1, unidades = "2"): Promise<Venda> {
  const venda = Venda.iniciar({
    id: proximoId(),
    numero,
    sessaoCaixaId: CAIXA,
    operadorId: OPERADOR,
    estacaoId: ESTACAO,
    abertaEm: AGORA,
  }).unwrap();

  venda
    .adicionarItem({
      produtoId: PRODUTO,
      descricao: "Bolo de Fubá",
      quantidade: Quantidade.de(unidades, "UN").unwrap(),
      precoUnitario: reais("12,50"),
      custoUnitario: reais("7,30"),
    })
    .unwrap();

  return venda;
}

async function recarregar(venda: Venda): Promise<Venda> {
  const lida = await new VendaRepositorioPrisma(prisma).porId(venda.id);
  if (lida === undefined) throw new Error("a venda sumiu do banco");
  return lida;
}

describe("Venda — o que o balcão grava", () => {
  it("🔑 a venda guardada volta guardada, com o rótulo e o custo congelado", async () => {
    const venda = await vendaComBolo();
    venda.suspender(AGORA, "Dona Maria").unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(venda);

    const lida = await recarregar(venda);

    expect(lida.estaSuspensa).toBe(true);
    expect(lida.suspensao?.rotulo).toBe("Dona Maria");
    expect(lida.itens[0]?.custoUnitario?.formatar()).toBe("R$ 7,30");
  });

  it("🔑 o pagamento volta com confirmação, chave, autorização e parcelas", async () => {
    const venda = await vendaComBolo();
    venda.registrarPagamento("PIX", reais("5,00"), { chave: "pix-0001" }).unwrap();
    venda
      .registrarPagamento("CARTAO_CREDITO", reais("20,00"), {
        autorizacao: "123456",
        parcelas: 2,
      })
      .unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(venda);

    const [pix, cartao] = (await recarregar(venda)).pagamentos;

    expect(pix?.confirmacao).toBe("MANUAL");
    expect(pix?.chave).toBe("pix-0001");
    expect(cartao?.autorizacao).toBe("123456");
    expect(cartao?.parcelas).toBe(2);
  });

  it("🔑 o cancelamento volta com motivo, quem pediu e quem liberou", async () => {
    const repositorio = new VendaRepositorioPrisma(prisma);
    const venda = await vendaComBolo();
    venda.registrarPagamento("PIX", reais("25,00")).unwrap();
    venda.finalizar(AGORA).unwrap();
    await repositorio.salvar(venda);

    venda
      .cancelar({
        motivo: "Cliente desistiu",
        solicitadoPorId: OPERADOR,
        autorizadoPorId: SUPERVISOR,
        agora: AGORA,
      })
      .unwrap();
    await repositorio.salvar(venda);

    const lida = await recarregar(venda);

    expect(lida.status).toBe("CANCELADA");
    expect(lida.foiCanceladaAposFinalizar).toBe(true);
    expect(lida.cancelamento?.motivo).toBe("Cliente desistiu");
    expect(lida.cancelamento?.solicitadoPorId.equals(OPERADOR)).toBe(true);
    expect(lida.cancelamento?.autorizadoPorId?.equals(SUPERVISOR)).toBe(true);
    // Os itens e o pagamento são o fato do balcão: continuam lá.
    expect(lida.itens).toHaveLength(1);
    expect(lida.pagamentos).toHaveLength(1);
  });

  it("guardada sem rótulo volta sem rótulo", async () => {
    const venda = await vendaComBolo();
    venda.suspender(AGORA).unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(venda);

    const lida = await recarregar(venda);

    expect(lida.estaSuspensa).toBe(true);
    expect(lida.suspensao?.rotulo).toBeUndefined();
  });

  it("🔑 o banco recusa cancelamento sem motivo — nem um script de suporte grava", async () => {
    const venda = await vendaComBolo();
    await new VendaRepositorioPrisma(prisma).salvar(venda);

    await expect(
      prisma.venda.update({
        where: { id: venda.id.valor },
        data: { status: "CANCELADA", canceladaEm: AGORA, canceladaPorId: OPERADOR.valor },
      }),
    ).rejects.toThrow();
  });

  it("🔑 forma de pagamento que o sistema não conhece é linha corrompida — erro, não palpite", async () => {
    const venda = await vendaComBolo();
    venda.registrarPagamento("PIX", reais("5,00")).unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(venda);
    await prisma.$executeRawUnsafe(
      `UPDATE pagamentos SET forma = 'BOLETO' WHERE venda_id = $1::uuid`,
      venda.id.valor,
    );

    await expect(new VendaRepositorioPrisma(prisma).porId(venda.id)).rejects.toThrow(
      "Forma de pagamento desconhecida",
    );
  });

  it("venda cancelada antes desta versão volta sem um responsável inventado", async () => {
    const venda = await vendaComBolo();
    await new VendaRepositorioPrisma(prisma).salvar(venda);
    await prisma.venda.update({
      where: { id: venda.id.valor },
      data: { status: "CANCELADA" },
    });

    const lida = await recarregar(venda);

    expect(lida.status).toBe("CANCELADA");
    expect(lida.cancelamento).toBeUndefined();
  });

  it("🔑 o banco recusa venda guardada que não está aberta", async () => {
    const venda = await vendaComBolo();
    venda.suspender(AGORA).unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(venda);

    await expect(
      prisma.venda.update({
        where: { id: venda.id.valor },
        data: { status: "FINALIZADA", finalizadaEm: AGORA },
      }),
    ).rejects.toThrow();
  });

  it("lista as abertas da sessão, da mais antiga para a mais nova", async () => {
    const repositorio = new VendaRepositorioPrisma(prisma);
    const primeira = await vendaComBolo(1);
    const segunda = await vendaComBolo(2);
    const concluida = await vendaComBolo(3);
    concluida.registrarPagamento("PIX", reais("25,00")).unwrap();
    concluida.finalizar(AGORA).unwrap();

    for (const venda of [segunda, primeira, concluida]) await repositorio.salvar(venda);

    const abertas = await repositorio.abertasNaSessao(CAIXA);

    expect(abertas.map((venda) => venda.numero).sort()).toEqual([1, 2]);
  });
});

describe("Produto — reposição, fornecedor, foto e botão", () => {
  it("🔑 os campos novos fazem o caminho de ida e volta", async () => {
    const imagem = proximoId();
    await new ImagemRepositorioPrisma(prisma).salvar({
      id: imagem,
      tipo: "image/png",
      conteudo: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      hash: "a".repeat(64),
    });

    const fornecedor = proximoId();
    await prisma.fornecedor.create({
      data: {
        id: fornecedor.valor,
        razaoSocial: "Moinho Bom Grão Ltda",
        razaoSocialBusca: "moinho bom grao ltda",
        documento: "11222333000181",
      },
    });

    const repositorio = new ProdutoRepositorioPrisma(prisma);
    const produto = (await repositorio.porId(PRODUTO))!;
    produto.definirEstoqueMinimo(Quantidade.de("6", "UN").unwrap()).unwrap();
    produto.definirFornecedor(fornecedor);
    produto.definirImagem(imagem);
    produto.definirBotaoRapido(true);
    await repositorio.salvar(produto);

    const lido = (await repositorio.porId(PRODUTO))!;

    expect(lido.estoqueMinimo?.formatar()).toBe("6 un");
    expect(lido.fornecedorId?.equals(fornecedor)).toBe(true);
    expect(lido.imagemId?.equals(imagem)).toBe(true);
    expect(lido.botaoRapido).toBe(true);
  });
});

describe("Configuração da loja", () => {
  it("🔑 não existe até alguém gravar; gravada, volta igual — logotipo incluído", async () => {
    const repositorio = new ConfiguracaoLojaRepositorioPrisma(prisma);
    expect(await repositorio.atual()).toBeUndefined();

    const logo = proximoId();
    await new ImagemRepositorioPrisma(prisma).salvar({
      id: logo,
      tipo: "image/webp",
      conteudo: new Uint8Array([1, 2, 3]),
      hash: "b".repeat(64),
    });

    const configuracao = ConfiguracaoLoja.padrao(proximoId(), "PADARIA");
    configuracao
      .alterar({
        vendaSemEstoque: "AUTORIZAR",
        larguraCupom: 58,
        logoId: logo,
        layoutBalanca: {
          prefixos: ["2", "21"],
          tamanhoCodigoProduto: 5,
          conteudo: "PRECO",
          casasDecimais: 2,
        },
      })
      .unwrap();
    await repositorio.salvar(configuracao);

    const lida = (await repositorio.atual())!;

    expect(lida.segmento).toBe("PADARIA");
    expect(lida.recursos).toEqual(configuracao.recursos);
    expect(lida.vendaSemEstoque).toBe("AUTORIZAR");
    expect(lida.larguraCupom).toBe(58);
    expect(lida.impressaoComprovante).toBe("SOB_PEDIDO");
    expect(lida.logoId?.equals(logo)).toBe(true);
    expect(lida.layoutBalanca).toEqual({
      prefixos: ["2", "21"],
      tamanhoCodigoProduto: 5,
      conteudo: "PRECO",
      casasDecimais: 2,
    });
  });

  it("gravar de novo atualiza a mesma linha", async () => {
    const repositorio = new ConfiguracaoLojaRepositorioPrisma(prisma);
    const configuracao = ConfiguracaoLoja.padrao(proximoId());
    await repositorio.salvar(configuracao);

    configuracao.alterar({ segmento: "FRUTARIA", recursos: [] }).unwrap();
    await repositorio.salvar(configuracao);

    expect(await prisma.configuracaoLoja.count()).toBe(1);
    expect((await repositorio.atual())?.recursos).toEqual([]);
  });

  it("🔑 o banco recusa uma segunda configuração — uma loja por instalação", async () => {
    const repositorio = new ConfiguracaoLojaRepositorioPrisma(prisma);
    await repositorio.salvar(ConfiguracaoLoja.padrao(proximoId()));

    await expect(
      repositorio.salvar(ConfiguracaoLoja.padrao(proximoId())),
    ).rejects.toThrow();
  });

  it("o banco recusa segmento que o sistema não conhece", async () => {
    const repositorio = new ConfiguracaoLojaRepositorioPrisma(prisma);
    const configuracao = ConfiguracaoLoja.padrao(proximoId());
    await repositorio.salvar(configuracao);

    await expect(
      prisma.configuracaoLoja.update({
        where: { id: configuracao.id.valor },
        data: { segmento: "OFICINA" },
      }),
    ).rejects.toThrow();
  });
});

describe("Devolução", () => {
  async function vendaConcluida(): Promise<Venda> {
    const venda = await vendaComBolo(1, "3");
    venda.registrarPagamento("DINHEIRO", reais("40,00")).unwrap();
    venda.finalizar(AGORA).unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(venda);
    return venda;
  }

  function devolver(venda: Venda, agora: Date, unidades = "1"): Devolucao {
    return Devolucao.registrar({
      id: proximoId(),
      venda,
      itens: [
        {
          numeroItem: 1,
          quantidade: Quantidade.de(unidades, "UN").unwrap(),
          destino: "PERDA",
        },
      ],
      jaDevolvido: new Map(),
      jaReembolsadoAVista: Dinheiro.zero(),
      formaReembolso: "DINHEIRO",
      motivo: "Bolo mofado",
      usuarioId: SUPERVISOR,
      autorizadoPorId: OPERADOR,
      sessaoCaixaId: CAIXA,
      agora,
    }).unwrap();
  }

  it("🔑 volta inteira, com itens, destino e quem autorizou, na ordem em que aconteceu", async () => {
    const venda = await vendaConcluida();
    const repositorio = new DevolucaoRepositorioPrisma(prisma);

    const segunda = devolver(venda, new Date("2026-08-01T11:00:00.000Z"));
    const primeira = devolver(venda, new Date("2026-08-01T10:30:00.000Z"));
    await repositorio.salvar(segunda);
    await repositorio.salvar(primeira);

    const lidas = await repositorio.porVenda(venda.id);

    expect(lidas.map((devolucao) => devolucao.id.valor)).toEqual([
      primeira.id.valor,
      segunda.id.valor,
    ]);
    expect(lidas[0]?.itens[0]?.destino).toBe("PERDA");
    expect(lidas[0]?.itens[0]?.valor.formatar()).toBe("R$ 12,50");
    expect(lidas[0]?.autorizadoPorId?.equals(OPERADOR)).toBe(true);
    expect(lidas[0]?.sessaoCaixaId?.equals(CAIXA)).toBe(true);
    expect(lidas[0]?.numeroVenda).toBe(1);
  });

  it("no Pix e sem liberação, volta sem caixa e sem autorizador", async () => {
    const venda = await vendaConcluida();
    const repositorio = new DevolucaoRepositorioPrisma(prisma);

    await repositorio.salvar(
      Devolucao.registrar({
        id: proximoId(),
        venda,
        itens: [
          {
            numeroItem: 1,
            quantidade: Quantidade.de("1", "UN").unwrap(),
            destino: "ESTOQUE",
          },
        ],
        jaDevolvido: new Map(),
        jaReembolsadoAVista: Dinheiro.zero(),
        formaReembolso: "PIX",
        motivo: "Troca de sabor",
        usuarioId: OPERADOR,
        agora: AGORA,
      }).unwrap(),
    );

    const [lida] = await repositorio.porVenda(venda.id);

    expect(lida?.formaReembolso).toBe("PIX");
    expect(lida?.autorizadoPorId).toBeUndefined();
    expect(lida?.sessaoCaixaId).toBeUndefined();
  });

  it("🔑 devolução gravada não muda nem some — o banco recusa", async () => {
    const venda = await vendaConcluida();
    const devolucao = devolver(venda, AGORA);
    await new DevolucaoRepositorioPrisma(prisma).salvar(devolucao);

    await expect(
      prisma.devolucao.update({
        where: { id: devolucao.id.valor },
        data: { motivo: "outro motivo" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.devolucao.delete({ where: { id: devolucao.id.valor } }),
    ).rejects.toThrow();
  });
});

describe("Auditoria", () => {
  it("🔑 grava com e sem dados, e o registro não muda depois", async () => {
    const repositorio = new AuditoriaRepositorioPrisma(prisma);
    const comDados = proximoId();

    await repositorio.registrar({
      id: comDados,
      ocorridoEm: AGORA,
      acao: "DESCONTO_ITEM",
      usuarioId: OPERADOR,
      autorizadoPorId: SUPERVISOR,
      descricao: "Desconto de R$ 2,50 (20%) no item 1 da venda 7",
      entidade: "venda",
      entidadeId: proximoId(),
      dados: { valor: "250", percentualBps: 2000 },
    });
    await repositorio.registrar({
      id: proximoId(),
      ocorridoEm: AGORA,
      acao: "BACKUP_EXECUTADO",
      descricao: "Backup automático",
    });

    const linhas = await prisma.registroAuditoria.findMany({ orderBy: { id: "asc" } });

    expect(linhas).toHaveLength(2);
    expect(linhas[0]?.dados).toEqual({ valor: "250", percentualBps: 2000 });
    expect(linhas[1]?.usuarioId).toBeNull();

    await expect(
      prisma.registroAuditoria.update({
        where: { id: comDados.valor },
        data: { descricao: "Nada aconteceu" },
      }),
    ).rejects.toThrow();
  });
});

describe("Imagens", () => {
  it("🔑 acha pela impressão digital e diz se existe", async () => {
    const repositorio = new ImagemRepositorioPrisma(prisma);
    const imagem = proximoId();

    await repositorio.salvar({
      id: imagem,
      tipo: "image/jpeg",
      conteudo: new Uint8Array([0xff, 0xd8, 0xff]),
      hash: "c".repeat(64),
    });

    expect((await repositorio.porHash("c".repeat(64)))?.equals(imagem)).toBe(true);
    expect(await repositorio.porHash("d".repeat(64))).toBeUndefined();
    expect(await repositorio.existe(imagem)).toBe(true);
    expect(await repositorio.existe(proximoId())).toBe(false);
  });

  it("o banco recusa tipo que não é imagem", async () => {
    await expect(
      prisma.imagem.create({
        data: {
          id: proximoId().valor,
          tipo: "text/html",
          conteudo: Buffer.from("<script>"),
          bytes: 8,
          hash: "e".repeat(64),
        },
      }),
    ).rejects.toThrow();
  });
});

describe("Consultas do balcão", () => {
  async function concluir(venda: Venda, quando: Date): Promise<void> {
    venda.registrarPagamento("PIX", venda.total).unwrap();
    venda.finalizar(quando).unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(venda);
  }

  it("🔑 vendas recentes: mais nova primeiro, com nomes, e só as que saíram do balcão", async () => {
    const cliente = proximoId();
    await prisma.cliente.create({
      data: {
        id: cliente.valor,
        nome: "Dona Cida",
        nomeBusca: "dona cida",
        tipoPessoa: "FISICA",
      },
    });

    const antiga = await vendaComBolo(1);
    await concluir(antiga, new Date("2026-08-01T10:05:00.000Z"));
    const nova = await vendaComBolo(2);
    nova.identificarCliente(cliente).unwrap();
    await concluir(nova, new Date("2026-08-01T10:10:00.000Z"));
    await new VendaRepositorioPrisma(prisma).salvar(await vendaComBolo(3));

    const recentes = await vendasRecentes(prisma, {});

    expect(recentes.map((atual) => atual.venda.numero)).toEqual([2, 1]);
    expect(recentes[0]?.clienteNome).toBe("Dona Cida");
    expect(recentes[0]?.operadorNome).toBe("Operador de teste");
    expect(recentes[1]?.clienteNome).toBeUndefined();
    expect(recentes[0]?.venda.total.formatar()).toBe("R$ 25,00");

    const doCupom = await vendasRecentes(prisma, { numero: 1, estacaoId: ESTACAO.valor });
    expect(doCupom.map((atual) => atual.venda.numero)).toEqual([1]);

    expect(await vendasRecentes(prisma, { numero: 99 })).toEqual([]);
  });

  it("🔑 mais vendidos contam vendas, não quilos — e ignoram aberta e produto inativo", async () => {
    const refri = proximoId();
    const inativo = proximoId();
    const produtos = new ProdutoRepositorioPrisma(prisma);

    for (const [idProduto, sku, ativo] of [
      [refri, "REF001", true],
      [inativo, "VEL001", false],
    ] as const) {
      const produto = Produto.criar({
        id: idProduto,
        sku,
        descricao: sku,
        tipo: "UNITARIO",
        unidadeBase: "UN",
        precoVenda: reais("5,00"),
      }).unwrap();
      if (!ativo) produto.desativar(AGORA);
      await produtos.salvar(produto);
    }

    const comTudo = await vendaComBolo(1, "30");
    for (const idProduto of [refri, inativo]) {
      comTudo
        .adicionarItem({
          produtoId: idProduto,
          descricao: "x",
          quantidade: Quantidade.de("1", "UN").unwrap(),
          precoUnitario: reais("5,00"),
        })
        .unwrap();
    }
    await concluir(comTudo, AGORA);

    const soBolo = await vendaComBolo(2, "1");
    await concluir(soBolo, AGORA);

    // Aberta não conta: o cliente pode desistir.
    const aberta = await vendaComBolo(3, "1");
    aberta
      .adicionarItem({
        produtoId: refri,
        descricao: "x",
        quantidade: Quantidade.de("1", "UN").unwrap(),
        precoUnitario: reais("5,00"),
      })
      .unwrap();
    await new VendaRepositorioPrisma(prisma).salvar(aberta);

    const ranking = await maisVendidos(prisma, {
      desde: new Date("2026-07-01T00:00:00.000Z"),
      limite: 10,
    });

    expect(ranking).toEqual([
      { produtoId: PRODUTO.valor, vendas: 2 },
      { produtoId: refri.valor, vendas: 1 },
    ]);

    expect(
      await maisVendidos(prisma, {
        desde: new Date("2026-09-01T00:00:00.000Z"),
        limite: 10,
      }),
    ).toEqual([]);
  });

  it("🔑 auditoria com os nomes de quem fez e de quem liberou, filtrável", async () => {
    const repositorio = new AuditoriaRepositorioPrisma(prisma);

    await repositorio.registrar({
      id: proximoId(),
      ocorridoEm: new Date("2026-08-01T09:00:00.000Z"),
      acao: "DESCONTO_ITEM",
      usuarioId: OPERADOR,
      autorizadoPorId: SUPERVISOR,
      descricao: "Desconto de R$ 2,50",
    });
    await repositorio.registrar({
      id: proximoId(),
      ocorridoEm: new Date("2026-08-01T11:00:00.000Z"),
      acao: "SANGRIA",
      usuarioId: SUPERVISOR,
      descricao: "Sangria de R$ 100,00",
      entidade: "sessao_caixa",
      entidadeId: CAIXA,
    });
    await repositorio.registrar({
      id: proximoId(),
      ocorridoEm: new Date("2026-08-02T09:00:00.000Z"),
      acao: "SANGRIA",
      usuarioId: SUPERVISOR,
      descricao: "Outro dia",
    });

    const dia = {
      de: new Date("2026-08-01T00:00:00.000Z"),
      ate: new Date("2026-08-02T00:00:00.000Z"),
    };

    const todos = await registrosDeAuditoria(prisma, dia);
    expect(todos.map((registro) => registro.acao)).toEqual(["SANGRIA", "DESCONTO_ITEM"]);
    expect(todos[1]?.usuarioNome).toBe("Operador de teste");
    expect(todos[1]?.autorizadoPorNome).toBe("Operador de teste");
    expect(todos[0]?.entidadeId).toBe(CAIXA.valor);
    expect(todos[1]?.entidade).toBeUndefined();

    expect(await registrosDeAuditoria(prisma, { ...dia, acao: "SANGRIA" })).toHaveLength(
      1,
    );
    expect(
      await registrosDeAuditoria(prisma, { ...dia, usuarioId: OPERADOR.valor }),
    ).toHaveLength(1);
  });
});
