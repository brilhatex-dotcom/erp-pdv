import type { PrismaClient } from "../gerado/index.js";

/**
 * As sessões de caixa como o gerente precisa vê-las.
 *
 * ### Por que é projeção e não repositório
 *
 * `CaixaRepository` devolve o agregado `SessaoCaixa`, com movimentos e
 * recebimentos remontados e validados — o que faz sentido para **operar** sobre
 * ele. Aqui ninguém opera: é uma lista para conferência, e reconstituir
 * agregados de um mês inteiro de sessões para exibir doze linhas de tabela
 * cobraria caro por nada.
 *
 * ### A divergência é recalculada, não lida
 *
 * A tabela guarda o contado; o esperado sai da mesma conta que o domínio faz —
 * fundo + recebido em dinheiro − troco + suprimentos − sangrias. Guardar a
 * divergência como coluna criaria um segundo lugar onde ela existe, e o segundo
 * lugar diverge no primeiro `UPDATE` esquecido.
 *
 * ### Sessão aberta aparece, e sem divergência
 *
 * Ela não foi conferida ainda. Mostrar uma diferença calculada contra contagem
 * nenhuma inventaria uma falta do tamanho da gaveta inteira, todos os dias, em
 * todo caixa aberto.
 */

export interface SessaoDeCaixa {
  readonly id: string;
  readonly estacaoId: string;
  readonly operadorId: string;
  readonly operadorNome: string;
  readonly status: "ABERTA" | "FECHADA";
  readonly abertaEm: string;
  readonly fechadaEm?: string | undefined;
  /** Centavos em texto — dinheiro nunca vira número (ADR-0019). */
  readonly fundoTroco: string;
  readonly recebidoEmDinheiro: string;
  readonly trocoDevolvido: string;
  readonly suprimentos: string;
  readonly sangrias: string;
  readonly esperadoEmDinheiro: string;
  /** Ausente enquanto a sessão está aberta: ninguém contou ainda. */
  readonly contadoEmDinheiro?: string | undefined;
  readonly divergenciaEmDinheiro?: string | undefined;
  readonly totalVendido: string;
  readonly quantidadeVendas: number;
}

export interface FiltroSessoes {
  /** Início do intervalo, inclusivo, comparado com a abertura. */
  readonly de: Date;
  /** Fim do intervalo, exclusivo. */
  readonly ate: Date;
  readonly estacaoId?: string | undefined;
  readonly limite?: number | undefined;
}

const LIMITE_PADRAO = 100;

export async function sessoesDeCaixa(
  prisma: PrismaClient,
  filtro: FiltroSessoes,
): Promise<readonly SessaoDeCaixa[]> {
  const linhas = await prisma.sessaoCaixa.findMany({
    where: {
      abertaEm: { gte: filtro.de, lt: filtro.ate },
      ...(filtro.estacaoId === undefined ? {} : { estacaoId: filtro.estacaoId }),
    },
    include: {
      movimentos: { select: { tipo: true, valor: true } },
      recebidos: { select: { forma: true, valor: true } },
    },
    // Mais recente primeiro: é a sessão que o gerente está conferindo agora.
    orderBy: { abertaEm: "desc" },
    take: filtro.limite ?? LIMITE_PADRAO,
  });

  if (linhas.length === 0) return [];

  const nomes = await nomesDosOperadores(
    prisma,
    linhas.map((linha) => linha.operadorId),
  );

  return linhas.map((linha) => {
    const recebidoEmDinheiro =
      linha.recebidos.find((recebido) => recebido.forma === "DINHEIRO")?.valor ?? 0n;

    const suprimentos = somar(linha.movimentos, "SUPRIMENTO");
    const sangrias = somar(linha.movimentos, "SANGRIA");

    const esperado =
      linha.fundoTroco +
      recebidoEmDinheiro -
      linha.trocoDevolvido +
      suprimentos -
      sangrias;

    const conferida = linha.contadoEmDinheiro !== null;

    return {
      id: linha.id,
      estacaoId: linha.estacaoId,
      operadorId: linha.operadorId,
      operadorNome: nomes.get(linha.operadorId) ?? "—",
      status: linha.status === "FECHADA" ? "FECHADA" : "ABERTA",
      abertaEm: linha.abertaEm.toISOString(),
      fechadaEm: linha.fechadaEm?.toISOString(),
      fundoTroco: linha.fundoTroco.toString(),
      recebidoEmDinheiro: recebidoEmDinheiro.toString(),
      trocoDevolvido: linha.trocoDevolvido.toString(),
      suprimentos: suprimentos.toString(),
      sangrias: sangrias.toString(),
      esperadoEmDinheiro: esperado.toString(),
      contadoEmDinheiro: conferida ? linha.contadoEmDinheiro?.toString() : undefined,
      divergenciaEmDinheiro: conferida
        ? ((linha.contadoEmDinheiro ?? 0n) - esperado).toString()
        : undefined,
      totalVendido: linha.totalVendido.toString(),
      quantidadeVendas: linha.quantidadeVendas,
    };
  });
}

function somar(
  movimentos: readonly { readonly tipo: string; readonly valor: bigint }[],
  tipo: string,
): bigint {
  return movimentos.reduce(
    (total, movimento) => (movimento.tipo === tipo ? total + movimento.valor : total),
    0n,
  );
}

/**
 * Nome de cada operador, numa consulta só.
 *
 * Buscar dentro do laço faria uma ida ao banco por linha da tabela — o problema
 * N+1 clássico, que só aparece quando a loja tem histórico e a tela já está em
 * produção.
 */
async function nomesDosOperadores(
  prisma: PrismaClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, nome: true },
  });

  return new Map(usuarios.map((usuario) => [usuario.id, usuario.nome]));
}
