import type { VendaRepository } from "@erp/application";
import type { Identificador, Venda } from "@erp/domain";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import {
  itensParaLinhas,
  pagamentosParaLinhas,
  paraDominio,
  paraLinha,
} from "../mapeadores/vendaMapeador.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

const INCLUIR = { itens: true, pagamentos: true } as const;

export class VendaRepositorioPrisma implements VendaRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Venda | undefined> {
    const linha = await this.prisma.venda.findUnique({
      where: { id: id.valor },
      include: INCLUIR,
    });

    return linha === null ? undefined : paraDominio(linha);
  }

  /**
   * Próximo número livre na série da estação.
   *
   * Numeração é do **ERP**, não do provedor fiscal, e é sequencial por estação —
   * uma série por PDV. Duas estações numerando em paralelo não colidem porque
   * cada uma tem a sua série; duas vendas na mesma estação colidiriam, e é o
   * índice único `(estacao_id, numero)` que impede a segunda de gravar.
   */
  async proximoNumero(estacaoId: Identificador): Promise<number> {
    const maior = await this.prisma.venda.aggregate({
      where: { estacaoId: estacaoId.valor },
      _max: { numero: true },
    });

    return (maior._max.numero ?? 0) + 1;
  }

  /**
   * Vendas abertas de uma sessão, da mais antiga para a mais nova.
   *
   * O filtro principal é a sessão, coberto por `idx_vendas_sessao`; o status
   * corre sobre as linhas já localizadas, que são as vendas de um turno.
   */
  async abertasNaSessao(sessaoCaixaId: Identificador): Promise<readonly Venda[]> {
    const linhas = await this.prisma.venda.findMany({
      where: { sessaoCaixaId: sessaoCaixaId.valor, status: "ABERTA" },
      include: INCLUIR,
      orderBy: [{ abertaEm: "asc" }, { id: "asc" }],
    });

    return linhas.map(paraDominio);
  }

  /**
   * Grava a venda e seus filhos.
   *
   * Itens e pagamentos são regravados por completo: uma venda tem dezenas de
   * itens, não milhares, e o cálculo de diferença é onde este tipo de código
   * costuma perder uma linha.
   *
   * Venda concluída que é cancelada **não** regrava os filhos: o cancelamento
   * muda o cabeçalho (status, quem, por quê), e os itens e pagamentos são o
   * fato que aconteceu no balcão — apagá-los e recriá-los seria reescrever
   * um fato, mesmo que com o mesmo conteúdo.
   */
  async salvar(venda: Venda): Promise<void> {
    const linha = paraLinha(venda);

    await this.prisma.venda.upsert({
      where: { id: linha.id },
      create: linha,
      update: linha,
    });

    if (venda.foiCanceladaAposFinalizar) return;

    await this.prisma.vendaItem.deleteMany({ where: { vendaId: linha.id } });
    const itens = itensParaLinhas(venda);
    if (itens.length > 0) {
      await this.prisma.vendaItem.createMany({ data: itens });
    }

    await this.prisma.pagamento.deleteMany({ where: { vendaId: linha.id } });
    const pagamentos = pagamentosParaLinhas(venda);
    if (pagamentos.length > 0) {
      await this.prisma.pagamento.createMany({ data: pagamentos });
    }
  }
}
