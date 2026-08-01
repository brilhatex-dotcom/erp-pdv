import {
  type CodigoBarras,
  type Dinheiro,
  type DomainError,
  type Embalagem,
  err,
  ErroNaoAutorizado,
  ErroNaoEncontrado,
  type ErroValidacao,
  type Identificador,
  ok,
  type Produto,
  type ReferenciaProduto,
  type Result,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import { conferirCategoria, conferirCodigosLivres } from "./CadastrarProduto.js";
import {
  type EmbalagemBruta,
  interpretarCentavos,
  interpretarCodigoBarras,
  interpretarEmbalagens,
  interpretarReferencias,
  type ReferenciaBruta,
} from "./interpretarProduto.js";

export interface EntradaAlterarProduto {
  readonly id: Identificador;
  readonly sku: string;
  readonly descricao: string;
  readonly descricaoPdv?: string | undefined;
  /** Centavos. */
  readonly precoVenda: bigint;
  /**
   * Centavos. **Ausente significa "mantenha o que está lá"**, e não zero.
   *
   * É o que protege o custo de quem não pode vê-lo: o formulário do operador
   * sem `produto:ver_custo` não recebe o campo, logo não o devolve — e sem esta
   * distinção o custo de todo produto que ele editasse iria a zero, levando
   * junto a margem de todo relatório.
   */
  readonly custo?: bigint | undefined;
  readonly codigoBarras?: string | undefined;
  readonly codigoBalanca?: string | undefined;
  readonly categoriaId?: Identificador | undefined;
  readonly referencias?: readonly ReferenciaBruta[] | undefined;
  readonly embalagens?: readonly EmbalagemBruta[] | undefined;
  readonly ativo: boolean;
  /**
   * Quem está salvando tem `produto:alterar_preco`?
   *
   * Decidido no servidor e passado como fato, não perguntado ao cliente. Vem
   * como dado porque a regra é do caso de uso: só bloqueia se o preço **mudou**
   * — recusar a gravação inteira porque o formulário devolveu o mesmo preço
   * impediria o estoquista de corrigir uma descrição.
   */
  readonly podeAlterarPreco: boolean;
}

/**
 * Altera um produto. A entrada é o **estado completo**, como nos demais
 * cadastros: o formulário se abre, edita e salva.
 *
 * Tipo e unidade base não entram. O produto já tem saldo de estoque e itens de
 * venda naquela unidade; trocá-la reinterpretaria o histórico sem converter
 * nada — o inventário passaria a mostrar 300 quilos onde havia 300 unidades.
 * Quando é preciso mesmo, o caminho é desativar e cadastrar outro.
 */
export class AlterarProduto {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
  ) {}

  async executar(entrada: EntradaAlterarProduto): Promise<Result<Produto, DomainError>> {
    const problemas: ErroValidacao[] = [];

    const codigoBarras = interpretarCodigoBarras(entrada.codigoBarras, problemas);
    const referencias = interpretarReferencias(entrada.referencias, problemas);
    const embalagens = interpretarEmbalagens(entrada.embalagens, problemas);
    const precoVenda = interpretarCentavos(entrada.precoVenda, problemas);
    const custo = interpretarCentavos(entrada.custo, problemas);

    if (problemas.length > 0 || precoVenda === undefined) {
      return err(agregarErros(problemas));
    }

    const agora = this.relogio.agora();

    return this.unitOfWork.transacao(async (repositorios) => {
      const produto = await repositorios.produtos.porId(entrada.id);

      if (produto === undefined) {
        return err(
          new ErroNaoEncontrado("PRODUTO_NAO_ENCONTRADO", "Produto não encontrado."),
        );
      }

      if (!entrada.podeAlterarPreco && !precoVenda.equals(produto.precoVenda)) {
        return err(
          new ErroNaoAutorizado(
            "SEM_PERMISSAO_PARA_PRECO",
            "Você não pode alterar o preço de venda. Peça a um supervisor.",
          ),
        );
      }

      const conflito = await conferirCodigosLivres(
        repositorios,
        {
          sku: entrada.sku,
          codigoBarras: codigoBarras?.valor,
          codigoBalanca: entrada.codigoBalanca,
        },
        produto.id,
      );

      if (conflito !== undefined) return err(conflito);

      const categoriaAusente = await conferirCategoria(repositorios, entrada.categoriaId);
      if (categoriaAusente !== undefined) return err(categoriaAusente);

      // O agregado é mutado campo a campo e só é gravado se **nada** falhar.
      // A cópia em memória fica inconsistente no caminho, e tudo bem: ela é
      // descartada com a transação e nunca chega ao banco. Validar tudo antes
      // exigiria duplicar aqui as regras que o agregado já sabe aplicar.
      const falhas = aplicar(produto, {
        ...entrada,
        codigoBarras,
        referencias,
        embalagens,
        precoVenda,
        custo,
        agora,
      });

      if (falhas.length > 0) return err(agregarErros(falhas));

      await repositorios.produtos.salvar(produto);

      return ok(produto);
    });
  }
}

interface Mudancas {
  readonly sku: string;
  readonly descricao: string;
  readonly descricaoPdv?: string | undefined;
  readonly precoVenda: Dinheiro;
  readonly custo: Dinheiro | undefined;
  readonly codigoBarras: CodigoBarras | undefined;
  readonly codigoBalanca?: string | undefined;
  readonly categoriaId?: Identificador | undefined;
  readonly referencias: readonly ReferenciaProduto[];
  readonly embalagens: readonly Embalagem[];
  readonly ativo: boolean;
  readonly agora: Date;
}

/**
 * Aplica as mudanças, acumulando o que falhou.
 *
 * Cada chamada é registrada mesmo depois de a primeira falhar, para que o
 * usuário receba todos os campos errados de uma vez. Quem chama descarta o
 * agregado quando a lista volta não vazia — a transação é desfeita.
 */
function aplicar(produto: Produto, mudancas: Mudancas): ErroValidacao[] {
  const falhas: ErroValidacao[] = [];

  const sku = produto.alterarSku(mudancas.sku);
  if (sku.isErr()) falhas.push(sku.error);

  const descricao = produto.alterarDescricao(mudancas.descricao, mudancas.descricaoPdv);
  if (descricao.isErr()) falhas.push(descricao.error);

  const preco = produto.alterarPreco(mudancas.precoVenda, mudancas.agora);
  if (preco.isErr()) falhas.push(preco.error);

  if (mudancas.custo !== undefined) {
    const custo = produto.alterarCusto(mudancas.custo, mudancas.agora);
    if (custo.isErr()) falhas.push(custo.error);
  }

  const balanca = produto.definirCodigoBalanca(mudancas.codigoBalanca);
  if (balanca.isErr()) falhas.push(...balanca.error);

  const referencias = produto.substituirReferencias(mudancas.referencias);
  if (referencias.isErr()) falhas.push(...referencias.error);

  const embalagens = produto.substituirEmbalagens(mudancas.embalagens);
  if (embalagens.isErr()) falhas.push(...embalagens.error);

  produto.definirCodigoBarras(mudancas.codigoBarras);
  produto.definirCategoria(mudancas.categoriaId);

  if (mudancas.ativo) produto.ativar(mudancas.agora);
  else produto.desativar(mudancas.agora);

  return falhas;
}
