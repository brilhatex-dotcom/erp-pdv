import { normalizarParaBusca } from "@erp/utils";

import type { PrismaClient } from "../gerado/index.js";

/**
 * O estoque como o lojista precisa vê-lo.
 *
 * ### Por que é projeção e não repositório
 *
 * `EstoqueRepository` devolve um `SaldoEstoque` por produto, para **operar**
 * sobre ele. Aqui ninguém opera: é a lista que responde "o que eu tenho" e "o
 * que está faltando". Reconstituir agregados de mil produtos para exibir vinte
 * linhas cobraria caro por nada.
 *
 * ### Produto sem movimento aparece
 *
 * A consulta parte de `produtos`, não de `saldos_estoque`. Um produto recém-
 * cadastrado não tem linha de saldo, e listar só quem tem esconderia
 * exatamente o item que ninguém deu entrada — que é o que o lojista está
 * procurando quando abre esta tela.
 */

export interface SaldoDeProduto {
  readonly produtoId: string;
  readonly sku: string;
  readonly descricao: string;
  readonly unidade: string;
  /** Milésimos em texto, com sinal. Negativo é possível e não é erro. */
  readonly milesimos: string;
  /** Centavos em texto. Ausente quando quem consulta não pode ver custo. */
  readonly custoMedio?: string | undefined;
  /** Centavos em texto — custo médio × saldo. Ausente pelo mesmo motivo. */
  readonly valorEmEstoque?: string | undefined;
  readonly ativo: boolean;
}

export type SituacaoDeSaldo = "TODOS" | "NEGATIVO" | "ZERADO" | "COM_SALDO";

export interface FiltroSaldos {
  readonly termo?: string | undefined;
  readonly situacao?: SituacaoDeSaldo | undefined;
  readonly apenasAtivos?: boolean | undefined;
  readonly limite: number;
  /** Quem consulta pode ver custo? Decidido no servidor, nunca pelo cliente. */
  readonly comCusto: boolean;
}

export async function saldosDeEstoque(
  prisma: PrismaClient,
  filtro: FiltroSaldos,
): Promise<readonly SaldoDeProduto[]> {
  const termo = (filtro.termo ?? "").trim();

  const linhas = await prisma.produto.findMany({
    where: {
      ...(filtro.apenasAtivos === true ? { ativo: true } : {}),
      ...(termo === ""
        ? {}
        : {
            OR: [
              { descricaoBusca: { contains: normalizarParaBusca(termo) } },
              { sku: termo },
              { sku: termo.toUpperCase() },
              { codigoBarras: termo },
            ],
          }),
      ...restricaoDeSaldo(filtro.situacao),
    },
    select: {
      id: true,
      sku: true,
      descricao: true,
      unidadeBase: true,
      ativo: true,
      saldo: { select: { milesimos: true, custoMedio: true } },
    },
    orderBy: { descricao: "asc" },
    take: filtro.limite,
  });

  return linhas.map((linha) => {
    const milesimos = linha.saldo?.milesimos ?? 0n;
    const custoMedio = linha.saldo?.custoMedio ?? 0n;

    return {
      produtoId: linha.id,
      sku: linha.sku,
      descricao: linha.descricao,
      unidade: linha.unidadeBase,
      milesimos: milesimos.toString(),
      ...(filtro.comCusto
        ? {
            custoMedio: custoMedio.toString(),
            // Milésimos × centavos ÷ 1000, em inteiro: o valor imobilizado não
            // passa por `double` nem aqui, no caminho para a tela.
            valorEmEstoque: ((custoMedio * milesimos) / 1000n).toString(),
          }
        : {}),
      ativo: linha.ativo,
    };
  });
}

/**
 * Traduz a situação pedida em condição sobre a linha de saldo.
 *
 * `ZERADO` e `COM_SALDO` precisam contar a **ausência** de linha: produto que
 * nunca se moveu está zerado, e ignorá-lo faria a tela dizer que a loja tem
 * tudo em estoque no dia seguinte à instalação.
 */
function restricaoDeSaldo(situacao: SituacaoDeSaldo | undefined) {
  switch (situacao) {
    case "NEGATIVO":
      return { saldo: { milesimos: { lt: 0n } } };
    case "COM_SALDO":
      return { saldo: { milesimos: { gt: 0n } } };
    case "ZERADO":
      return {
        OR: [{ saldo: { is: null } }, { saldo: { milesimos: 0n } }],
      };
    default:
      return {};
  }
}

export interface MovimentoDoExtrato {
  readonly id: string;
  readonly tipo: string;
  /** Milésimos em texto, sempre positivo — o sinal está em `efeito`. */
  readonly quantidade: string;
  readonly unidade: string;
  /** `1` entrou, `-1` saiu. Poupa a tela de repetir a tabela de tipos. */
  readonly efeito: 1 | -1;
  readonly origemTipo: string;
  readonly origemDocumentoId?: string | undefined;
  readonly usuarioId: string;
  readonly usuarioNome: string;
  /** Centavos em texto. Ausente quando não há custo ou quem lê não pode vê-lo. */
  readonly custoUnitario?: string | undefined;
  readonly lote?: string | undefined;
  readonly observacao?: string | undefined;
  readonly ocorridoEm: string;
}

/** Tipos que somam ao saldo. Espelha `efeitoDoTipo` do domínio. */
const ENTRADAS: ReadonlySet<string> = new Set([
  "ENTRADA",
  "DEVOLUCAO_CLIENTE",
  "AJUSTE_POSITIVO",
  "TRANSFERENCIA_ENTRADA",
]);

/**
 * Extrato de um produto, do mais recente para o mais antigo.
 *
 * É a resposta para "por que o saldo está assim" — a pergunta que aparece
 * sempre que a contagem física não bate. Sem extrato, a resposta seria mexer no
 * banco na loja do cliente.
 *
 * ### O desempate pelo id não é detalhe
 *
 * Uma nota de entrada com cinco itens grava os cinco movimentos na **mesma
 * transação**, com o mesmo `ocorrido_em`. Ordenar só por instante deixa a ordem
 * a cargo do plano de execução: a mesma consulta devolve uma sequência hoje e
 * outra amanhã, quando a tabela crescer e as estatísticas mudarem. Quem confere
 * o estoque veria a lista dançar entre duas atualizações da tela e desconfiaria
 * do sistema — com razão.
 *
 * O id é UUIDv7 (ADR-0008), monotônico no tempo por construção, então ele
 * desempata **na ordem em que os movimentos foram criados** — não numa ordem
 * arbitrária qualquer.
 */
export async function extratoDeEstoque(
  prisma: PrismaClient,
  produtoId: string,
  opcoes: { readonly limite: number; readonly comCusto: boolean },
): Promise<readonly MovimentoDoExtrato[]> {
  const linhas = await prisma.movimentoEstoque.findMany({
    where: { produtoId },
    orderBy: [{ ocorridoEm: "desc" }, { id: "desc" }],
    take: opcoes.limite,
  });

  if (linhas.length === 0) return [];

  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: [...new Set(linhas.map((linha) => linha.usuarioId))] } },
    select: { id: true, nome: true },
  });

  const nomePorId = new Map(usuarios.map((usuario) => [usuario.id, usuario.nome]));

  return linhas.map((linha) => ({
    id: linha.id,
    tipo: linha.tipo,
    quantidade: linha.quantidade.toString(),
    unidade: linha.unidade,
    efeito: ENTRADAS.has(linha.tipo) ? (1 as const) : (-1 as const),
    origemTipo: linha.origemTipo,
    origemDocumentoId: linha.origemDocumentoId ?? undefined,
    usuarioId: linha.usuarioId,
    // Usuário apagado não existe (o cadastro só desativa), mas a junção é feita
    // em memória e um `undefined` aqui viraria "undefined" na tela.
    usuarioNome: nomePorId.get(linha.usuarioId) ?? "—",
    ...(opcoes.comCusto && linha.custoUnitario !== null
      ? { custoUnitario: linha.custoUnitario.toString() }
      : {}),
    lote: linha.lote ?? undefined,
    observacao: linha.observacao ?? undefined,
    ocorridoEm: linha.ocorridoEm.toISOString(),
  }));
}
