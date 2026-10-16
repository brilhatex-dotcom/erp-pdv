import type {
  AuditoriaRepository,
  ConfiguracaoLojaRepository,
  DevolucaoRepository,
  ImagemParaGravar,
  ImagemRepository,
  RegistroAuditoria,
} from "@erp/application";
import {
  type ConteudoBalanca,
  ConfiguracaoLoja,
  Devolucao,
  type DestinoDevolucao,
  ehDestinoDevolucao,
  ehFormaReembolso,
  ehImpressaoComprovante,
  ehLarguraCupom,
  ehRecurso,
  ehRegraVendaSemEstoque,
  ehSegmento,
  type FormaReembolso,
  type Identificador,
  type Recurso,
} from "@erp/domain";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import {
  paraDinheiro,
  paraId,
  paraIdOpcional,
  paraQuantidade,
} from "../mapeadores/comuns.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

// ── Configuração da loja ────────────────────────────────────────────────

/**
 * A configuração da instalação — uma linha, garantida por índice único como a
 * empresa (ADR-0024).
 *
 * Os valores enumerados ficam em texto no banco (com CHECK), e voltam
 * conferidos: um valor que o domínio não conhece é linha corrompida, e
 * reconstruir com ele faria a tela do caixa decidir por um recurso que não
 * existe.
 */
export class ConfiguracaoLojaRepositorioPrisma implements ConfiguracaoLojaRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async atual(): Promise<ConfiguracaoLoja | undefined> {
    const linha = await this.prisma.configuracaoLoja.findUnique({
      where: { unica: true },
    });

    return linha === null ? undefined : paraConfiguracao(linha);
  }

  async salvar(configuracao: ConfiguracaoLoja): Promise<void> {
    const layout = configuracao.layoutBalanca;

    const dados = {
      segmento: configuracao.segmento,
      recursos: [...configuracao.recursos],
      vendaSemEstoque: configuracao.vendaSemEstoque,
      larguraCupom: configuracao.larguraCupom,
      impressaoComprovante: configuracao.impressaoComprovante,
      balancaPrefixos: [...layout.prefixos],
      balancaTamanhoCodigo: layout.tamanhoCodigoProduto,
      balancaConteudo: layout.conteudo,
      balancaCasasDecimais: layout.casasDecimais,
    };

    await this.prisma.configuracaoLoja.upsert({
      where: { id: configuracao.id.valor },
      create: { id: configuracao.id.valor, ...dados },
      update: dados,
    });
  }
}

function paraConfiguracao(linha: {
  readonly id: string;
  readonly segmento: string;
  readonly recursos: readonly string[];
  readonly vendaSemEstoque: string;
  readonly larguraCupom: number;
  readonly impressaoComprovante: string;
  readonly balancaPrefixos: readonly string[];
  readonly balancaTamanhoCodigo: number;
  readonly balancaConteudo: string;
  readonly balancaCasasDecimais: number;
}): ConfiguracaoLoja {
  const { segmento, vendaSemEstoque, larguraCupom, impressaoComprovante } = linha;

  if (
    !ehSegmento(segmento) ||
    !ehRegraVendaSemEstoque(vendaSemEstoque) ||
    !ehLarguraCupom(larguraCupom) ||
    !ehImpressaoComprovante(impressaoComprovante) ||
    !ehConteudoBalanca(linha.balancaConteudo)
  ) {
    throw new Error(`Configuração da loja com valor desconhecido no banco: ${linha.id}`);
  }

  return ConfiguracaoLoja.reconstituir({
    id: paraId(linha.id),
    segmento,
    recursos: linha.recursos.filter((recurso): recurso is Recurso => ehRecurso(recurso)),
    vendaSemEstoque,
    larguraCupom,
    impressaoComprovante,
    layoutBalanca: {
      prefixos: [...linha.balancaPrefixos],
      tamanhoCodigoProduto: linha.balancaTamanhoCodigo,
      conteudo: linha.balancaConteudo,
      casasDecimais: linha.balancaCasasDecimais,
    },
  });
}

function ehConteudoBalanca(valor: string): valor is ConteudoBalanca {
  return valor === "PESO" || valor === "PRECO";
}

// ── Devolução ───────────────────────────────────────────────────────────

const COM_ITENS = { itens: { orderBy: { numeroItem: "asc" } } } as const;

/**
 * Devoluções em disco. **Só insere**: o gatilho do banco recusa `UPDATE` e
 * `DELETE` em `devolucoes` e `devolucao_itens`, e este repositório não tenta.
 */
export class DevolucaoRepositorioPrisma implements DevolucaoRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porVenda(vendaId: Identificador): Promise<readonly Devolucao[]> {
    const linhas = await this.prisma.devolucao.findMany({
      where: { vendaId: vendaId.valor },
      include: COM_ITENS,
      // Desempate pelo id (UUIDv7): duas devoluções no mesmo milissegundo
      // voltariam em ordem do plano de execução (`ESTADO.md` §3).
      orderBy: [{ ocorridaEm: "asc" }, { id: "asc" }],
    });

    return linhas.map(paraDevolucao);
  }

  async salvar(devolucao: Devolucao): Promise<void> {
    await this.prisma.devolucao.create({
      data: {
        id: devolucao.id.valor,
        vendaId: devolucao.vendaId.valor,
        numeroVenda: devolucao.numeroVenda,
        formaReembolso: devolucao.formaReembolso,
        motivo: devolucao.motivo,
        usuarioId: devolucao.usuarioId.valor,
        autorizadoPorId: devolucao.autorizadoPorId?.valor ?? null,
        sessaoCaixaId: devolucao.sessaoCaixaId?.valor ?? null,
        ocorridaEm: devolucao.ocorridaEm,
        itens: {
          create: devolucao.itens.map((item) => ({
            numeroItem: item.numeroItem,
            produtoId: item.produtoId.valor,
            descricao: item.descricao,
            quantidade: item.quantidade.milesimos,
            unidade: item.quantidade.unidade.codigo,
            valor: item.valor.centavos,
            destino: item.destino,
          })),
        },
      },
    });
  }
}

function paraDevolucao(linha: {
  readonly id: string;
  readonly vendaId: string;
  readonly numeroVenda: number;
  readonly formaReembolso: string;
  readonly motivo: string;
  readonly usuarioId: string;
  readonly autorizadoPorId: string | null;
  readonly sessaoCaixaId: string | null;
  readonly ocorridaEm: Date;
  readonly itens: readonly {
    readonly numeroItem: number;
    readonly produtoId: string;
    readonly descricao: string;
    readonly quantidade: bigint;
    readonly unidade: string;
    readonly valor: bigint;
    readonly destino: string;
  }[];
}): Devolucao {
  return Devolucao.reconstituir({
    id: paraId(linha.id),
    vendaId: paraId(linha.vendaId),
    numeroVenda: linha.numeroVenda,
    formaReembolso: paraFormaReembolso(linha.formaReembolso),
    motivo: linha.motivo,
    usuarioId: paraId(linha.usuarioId),
    autorizadoPorId: paraIdOpcional(linha.autorizadoPorId),
    sessaoCaixaId: paraIdOpcional(linha.sessaoCaixaId),
    ocorridaEm: linha.ocorridaEm,
    itens: linha.itens.map((item) => ({
      numeroItem: item.numeroItem,
      produtoId: paraId(item.produtoId),
      descricao: item.descricao,
      quantidade: paraQuantidade(item.quantidade, item.unidade),
      valor: paraDinheiro(item.valor),
      destino: paraDestino(item.destino),
    })),
  });
}

function paraFormaReembolso(valor: string): FormaReembolso {
  if (!ehFormaReembolso(valor)) {
    throw new Error(`Forma de reembolso desconhecida no banco: ${valor}`);
  }

  return valor;
}

function paraDestino(valor: string): DestinoDevolucao {
  if (!ehDestinoDevolucao(valor)) {
    throw new Error(`Destino de devolução desconhecido no banco: ${valor}`);
  }

  return valor;
}

// ── Auditoria ───────────────────────────────────────────────────────────

/** Só grava. Quem lê a auditoria é a consulta da retaguarda. */
export class AuditoriaRepositorioPrisma implements AuditoriaRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    await this.prisma.registroAuditoria.create({
      data: {
        id: registro.id.valor,
        ocorridoEm: registro.ocorridoEm,
        acao: registro.acao,
        usuarioId: registro.usuarioId?.valor ?? null,
        autorizadoPorId: registro.autorizadoPorId?.valor ?? null,
        descricao: registro.descricao,
        entidade: registro.entidade ?? null,
        entidadeId: registro.entidadeId?.valor ?? null,
        ...(registro.dados === undefined ? {} : { dados: { ...registro.dados } }),
      },
    });
  }
}

// ── Imagens ─────────────────────────────────────────────────────────────

export class ImagemRepositorioPrisma implements ImagemRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porHash(hash: string): Promise<Identificador | undefined> {
    const linha = await this.prisma.imagem.findUnique({
      where: { hash },
      select: { id: true },
    });

    return linha === null ? undefined : paraId(linha.id);
  }

  async existe(id: Identificador): Promise<boolean> {
    const total = await this.prisma.imagem.count({ where: { id: id.valor } });

    return total > 0;
  }

  async salvar(imagem: ImagemParaGravar): Promise<void> {
    await this.prisma.imagem.create({
      data: {
        id: imagem.id.valor,
        tipo: imagem.tipo,
        conteudo: Buffer.from(imagem.conteudo),
        bytes: imagem.conteudo.length,
        hash: imagem.hash,
      },
    });
  }
}
