import type { NotaDeCompraRepository } from "@erp/application";
import type { Identificador, NotaDeCompra } from "@erp/domain";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import { itensParaLinhas, paraDominio, paraLinha } from "../mapeadores/compraMapeador.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

const INCLUIR = { itens: true } as const;

/**
 * Notas de compra sobre PostgreSQL.
 *
 * Os itens são regravados por completo, como em `Produto`: a coleção é pequena
 * (uma nota tem dezenas de linhas, não milhares) e o caminho simples evita a
 * lógica de diferença, que é onde este tipo de código costuma errar.
 *
 * Na prática só a **primeira** gravação escreve itens — nota lançada não muda
 * de conteúdo, e o cancelamento mexe apenas no cabeçalho. A regravação está
 * aqui para que o repositório continue correto se isso mudar, não porque
 * acontece hoje.
 */
export class CompraRepositorioPrisma implements NotaDeCompraRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<NotaDeCompra | undefined> {
    const linha = await this.prisma.notaDeCompra.findUnique({
      where: { id: id.valor },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  /**
   * Localiza a nota **lançada** com a identificação que o fornecedor deu a ela.
   *
   * É a consulta que impede a mesma nota de entrar duas vezes — o defeito mais
   * comum da entrada de mercadoria, e o que dobra o estoque sem ninguém notar.
   *
   * Ignora as canceladas de propósito, e o índice único do banco é parcial pelo
   * mesmo motivo: quem digitou a quantidade errada cancela e relança com o
   * mesmo número. Considerar a cancelada travaria a correção.
   */
  async porChave(
    fornecedorId: Identificador,
    numero: string,
    serie: string | undefined,
  ): Promise<NotaDeCompra | undefined> {
    const linha = await this.prisma.notaDeCompra.findFirst({
      where: {
        fornecedorId: fornecedorId.valor,
        numero: numero.trim(),
        serie: serie?.trim() ?? "",
        status: "LANCADA",
      },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  async salvar(nota: NotaDeCompra): Promise<void> {
    const linha = paraLinha(nota);

    await this.prisma.notaDeCompra.upsert({
      where: { id: linha.id },
      create: linha,
      update: linha,
    });

    await this.prisma.itemNotaCompra.deleteMany({ where: { notaId: linha.id } });

    if (nota.itens.length > 0) {
      await this.prisma.itemNotaCompra.createMany({ data: itensParaLinhas(nota) });
    }
  }
}
