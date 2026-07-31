import type { CaixaRepository } from "@erp/application";
import {
  CODIGOS_FORMA_PAGAMENTO,
  type Identificador,
  type SessaoCaixa,
} from "@erp/domain";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import {
  movimentosParaLinhas,
  paraDominio,
  paraLinha,
  recebimentosParaLinhas,
} from "../mapeadores/caixaMapeador.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

const INCLUIR = { movimentos: true, recebidos: true } as const;

export class CaixaRepositorioPrisma implements CaixaRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<SessaoCaixa | undefined> {
    const linha = await this.prisma.sessaoCaixa.findUnique({
      where: { id: id.valor },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  /**
   * Sessão aberta na estação.
   *
   * Só pode existir uma, e a garantia não está aqui: está no índice parcial
   * `uq_sessao_aberta_por_estacao`. Verificar em aplicação apenas evita o erro
   * feio na tela; o que impede duas gavetas abertas de verdade é o banco.
   */
  async abertaNaEstacao(estacaoId: Identificador): Promise<SessaoCaixa | undefined> {
    const linha = await this.prisma.sessaoCaixa.findFirst({
      where: { estacaoId: estacaoId.valor, status: "ABERTA" },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  async salvar(sessao: SessaoCaixa): Promise<void> {
    const linha = paraLinha(sessao);

    await this.prisma.sessaoCaixa.upsert({
      where: { id: linha.id },
      create: linha,
      update: linha,
    });

    // Sangrias e suprimentos são fatos e só crescem — regravá-los inteiros
    // seria apagar histórico. `skipDuplicates` deixa a gravação idempotente.
    const movimentos = movimentosParaLinhas(sessao);
    if (movimentos.length > 0) {
      await this.prisma.movimentoCaixa.createMany({
        data: movimentos,
        skipDuplicates: true,
      });
    }

    // Os totais por forma, ao contrário, são acumuladores: o valor certo é
    // sempre o último calculado pelo agregado.
    await this.prisma.recebimentoCaixa.deleteMany({
      where: { sessaoCaixaId: linha.id },
    });

    const recebimentos = recebimentosParaLinhas(sessao, CODIGOS_FORMA_PAGAMENTO);
    if (recebimentos.length > 0) {
      await this.prisma.recebimentoCaixa.createMany({ data: recebimentos });
    }
  }
}
