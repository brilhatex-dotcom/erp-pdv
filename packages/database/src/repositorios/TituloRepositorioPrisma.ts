import type { FiltroTitulos, TituloRepository } from "@erp/application";
import {
  type Baixa,
  type Identificador,
  type OrigemTitulo,
  type TipoTitulo,
  Titulo,
} from "@erp/domain";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import { ouNulo, paraDinheiro, paraId, paraIdOpcional } from "../mapeadores/comuns.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

/**
 * Títulos em disco.
 *
 * ### As baixas são inseridas, nunca atualizadas
 *
 * Um gatilho no banco recusa `UPDATE` e `DELETE` em `baixas_titulo` (princípio
 * 5). Por isso `salvar` faz `createMany` com `skipDuplicates` em vez de apagar
 * e regravar: o agregado devolve a lista inteira a cada gravação, e só as
 * linhas novas descem. Regravar tudo estouraria no gatilho — que é exatamente
 * o que ele existe para fazer.
 *
 * ### Saldo e situação não são lidos do banco
 *
 * Eles não existem lá. Vêm do agregado, calculados a partir das baixas — que é
 * o que impede a coluna de status divergir dos lançamentos.
 */
export class TituloRepositorioPrisma implements TituloRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Titulo | undefined> {
    const linha = await this.prisma.titulo.findUnique({
      where: { id: id.valor },
      include: { baixas: { orderBy: [{ ocorridaEm: "asc" }, { id: "asc" }] } },
    });

    return linha === null ? undefined : paraTitulo(linha);
  }

  async porDocumento(documentoId: Identificador): Promise<readonly Titulo[]> {
    const linhas = await this.prisma.titulo.findMany({
      where: { documentoId: documentoId.valor },
      include: { baixas: { orderBy: [{ ocorridaEm: "asc" }, { id: "asc" }] } },
      orderBy: [{ vencimento: "asc" }, { id: "asc" }],
    });

    return linhas.map(paraTitulo);
  }

  async emAbertoDaContraparte(
    contraparteId: Identificador,
    tipo: TipoTitulo,
  ): Promise<readonly Titulo[]> {
    const linhas = await this.prisma.titulo.findMany({
      // O banco filtra o que ele sabe — cancelado —, e o saldo é conferido
      // depois, no agregado. Somar baixas em SQL duplicaria em outra linguagem
      // a regra que já existe no domínio, e as duas divergiriam no primeiro
      // estorno.
      where: { contraparteId: contraparteId.valor, tipo, canceladoEm: null },
      include: { baixas: { orderBy: [{ ocorridaEm: "asc" }, { id: "asc" }] } },
      orderBy: [{ vencimento: "asc" }, { id: "asc" }],
    });

    return linhas.map(paraTitulo).filter((titulo) => !titulo.estaQuitado);
  }

  async buscar(filtro: FiltroTitulos): Promise<readonly Titulo[]> {
    const linhas = await this.prisma.titulo.findMany({
      where: {
        ...(filtro.tipo === undefined ? {} : { tipo: filtro.tipo }),
        ...(filtro.contraparteId === undefined
          ? {}
          : { contraparteId: filtro.contraparteId.valor }),
        ...(filtro.apenasEmAberto === true ? { canceladoEm: null } : {}),
        ...(filtro.vencidosAte === undefined
          ? {}
          : { vencimento: { lt: filtro.vencidosAte }, canceladoEm: null }),
      },
      include: { baixas: { orderBy: [{ ocorridaEm: "asc" }, { id: "asc" }] } },
      // Vencimento crescente: a tela de cobrança começa por quem está devendo
      // há mais tempo. O id desempata — dois títulos da mesma nota vencem no
      // mesmo dia, e sem desempate a lista muda de ordem entre atualizações.
      orderBy: [{ vencimento: "asc" }, { id: "asc" }],
      // Busca mais do que o pedido porque o filtro de saldo é aplicado fora do
      // banco: sem folga, uma página cheia de quitados devolveria lista vazia.
      take: filtro.apenasEmAberto === true ? filtro.limite * 4 : filtro.limite,
    });

    const titulos = linhas.map(paraTitulo);

    const filtrados =
      filtro.apenasEmAberto === true
        ? titulos.filter((titulo) => !titulo.estaQuitado)
        : titulos;

    return filtrados.slice(0, filtro.limite);
  }

  async salvar(titulo: Titulo): Promise<void> {
    const dados = {
      tipo: titulo.tipo,
      origem: titulo.origem,
      documentoId: ouNulo(titulo.documentoId?.valor),
      contraparteId: ouNulo(titulo.contraparteId?.valor),
      contraparteNome: titulo.contraparteNome,
      valorOriginal: titulo.valorOriginal.centavos,
      vencimento: titulo.vencimento,
      emitidoEm: titulo.emitidoEm,
      parcelaNumero: ouNulo(titulo.parcela?.numero),
      parcelaDe: ouNulo(titulo.parcela?.de),
      descricao: ouNulo(titulo.descricao),
      canceladoEm: ouNulo(titulo.canceladoEm),
      motivoCancelamento: ouNulo(titulo.motivoCancelamento),
    };

    await this.prisma.titulo.upsert({
      where: { id: titulo.id.valor },
      create: { id: titulo.id.valor, ...dados },
      update: dados,
    });

    if (titulo.baixas.length === 0) return;

    await this.prisma.baixaTitulo.createMany({
      data: titulo.baixas.map((baixa) => ({
        id: baixa.id.valor,
        tituloId: titulo.id.valor,
        tipo: baixa.tipo,
        valor: baixa.valor.centavos,
        ocorridaEm: baixa.ocorridaEm,
        usuarioId: baixa.usuarioId.valor,
        forma: ouNulo(baixa.forma),
        observacao: ouNulo(baixa.observacao),
        estornaId: ouNulo(baixa.estornaId?.valor),
      })),
      // As já gravadas são ignoradas. Sem isto, a segunda gravação do mesmo
      // agregado tentaria inserir de novo tudo o que já está lá.
      skipDuplicates: true,
    });
  }
}

/**
 * As colunas como o Prisma as devolve.
 *
 * `tipo` e `origem` são **enums do PostgreSQL**, não texto: o banco recusa
 * qualquer outro valor. Por isso não há tradução defensiva aqui, ao contrário
 * de `EmpresaRepositorioPrisma`, onde o regime é `VarChar` e um valor
 * desconhecido é possível.
 */
interface LinhaBaixa {
  id: string;
  tipo: "PAGAMENTO" | "ESTORNO";
  valor: bigint;
  ocorridaEm: Date;
  usuarioId: string;
  forma: string | null;
  observacao: string | null;
  estornaId: string | null;
}

interface LinhaTitulo {
  id: string;
  tipo: TipoTitulo;
  origem: OrigemTitulo;
  documentoId: string | null;
  contraparteId: string | null;
  contraparteNome: string;
  valorOriginal: bigint;
  vencimento: Date;
  emitidoEm: Date;
  parcelaNumero: number | null;
  parcelaDe: number | null;
  descricao: string | null;
  canceladoEm: Date | null;
  motivoCancelamento: string | null;
  baixas: LinhaBaixa[];
}

function paraTitulo(linha: LinhaTitulo): Titulo {
  return Titulo.reconstituir({
    id: paraId(linha.id),
    tipo: linha.tipo,
    origem: linha.origem,
    documentoId: paraIdOpcional(linha.documentoId),
    contraparteId: paraIdOpcional(linha.contraparteId),
    contraparteNome: linha.contraparteNome,
    valorOriginal: paraDinheiro(linha.valorOriginal),
    vencimento: linha.vencimento,
    emitidoEm: linha.emitidoEm,
    parcela:
      linha.parcelaNumero === null || linha.parcelaDe === null
        ? undefined
        : { numero: linha.parcelaNumero, de: linha.parcelaDe },
    descricao: linha.descricao ?? undefined,
    baixas: linha.baixas.map(paraBaixa),
    canceladoEm: linha.canceladoEm ?? undefined,
    motivoCancelamento: linha.motivoCancelamento ?? undefined,
  });
}

function paraBaixa(linha: LinhaBaixa): Baixa {
  return {
    id: paraId(linha.id),
    tipo: linha.tipo,
    valor: paraDinheiro(linha.valor),
    ocorridaEm: linha.ocorridaEm,
    usuarioId: paraId(linha.usuarioId),
    forma: linha.forma ?? undefined,
    observacao: linha.observacao ?? undefined,
    estornaId: paraIdOpcional(linha.estornaId),
  };
}
