import {
  Categoria,
  type DomainError,
  err,
  ErroConflito,
  ok,
  type Result,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

export interface EntradaCadastrarCategoria {
  readonly nome: string;
}

/**
 * Cadastra uma categoria de produto.
 *
 * A unicidade do nome é verificada **dentro da transação**, e mesmo assim o
 * banco tem índice único: duas telas cadastrando "Bebidas" no mesmo instante
 * passariam as duas pela verificação. A checagem aqui existe para dar a
 * mensagem certa ao usuário; o índice é quem garante a integridade.
 */
export class CadastrarCategoria {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaCadastrarCategoria,
  ): Promise<Result<Categoria, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const categoria = Categoria.criar({
        id: this.geradorId.proximo(),
        nome: entrada.nome,
      });

      if (categoria.isErr()) return err(categoria.error);

      const nova = categoria.unwrap();
      const existente = await repositorios.categorias.porNome(nova.nomeBusca);

      if (existente !== undefined) {
        return err(
          new ErroConflito(
            "CATEGORIA_JA_EXISTE",
            `Já existe uma categoria chamada ${existente.nome}.`,
            { categoriaId: existente.id.valor },
          ),
        );
      }

      await repositorios.categorias.salvar(nova);

      return ok(nova);
    });
  }
}
