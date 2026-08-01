import {
  type DomainError,
  err,
  ErroNaoEncontrado,
  type ErroValidacao,
  type Identificador,
  ok,
  type Produto,
  type Result,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import { interpretarCentavos } from "./interpretarProduto.js";

export interface EntradaAlterarPreco {
  readonly id: Identificador;
  /** Centavos. */
  readonly precoVenda: bigint;
}

/**
 * Altera **só** o preço de venda.
 *
 * Existe porque o supervisor tem `produto:alterar_preco` e não tem
 * `produto:editar` — e é exatamente ele quem resolve o caso real: o cliente
 * chega no caixa, a etiqueta da gôndola diz 4,90, o sistema diz 5,90, e alguém
 * precisa acertar isso agora, com fila. Obrigá-lo a passar pelo formulário
 * inteiro de cadastro significaria dar-lhe permissão para mexer em tudo.
 *
 * Não toca no custo: quem corrige preço no balcão frequentemente nem pode vê-lo.
 */
export class AlterarPrecoDoProduto {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
  ) {}

  async executar(entrada: EntradaAlterarPreco): Promise<Result<Produto, DomainError>> {
    const problemas: ErroValidacao[] = [];
    const preco = interpretarCentavos(entrada.precoVenda, problemas);

    if (preco === undefined) return err(agregarErros(problemas));

    const agora = this.relogio.agora();

    return this.unitOfWork.transacao(async (repositorios) => {
      const produto = await repositorios.produtos.porId(entrada.id);

      if (produto === undefined) {
        return err(
          new ErroNaoEncontrado("PRODUTO_NAO_ENCONTRADO", "Produto não encontrado."),
        );
      }

      const alterado = produto.alterarPreco(preco, agora);
      if (alterado.isErr()) return err(alterado.error);

      await repositorios.produtos.salvar(produto);

      return ok(produto);
    });
  }
}
