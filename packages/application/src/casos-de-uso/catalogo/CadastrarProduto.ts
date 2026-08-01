import {
  type CodigoUnidade,
  Dinheiro,
  type DomainError,
  err,
  ErroConflito,
  ErroValidacao,
  type Identificador,
  ok,
  Produto,
  type Result,
  type TipoProduto,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";

import {
  type EmbalagemBruta,
  interpretarCentavos,
  interpretarCodigoBarras,
  interpretarEmbalagens,
  interpretarReferencias,
  type ReferenciaBruta,
} from "./interpretarProduto.js";

export interface EntradaCadastrarProduto {
  readonly sku: string;
  readonly descricao: string;
  /** Descrição curta do cupom. Padrão: a descrição truncada. */
  readonly descricaoPdv?: string | undefined;
  readonly tipo: TipoProduto;
  readonly unidadeBase: CodigoUnidade;
  /** Centavos. */
  readonly precoVenda: bigint;
  /** Centavos. Ausente vira zero — "não informado", não "de graça". */
  readonly custo?: bigint | undefined;
  readonly codigoBarras?: string | undefined;
  readonly codigoBalanca?: string | undefined;
  readonly categoriaId?: Identificador | undefined;
  readonly referencias?: readonly ReferenciaBruta[] | undefined;
  readonly embalagens?: readonly EmbalagemBruta[] | undefined;
}

/**
 * Cadastra um produto.
 *
 * ### Por que o preço inicial não exige `produto:alterar_preco`
 *
 * Quem cadastra precisa informar o preço — produto sem preço não vende, e
 * cadastrar pela metade para outra pessoa completar é como o item fica
 * esquecido a zero até alguém bipá-lo no caixa. O que a permissão separada
 * protege é **mexer no preço de um produto que já está vendendo**: aí sim é
 * decisão de margem, e mora em `AlterarPrecoDoProduto`.
 *
 * ### Três unicidades, três mensagens
 *
 * SKU, código de barras e código de balança são únicos no banco. A verificação
 * aqui existe para dizer **qual** produto já usa o código — "já existe" sem
 * dizer onde faz o usuário procurar às cegas. O índice único é quem garante a
 * integridade quando duas telas gravam no mesmo instante.
 */
export class CadastrarProduto {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaCadastrarProduto,
  ): Promise<Result<Produto, DomainError>> {
    const problemas: ErroValidacao[] = [];

    const codigoBarras = interpretarCodigoBarras(entrada.codigoBarras, problemas);
    const referencias = interpretarReferencias(entrada.referencias, problemas);
    const embalagens = interpretarEmbalagens(entrada.embalagens, problemas);
    const precoVenda = interpretarCentavos(entrada.precoVenda, problemas);
    const custo = interpretarCentavos(entrada.custo, problemas);

    if (problemas.length > 0 || precoVenda === undefined) {
      return err(agregarErros(problemas));
    }

    return this.unitOfWork.transacao(async (repositorios) => {
      const conflito = await conferirCodigosLivres(repositorios, {
        sku: entrada.sku,
        codigoBarras: codigoBarras?.valor,
        codigoBalanca: entrada.codigoBalanca,
      });

      if (conflito !== undefined) return err(conflito);

      const categoria = await conferirCategoria(repositorios, entrada.categoriaId);
      if (categoria !== undefined) return err(categoria);

      const produto = Produto.criar({
        id: this.geradorId.proximo(),
        sku: entrada.sku,
        descricao: entrada.descricao,
        descricaoPdv: entrada.descricaoPdv,
        tipo: entrada.tipo,
        unidadeBase: entrada.unidadeBase,
        precoVenda,
        custo: custo ?? Dinheiro.zero(),
        codigoBarras,
        codigoBalanca: entrada.codigoBalanca,
        categoriaId: entrada.categoriaId,
        referencias,
        embalagens,
      });

      if (produto.isErr()) return err(agregarErros(produto.error));

      await repositorios.produtos.salvar(produto.unwrap());

      return ok(produto.unwrap());
    });
  }
}

/** Códigos que precisam ser únicos, com o produto que já os usa. */
interface CodigosDoProduto {
  readonly sku: string;
  readonly codigoBarras?: string | undefined;
  readonly codigoBalanca?: string | undefined;
}

/**
 * Confere as três unicidades.
 *
 * `exceto` é o identificador do próprio produto na alteração: sem ele, salvar
 * um produto sem mexer no SKU acusaria conflito consigo mesmo.
 */
export async function conferirCodigosLivres(
  repositorios: Pick<Repositorios, "produtos">,
  codigos: CodigosDoProduto,
  exceto?: Identificador,
): Promise<ErroConflito | undefined> {
  const mesmo = (outro: Produto): boolean =>
    exceto !== undefined && outro.id.equals(exceto);

  const porSku = await repositorios.produtos.porSku(codigos.sku.trim());

  if (porSku !== undefined && !mesmo(porSku)) {
    return new ErroConflito(
      "PRODUTO_SKU_EM_USO",
      `O código ${codigos.sku.trim()} já é do produto ${porSku.descricao}.`,
      { produtoId: porSku.id.valor },
    );
  }

  if (codigos.codigoBarras !== undefined) {
    const porBarras = await repositorios.produtos.porCodigoBarras(codigos.codigoBarras);

    if (porBarras !== undefined && !mesmo(porBarras)) {
      return new ErroConflito(
        "PRODUTO_CODIGO_BARRAS_EM_USO",
        `Este código de barras já é do produto ${porBarras.descricao}.`,
        { produtoId: porBarras.id.valor },
      );
    }
  }

  const balanca = codigos.codigoBalanca?.trim();

  if (balanca !== undefined && balanca !== "") {
    const porBalanca = await repositorios.produtos.porCodigoBalanca(balanca);

    if (porBalanca !== undefined && !mesmo(porBalanca)) {
      return new ErroConflito(
        "PRODUTO_CODIGO_BALANCA_EM_USO",
        `O código de balança ${balanca} já é do produto ${porBalanca.descricao}.`,
        { produtoId: porBalanca.id.valor },
      );
    }
  }

  return undefined;
}

/**
 * Confere que a categoria existe.
 *
 * Sem isto, a chave estrangeira recusaria a gravação e o operador veria um erro
 * de banco — exatamente o que CLAUDE.md §9 proíbe mostrar a ele.
 */
export async function conferirCategoria(
  repositorios: Pick<Repositorios, "categorias">,
  categoriaId: Identificador | undefined,
): Promise<ErroValidacao | undefined> {
  if (categoriaId === undefined) return undefined;

  const categoria = await repositorios.categorias.porId(categoriaId);

  if (categoria === undefined) {
    return new ErroValidacao(
      "CATEGORIA_NAO_ENCONTRADA",
      "A categoria escolhida não existe mais. Atualize a tela e escolha outra.",
    );
  }

  return undefined;
}
