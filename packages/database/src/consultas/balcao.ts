import type { Venda } from "@erp/domain";

import type { PrismaClient } from "../gerado/index.js";
import { paraDominio } from "../mapeadores/vendaMapeador.js";

/**
 * Leituras do balcão que não são operação: achar a venda do cupom que o
 * cliente trouxe, montar os botões rápidos, listar a auditoria.
 */

// ── Vendas recentes ─────────────────────────────────────────────────────

export interface VendaComNomes {
  /**
   * O agregado inteiro, e não uma projeção: o total de uma venda é a soma dos
   * itens **com o arredondamento do domínio**, e refazer essa conta em SQL
   * criaria um segundo lugar onde ela existe — que diverge do cupom no
   * primeiro centavo.
   */
  readonly venda: Venda;
  readonly operadorNome: string;
  readonly clienteNome?: string | undefined;
}

export interface FiltroVendasRecentes {
  /** O número impresso no cupom. A série é por estação, então pode repetir. */
  readonly numero?: number | undefined;
  readonly estacaoId?: string | undefined;
  readonly limite?: number | undefined;
}

const LIMITE_VENDAS = 20;

/**
 * Vendas concluídas ou canceladas, da mais recente para a mais antiga.
 *
 * Serve à reimpressão ("o cupom da venda de agora há pouco") e à devolução
 * ("o cliente trouxe o cupom 1532"). O número sozinho pode achar mais de uma
 * venda — uma por estação —, e a tela mostra todas com a data, para o
 * operador escolher a do cupom.
 */
export async function vendasRecentes(
  prisma: PrismaClient,
  filtro: FiltroVendasRecentes,
): Promise<readonly VendaComNomes[]> {
  const linhas = await prisma.venda.findMany({
    where: {
      status: { in: ["FINALIZADA", "CANCELADA"] },
      finalizadaEm: { not: null },
      ...(filtro.numero === undefined ? {} : { numero: filtro.numero }),
      ...(filtro.estacaoId === undefined ? {} : { estacaoId: filtro.estacaoId }),
    },
    include: { itens: true, pagamentos: true },
    // `idx_vendas_finalizada` cobre a ordenação; o número, quando há, reduz a
    // poucas linhas antes de ordenar.
    orderBy: [{ finalizadaEm: "desc" }, { id: "desc" }],
    take: Math.min(filtro.limite ?? LIMITE_VENDAS, LIMITE_VENDAS),
  });

  if (linhas.length === 0) return [];

  const nomes = await nomesDe(
    prisma,
    linhas.map((linha) => linha.operadorId),
    linhas.flatMap((linha) => (linha.clienteId === null ? [] : [linha.clienteId])),
  );

  return linhas.map((linha) => ({
    venda: paraDominio(linha),
    operadorNome: nomes.usuarios.get(linha.operadorId) ?? "—",
    clienteNome:
      linha.clienteId === null ? undefined : nomes.clientes.get(linha.clienteId),
  }));
}

async function nomesDe(
  prisma: PrismaClient,
  usuarioIds: readonly string[],
  clienteIds: readonly string[],
): Promise<{
  readonly usuarios: ReadonlyMap<string, string>;
  readonly clientes: ReadonlyMap<string, string>;
}> {
  const [usuarios, clientes] = await Promise.all([
    prisma.usuario.findMany({
      where: { id: { in: [...new Set(usuarioIds)] } },
      select: { id: true, nome: true },
    }),
    clienteIds.length === 0
      ? Promise.resolve([])
      : prisma.cliente.findMany({
          where: { id: { in: [...new Set(clienteIds)] } },
          select: { id: true, nome: true },
        }),
  ]);

  return {
    usuarios: new Map(usuarios.map((usuario) => [usuario.id, usuario.nome])),
    clientes: new Map(clientes.map((cliente) => [cliente.id, cliente.nome])),
  };
}

// ── Mais vendidos ───────────────────────────────────────────────────────

export interface ProdutoMaisVendido {
  readonly produtoId: string;
  /** Em quantas vendas apareceu — e não a quantidade somada. */
  readonly vendas: number;
}

/**
 * Os produtos que mais aparecem nas vendas desde uma data.
 *
 * Conta **vendas**, e não quantidade: 30 kg de batata numa venda de atacado
 * não fazem da batata o produto mais pedido do balcão; o pão de todo cliente,
 * sim. É o critério que decide quais botões economizam mais toques.
 */
export async function maisVendidos(
  prisma: PrismaClient,
  filtro: { readonly desde: Date; readonly limite: number },
): Promise<readonly ProdutoMaisVendido[]> {
  const linhas = await prisma.$queryRaw<{ produto_id: string; vendas: number }[]>`
    SELECT vi.produto_id, COUNT(DISTINCT vi.venda_id)::int AS vendas
      FROM venda_itens vi
      JOIN vendas v ON v.id = vi.venda_id
      JOIN produtos p ON p.id = vi.produto_id
     WHERE v.status = 'FINALIZADA'
       AND v.finalizada_em >= ${filtro.desde}
       AND p.ativo
     GROUP BY vi.produto_id
     ORDER BY vendas DESC, vi.produto_id
     LIMIT ${filtro.limite}
  `;

  return linhas.map((linha) => ({ produtoId: linha.produto_id, vendas: linha.vendas }));
}

// ── Auditoria ───────────────────────────────────────────────────────────

export interface RegistroNaLista {
  readonly id: string;
  readonly ocorridoEm: string;
  readonly acao: string;
  readonly descricao: string;
  readonly usuarioNome?: string | undefined;
  readonly autorizadoPorNome?: string | undefined;
  readonly entidade?: string | undefined;
  readonly entidadeId?: string | undefined;
}

export interface FiltroAuditoria {
  readonly de: Date;
  /** Exclusivo. */
  readonly ate: Date;
  readonly acao?: string | undefined;
  readonly usuarioId?: string | undefined;
  readonly limite?: number | undefined;
}

const LIMITE_AUDITORIA = 200;

/**
 * A auditoria como o dono lê: quem, quando, o quê — e quem liberou.
 *
 * Mais recente primeiro. Os índices `idx_auditoria_*` cobrem cada filtro com
 * a data como segunda coluna.
 */
export async function registrosDeAuditoria(
  prisma: PrismaClient,
  filtro: FiltroAuditoria,
): Promise<readonly RegistroNaLista[]> {
  const linhas = await prisma.registroAuditoria.findMany({
    where: {
      ocorridoEm: { gte: filtro.de, lt: filtro.ate },
      ...(filtro.acao === undefined ? {} : { acao: filtro.acao }),
      ...(filtro.usuarioId === undefined ? {} : { usuarioId: filtro.usuarioId }),
    },
    include: {
      usuario: { select: { nome: true } },
      autorizadoPor: { select: { nome: true } },
    },
    orderBy: [{ ocorridoEm: "desc" }, { id: "desc" }],
    take: Math.min(filtro.limite ?? LIMITE_AUDITORIA, LIMITE_AUDITORIA),
  });

  return linhas.map((linha) => ({
    id: linha.id,
    ocorridoEm: linha.ocorridoEm.toISOString(),
    acao: linha.acao,
    descricao: linha.descricao,
    usuarioNome: linha.usuario?.nome,
    autorizadoPorNome: linha.autorizadoPor?.nome,
    entidade: linha.entidade ?? undefined,
    entidadeId: linha.entidadeId ?? undefined,
  }));
}
