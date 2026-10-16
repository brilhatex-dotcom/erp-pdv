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
  type Quantidade,
  type ReferenciaProduto,
  type Result,
} from "@erp/domain";

import { auditar } from "../../auditoria/RegistroAuditoria.js";
import { agregarErros } from "../../erros/agregarErros.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import {
  conferirCategoria,
  conferirCodigosLivres,
  conferirVinculos,
} from "./CadastrarProduto.js";
import {
  type EmbalagemBruta,
  interpretarCentavos,
  interpretarCodigoBarras,
  interpretarEmbalagens,
  interpretarEstoqueMinimo,
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
  /** Milésimos na unidade base. Ausente tira o produto da lista de reposição. */
  readonly estoqueMinimo?: bigint | undefined;
  readonly fornecedorId?: Identificador | undefined;
  readonly imagemId?: Identificador | undefined;
  readonly botaoRapido?: boolean | undefined;
  /** Quem salva — a mudança de preço vai para a auditoria com o nome. */
  readonly usuarioId: Identificador;
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
    private readonly geradorId: GeradorId,
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

      const precoAnterior = produto.precoVenda;

      const estoqueMinimo = interpretarEstoqueMinimo(
        entrada.estoqueMinimo,
        produto.unidadeBase.codigo,
        problemas,
      );
      if (problemas.length > 0) return err(agregarErros(problemas));

      const vinculo = await conferirVinculos(repositorios, entrada);
      if (vinculo !== undefined) return err(vinculo);

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
        estoqueMinimo,
        agora,
      });

      if (falhas.length > 0) return err(agregarErros(falhas));

      if (!precoAnterior.equals(produto.precoVenda)) {
        await auditarPreco(repositorios, this.geradorId, {
          produto,
          anterior: precoAnterior,
          usuarioId: entrada.usuarioId,
          agora,
        });
      }

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
  readonly estoqueMinimo: Quantidade | undefined;
  readonly fornecedorId?: Identificador | undefined;
  readonly imagemId?: Identificador | undefined;
  readonly botaoRapido?: boolean | undefined;
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

  const minimo = produto.definirEstoqueMinimo(mudancas.estoqueMinimo);
  /* v8 ignore next -- inalcançável: montado na unidade do produto, e o negativo já foi recusado */
  if (minimo.isErr()) falhas.push(...minimo.error);

  produto.definirCodigoBarras(mudancas.codigoBarras);
  produto.definirCategoria(mudancas.categoriaId);
  produto.definirFornecedor(mudancas.fornecedorId);
  produto.definirImagem(mudancas.imagemId);
  produto.definirBotaoRapido(mudancas.botaoRapido ?? false);

  if (mudancas.ativo) produto.ativar(mudancas.agora);
  else produto.desativar(mudancas.agora);

  return falhas;
}

/**
 * Registra a troca de preço, de onde quer que ela venha.
 *
 * Exportada porque a correção rápida do supervisor (`AlterarPrecoDoProduto`)
 * e o formulário completo mudam o mesmo preço — e dois textos de auditoria
 * diferentes para a mesma mudança tornariam a busca por ela incompleta.
 */
export async function auditarPreco(
  repositorios: Parameters<typeof auditar>[0],
  geradorId: GeradorId,
  dados: {
    readonly produto: Produto;
    readonly anterior: Dinheiro;
    readonly usuarioId: Identificador;
    readonly agora: Date;
  },
): Promise<void> {
  await auditar(repositorios, geradorId, {
    ocorridoEm: dados.agora,
    acao: "PRECO_ALTERADO",
    usuarioId: dados.usuarioId,
    descricao: `Preço de ${dados.produto.descricao}: de ${dados.anterior.formatar()} para ${dados.produto.precoVenda.formatar()}`,
    entidade: "produto",
    entidadeId: dados.produto.id,
    dados: {
      de: dados.anterior.centavos.toString(),
      para: dados.produto.precoVenda.centavos.toString(),
    },
  });
}
