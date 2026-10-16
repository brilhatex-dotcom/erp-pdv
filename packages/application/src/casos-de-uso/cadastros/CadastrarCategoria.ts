import {
  Categoria,
  type DomainError,
  err,
  ErroConflito,
  ErroValidacao,
  type Identificador,
  ok,
  type Result,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

export interface EntradaCadastrarCategoria {
  readonly nome: string;
  /** Emoji do botão no caixa — "🍞". */
  readonly icone?: string | undefined;
  readonly imagemId?: Identificador | undefined;
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
      if (
        entrada.imagemId !== undefined &&
        !(await repositorios.imagens.existe(entrada.imagemId))
      ) {
        return err(imagemAusente());
      }

      const categoria = Categoria.criar({
        id: this.geradorId.proximo(),
        nome: entrada.nome,
        icone: entrada.icone,
        imagemId: entrada.imagemId,
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

/** A foto escolhida sumiu entre o envio e a gravação. */
export function imagemAusente(): ErroValidacao {
  return new ErroValidacao(
    "IMAGEM_NAO_ENCONTRADA",
    "A imagem não foi encontrada. Envie a foto de novo.",
  );
}
