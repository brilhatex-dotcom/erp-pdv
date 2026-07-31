import {
  type Categoria,
  type DomainError,
  err,
  ErroConflito,
  ErroNaoEncontrado,
  type Identificador,
  ok,
  type Result,
} from "@erp/domain";

import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

export interface EntradaAlterarCategoria {
  readonly id: Identificador;
  readonly nome: string;
  readonly ativa: boolean;
}

/**
 * Altera uma categoria.
 *
 * A entrada carrega **todos** os campos, e não só os que mudaram. Um caso de
 * uso que aceita campo ausente como "não mexer" torna impossível limpar um
 * campo — e quem tenta apagar uma observação descobre que o sistema a mantém.
 * O formulário já envia o estado completo; o caso de uso o aplica.
 */
export class AlterarCategoria {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(
    entrada: EntradaAlterarCategoria,
  ): Promise<Result<Categoria, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const categoria = await repositorios.categorias.porId(entrada.id);

      if (categoria === undefined) {
        return err(
          new ErroNaoEncontrado("CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada."),
        );
      }

      const renomeada = categoria.renomear(entrada.nome);
      if (renomeada.isErr()) return err(renomeada.error);

      const homonima = await repositorios.categorias.porNome(categoria.nomeBusca);

      // Encontrar a si mesma não é conflito: é o caso de quem só trocou a
      // acentuação ou a caixa do próprio nome.
      if (homonima !== undefined && !homonima.id.equals(categoria.id)) {
        return err(
          new ErroConflito(
            "CATEGORIA_JA_EXISTE",
            `Já existe uma categoria chamada ${homonima.nome}.`,
            { categoriaId: homonima.id.valor },
          ),
        );
      }

      if (entrada.ativa) {
        categoria.ativar();
      } else {
        categoria.desativar();
      }

      await repositorios.categorias.salvar(categoria);

      return ok(categoria);
    });
  }
}
