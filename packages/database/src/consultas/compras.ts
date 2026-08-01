import type { PrismaClient } from "../gerado/index.js";

/**
 * As notas de entrada como o comprador precisa vê-las.
 *
 * Projeção de leitura, não repositório: a lista mostra vinte linhas, e
 * reconstituir vinte agregados com todos os seus itens para isso cobraria caro
 * por nada. O agregado entra em cena quando se abre uma nota.
 *
 * O **total é recalculado** a partir dos itens, e não lido de
 * `total_declarado`: o declarado é o que a pessoa digitou do papel, e a nota só
 * existe porque os dois batem. Mostrar o declarado seria exibir a cópia em vez
 * do original.
 */

export interface NotaNaLista {
  readonly id: string;
  readonly numero: string;
  readonly serie?: string | undefined;
  readonly fornecedorId: string;
  readonly fornecedorNome: string;
  readonly emitidaEm: string;
  readonly recebidaEm: string;
  /** Centavos em texto — dinheiro nunca vira número (ADR-0019). */
  readonly total: string;
  readonly quantidadeItens: number;
  readonly status: "LANCADA" | "CANCELADA";
  readonly usuarioNome: string;
  readonly motivoCancelamento?: string | undefined;
}

export interface FiltroNotas {
  /** Número da nota ou parte do nome do fornecedor. */
  readonly termo?: string | undefined;
  readonly fornecedorId?: string | undefined;
  readonly incluirCanceladas?: boolean | undefined;
  readonly limite: number;
}

export async function notasDeCompra(
  prisma: PrismaClient,
  filtro: FiltroNotas,
): Promise<readonly NotaNaLista[]> {
  const termo = (filtro.termo ?? "").trim();

  const linhas = await prisma.notaDeCompra.findMany({
    where: {
      ...(filtro.incluirCanceladas === true ? {} : { status: "LANCADA" as const }),
      ...(filtro.fornecedorId === undefined ? {} : { fornecedorId: filtro.fornecedorId }),
      ...(termo === ""
        ? {}
        : {
            OR: [
              { numero: { contains: termo } },
              { fornecedor: { razaoSocial: { contains: termo, mode: "insensitive" } } },
            ],
          }),
    },
    include: {
      fornecedor: { select: { razaoSocial: true, nomeFantasia: true } },
      itens: { select: { quantidade: true, custoUnitario: true, desconto: true } },
    },
    // Mais recente primeiro: é a nota que está sendo conferida agora.
    orderBy: { recebidaEm: "desc" },
    take: filtro.limite,
  });

  if (linhas.length === 0) return [];

  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: [...new Set(linhas.map((linha) => linha.usuarioId))] } },
    select: { id: true, nome: true },
  });

  const nomePorId = new Map(usuarios.map((usuario) => [usuario.id, usuario.nome]));

  return linhas.map((linha) => ({
    id: linha.id,
    numero: linha.numero,
    serie: linha.serie === "" ? undefined : linha.serie,
    fornecedorId: linha.fornecedorId,
    fornecedorNome: linha.fornecedor.nomeFantasia ?? linha.fornecedor.razaoSocial,
    emitidaEm: linha.emitidaEm.toISOString(),
    recebidaEm: linha.recebidaEm.toISOString(),
    total: somar(linha.itens).toString(),
    quantidadeItens: linha.itens.length,
    status: linha.status,
    usuarioNome: nomePorId.get(linha.usuarioId) ?? "—",
    motivoCancelamento: linha.motivoCancelamento ?? undefined,
  }));
}

/**
 * Soma as linhas em centavos inteiros.
 *
 * `custo × milésimos ÷ 1000` em `bigint`: o mesmo cálculo do domínio, feito
 * aqui porque a projeção não reconstitui agregados. Passar por `number` no
 * caminho reintroduziria o `double` que o ADR-0009 proíbe.
 */
function somar(
  itens: readonly {
    readonly quantidade: bigint;
    readonly custoUnitario: bigint;
    readonly desconto: bigint;
  }[],
): bigint {
  return itens.reduce(
    (total, item) =>
      total + (item.custoUnitario * item.quantidade) / 1000n - item.desconto,
    0n,
  );
}
