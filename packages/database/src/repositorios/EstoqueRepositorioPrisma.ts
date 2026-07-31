import type { EstoqueRepository } from "@erp/application";
import {
  type CodigoUnidade,
  type Identificador,
  type MovimentoEstoque,
  SaldoEstoque,
} from "@erp/domain";

import type { Prisma, PrismaClient } from "../../gerado/index.js";
import { paraDinheiro, paraId, paraUnidade } from "../mapeadores/comuns.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

/**
 * Estoque sobre PostgreSQL.
 *
 * Escreve em duas tabelas com papéis diferentes, e a distinção é a decisão
 * central do ADR-0007:
 *
 * - `movimentos_estoque` é o **fato**, append-only. Um gatilho no banco recusa
 *   `UPDATE` e `DELETE`, porque a garantia não pode depender de quem escreve o
 *   código de amanhã.
 * - `saldos_estoque` é **projeção**. Existe só porque somar milhões de linhas a
 *   cada bipada não caberia nos 100 ms do RNF-02, e pode ser reconstruída
 *   inteira a partir dos movimentos.
 */
export class EstoqueRepositorioPrisma implements EstoqueRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async saldo(produtoId: Identificador, unidade: CodigoUnidade): Promise<SaldoEstoque> {
    const linha = await this.prisma.saldoEstoque.findUnique({
      where: { produtoId: produtoId.valor },
    });

    if (linha === null) {
      return SaldoEstoque.vazio(produtoId, unidade);
    }

    return SaldoEstoque.reconstituir(
      paraId(linha.produtoId),
      paraUnidade(linha.unidade),
      linha.milesimos,
      paraDinheiro(linha.custoMedio),
    );
  }

  /**
   * Grava o movimento e atualiza a projeção.
   *
   * O saldo novo é calculado pelo **domínio**, aplicando o movimento ao saldo
   * lido — não por um `UPDATE ... SET milesimos = milesimos + ?`. A diferença
   * importa: o custo médio ponderado é regra de negócio, e escrevê-lo em SQL o
   * duplicaria fora do domínio, que é exatamente o que o veto do Dev Sênior
   * proíbe.
   *
   * Ler o saldo, calcular fora do banco e gravar de volta é um *lost update*
   * esperando acontecer: em `READ COMMITTED`, duas estações vendendo o mesmo
   * produto leem o mesmo saldo e a segunda sobrescreve a primeira. Por isso a
   * linha de saldo é **travada** antes da leitura. A trava dura o que dura a
   * transação da venda — milissegundos — e vale por produto, não por tabela.
   */
  async registrar(movimento: MovimentoEstoque): Promise<void> {
    await this.#travarSaldo(movimento.produtoId);

    await this.prisma.movimentoEstoque.create({
      data: {
        id: movimento.id.valor,
        produtoId: movimento.produtoId.valor,
        tipo: movimento.tipo,
        quantidade: movimento.quantidade.milesimos,
        unidade: movimento.quantidade.unidade.codigo,
        origemTipo: movimento.origem.tipo,
        origemDocumentoId: movimento.origem.documentoId?.valor ?? null,
        usuarioId: movimento.usuarioId.valor,
        custoUnitario: movimento.custoUnitario?.centavos ?? null,
        lote: movimento.lote ?? null,
        observacao: movimento.observacao ?? null,
        ocorridoEm: movimento.ocorridoEm,
      },
    });

    const unidade = movimento.quantidade.unidade.codigo;
    const anterior = await this.saldo(movimento.produtoId, unidade);
    const atualizado = anterior.aplicar(movimento);

    /* v8 ignore next -- inalcançável: produto e unidade vieram do próprio movimento */
    if (atualizado.isErr()) return;

    const saldo = atualizado.unwrap();

    await this.prisma.saldoEstoque.upsert({
      where: { produtoId: movimento.produtoId.valor },
      create: {
        produtoId: movimento.produtoId.valor,
        milesimos: saldo.milesimos,
        unidade,
        custoMedio: saldo.custoMedio.centavos,
      },
      update: {
        milesimos: saldo.milesimos,
        custoMedio: saldo.custoMedio.centavos,
      },
    });
  }

  /**
   * Trava a linha de saldo do produto até o fim da transação.
   *
   * `FOR UPDATE` não cria a linha — no primeiro movimento de um produto não há
   * o que travar, e aí o `upsert` resolve pela chave primária: uma das duas
   * transações falha por chave duplicada e é repetida, em vez de sobrescrever.
   */
  async #travarSaldo(produtoId: Identificador): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT 1 FROM "saldos_estoque" WHERE "produto_id" = ${produtoId.valor}::uuid FOR UPDATE
    `;
  }
}
