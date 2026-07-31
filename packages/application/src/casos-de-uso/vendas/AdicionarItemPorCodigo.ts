import {
  type DomainError,
  ehCodigoDeBalanca,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type Identificador,
  interpretarCodigoBalanca,
  type LayoutBalanca,
  ok,
  type Produto,
  Quantidade,
  type Result,
  type VendaItem,
} from "@erp/domain";

import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { ProdutoRepository } from "../../portas/repositorios/Repositorios.js";

export interface EntradaAdicionarItem {
  readonly vendaId: Identificador;
  /** O que o operador bipou ou digitou. */
  readonly codigo: string;
  /** Informada só quando o operador digita. Etiqueta de balança traz a sua. */
  readonly quantidade?: Quantidade | undefined;
  /** Bloqueia a venda quando não há saldo. Configuração da loja. */
  readonly exigirEstoque?: boolean | undefined;
}

/**
 * Adiciona um item à venda a partir de um código.
 *
 * É o caminho mais percorrido do sistema — cada bipada passa por aqui. Trata
 * os dois fluxos do balcão:
 *
 * - **Etiqueta de balança**: o código traz produto e peso embutidos, e o item
 *   entra pronto, sem o operador digitar nada.
 * - **Código comum**: busca por barras, SKU ou referência de fabricante, e a
 *   quantidade é 1 salvo indicação contrária.
 */
export class AdicionarItemPorCodigo {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly layoutBalanca: LayoutBalanca,
  ) {}

  async executar(entrada: EntradaAdicionarItem): Promise<Result<VendaItem, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const venda = await repositorios.vendas.porId(entrada.vendaId);

      if (venda === undefined) {
        return err(
          new ErroNaoEncontrado("VENDA_NAO_ENCONTRADA", "Venda não encontrada.", {
            vendaId: entrada.vendaId.valor,
          }),
        );
      }

      const localizado = await this.#localizar(repositorios.produtos, entrada);
      if (localizado.isErr()) return err(localizado.error);

      const { produto, quantidade } = localizado.unwrap();

      if (!produto.ativo) {
        return err(
          new ErroRegraNegocio(
            "PRODUTO_INATIVO",
            `${produto.descricao} está inativo e não pode ser vendido.`,
            { produtoId: produto.id.valor },
          ),
        );
      }

      if (entrada.exigirEstoque === true) {
        const saldo = await repositorios.estoque.saldo(
          produto.id,
          produto.unidadeBase.codigo,
        );
        const disponivel = saldo.podeRetirar(quantidade, false);
        if (disponivel.isErr()) return err(disponivel.error);
      }

      const item = venda.adicionarItem({
        produtoId: produto.id,
        descricao: produto.descricaoPdv,
        quantidade,
        precoUnitario: produto.precoVenda,
      });

      if (item.isErr()) return err(item.error);

      await repositorios.vendas.salvar(venda);

      return ok(item.unwrap());
    });
  }

  /** Descobre o produto e a quantidade a partir do código lido. */
  async #localizar(
    produtos: ProdutoRepository,
    entrada: EntradaAdicionarItem,
  ): Promise<Result<{ produto: Produto; quantidade: Quantidade }, DomainError>> {
    if (ehCodigoDeBalanca(entrada.codigo, this.layoutBalanca)) {
      return this.#localizarPorBalanca(produtos, entrada.codigo);
    }

    const produto = await produtos.porCodigo(entrada.codigo);

    if (produto === undefined) {
      return err(
        new ErroNaoEncontrado(
          "PRODUTO_NAO_ENCONTRADO",
          "Produto não encontrado. Confira o código.",
          { codigo: entrada.codigo },
        ),
      );
    }

    const quantidade =
      entrada.quantidade ??
      Quantidade.de("1", produto.unidadeBase.codigo).unwrapOr(
        Quantidade.zero(produto.unidadeBase.codigo),
      );

    return ok({ produto, quantidade });
  }

  async #localizarPorBalanca(
    produtos: ProdutoRepository,
    codigo: string,
  ): Promise<Result<{ produto: Produto; quantidade: Quantidade }, DomainError>> {
    const leitura = interpretarCodigoBalanca(codigo, this.layoutBalanca);
    if (leitura.isErr()) return err(leitura.error);

    const { codigoProduto, peso, preco } = leitura.unwrap();
    const produto = await produtos.porCodigoBalanca(codigoProduto);

    if (produto === undefined) {
      return err(
        new ErroNaoEncontrado(
          "PRODUTO_NAO_ENCONTRADO",
          "Produto da etiqueta não encontrado. Confira o cadastro da balança.",
          { codigoBalanca: codigoProduto },
        ),
      );
    }

    if (peso !== undefined) {
      return ok({ produto, quantidade: peso });
    }

    // Layout que embute o preço total: a quantidade é deduzida dividindo pelo
    // preço unitário. Sem preço não há como deduzir, e adivinhar seria pior do
    // que recusar — cobrar errado é o defeito mais caro do balcão.
    if (preco === undefined || !produto.precoVenda.ehPositivo()) {
      return err(
        new ErroRegraNegocio(
          "BALANCA_QUANTIDADE_INDETERMINADA",
          "Não foi possível calcular a quantidade da etiqueta. Registre o item manualmente.",
          { codigoBalanca: codigoProduto },
        ),
      );
    }

    const milesimos = (preco.centavos * 1000n) / produto.precoVenda.centavos;

    const quantidade = Quantidade.deMilesimos(milesimos, produto.unidadeBase.codigo);

    if (quantidade.isErr()) return err(quantidade.error);

    return ok({ produto, quantidade: quantidade.unwrap() });
  }
}
