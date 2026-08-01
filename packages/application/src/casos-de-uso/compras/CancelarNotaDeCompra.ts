import {
  type DomainError,
  err,
  ErroNaoEncontrado,
  type Identificador,
  type NotaDeCompra,
  ok,
  type Result,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";
import { movimentar } from "../estoque/movimentar.js";

export interface EntradaCancelarNota {
  readonly id: Identificador;
  readonly motivo: string;
  readonly usuarioId: Identificador;
}

/**
 * Cancela a nota e estorna o estoque que ela lançou.
 *
 * ### Por que existe
 *
 * Nota digitada errada — em duplicidade, no fornecedor trocado, com a
 * quantidade de outra — dobra ou distorce o estoque. Sem caminho de volta, a
 * saída seria mexer no banco na loja do cliente, que é o cenário que o produto
 * inteiro se propõe a evitar.
 *
 * ### O estorno é ajuste, não devolução
 *
 * Os movimentos de volta são `AJUSTE_NEGATIVO`, e não `DEVOLUCAO_FORNECEDOR`.
 * A diferença não é cosmética: devolução é mercadoria que saiu de verdade e
 * volta para o fornecedor; aqui nada saiu — o que houve foi um lançamento que
 * não deveria ter existido. Chamá-lo de devolução faria o relatório de compras
 * mostrar uma devolução que ninguém fez.
 *
 * Ajuste também **não mexe no custo médio**, que é o comportamento certo: o
 * custo médio já foi contaminado pela entrada errada, e o caminho de corrigi-lo
 * é outro. Fica registrado como limitação conhecida.
 *
 * ### O estorno não some
 *
 * Cancelar não apaga a nota nem os movimentos originais. Ficam os dois — a
 * entrada e o estorno — porque fato é imutável (princípio 5), e porque a
 * pergunta "por que este produto teve entrada e saída no mesmo dia" precisa ter
 * resposta seis meses depois.
 */
export class CancelarNotaDeCompra {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaCancelarNota,
  ): Promise<Result<NotaDeCompra, DomainError>> {
    const agora = this.relogio.agora();

    return this.unitOfWork.transacao(async (repositorios) => {
      const nota = await repositorios.notasDeCompra.porId(entrada.id);

      if (nota === undefined) {
        return err(new ErroNaoEncontrado("NOTA_NAO_ENCONTRADA", "Nota não encontrada."));
      }

      const cancelada = nota.cancelar(agora, entrada.motivo);
      if (cancelada.isErr()) return err(cancelada.error);

      await repositorios.notasDeCompra.salvar(nota);

      const estorno = await estornar(
        repositorios,
        this.geradorId,
        nota,
        entrada.usuarioId,
        agora,
      );

      if (estorno.isErr()) return err(estorno.error);

      return ok(nota);
    });
  }
}

async function estornar(
  repositorios: Pick<Repositorios, "estoque" | "produtos">,
  geradorId: GeradorId,
  nota: NotaDeCompra,
  usuarioId: Identificador,
  agora: Date,
): Promise<Result<void, DomainError>> {
  for (const item of nota.itens) {
    const produto = await repositorios.produtos.porId(item.produtoId);

    if (produto === undefined) {
      return err(
        new ErroNaoEncontrado(
          "PRODUTO_NAO_ENCONTRADO",
          "Um dos produtos da nota não existe mais. O estorno não pode ser feito.",
          { produtoId: item.produtoId.valor },
        ),
      );
    }

    // Sem custo: ajuste corrige quantidade, não valor.
    const movimento = await movimentar(repositorios, geradorId, produto, {
      tipo: "AJUSTE_NEGATIVO",
      quantidade: item.quantidade,
      observacao: `Estorno do cancelamento da nota ${nota.chave}`,
      usuarioId,
      origem: { tipo: "COMPRA", documentoId: nota.id },
      // O estorno acontece **agora**, não na data da nota: ele é um fato novo,
      // e datá-lo no passado esconderia dele quem consulta o extrato de hoje.
      ocorridoEm: agora,
    });

    if (movimento.isErr()) return err(movimento.error);
  }

  return ok(undefined);
}
