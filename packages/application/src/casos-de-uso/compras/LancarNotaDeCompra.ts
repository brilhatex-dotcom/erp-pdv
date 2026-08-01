import {
  type CodigoUnidade,
  Dinheiro,
  type DomainError,
  err,
  ErroConflito,
  ErroNaoEncontrado,
  type ErroValidacao,
  type Identificador,
  ItemDaNota,
  NotaDeCompra,
  ok,
  type Produto,
  Quantidade,
  type Result,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";
import { movimentar } from "../estoque/movimentar.js";

export interface ItemBruto {
  readonly produtoId: Identificador;
  /** Milésimos, na unidade em que a mercadoria chegou. */
  readonly quantidade: bigint;
  readonly unidade: CodigoUnidade;
  /** Centavos, por unidade da nota. */
  readonly custoUnitario: bigint;
  /** Centavos — desconto do fornecedor nesta linha. */
  readonly desconto?: bigint | undefined;
}

export interface EntradaLancarNota {
  readonly fornecedorId: Identificador;
  readonly numero: string;
  readonly serie?: string | undefined;
  readonly emitidaEm: Date;
  readonly recebidaEm: Date;
  readonly itens: readonly ItemBruto[];
  /** Centavos — o total impresso na nota, para conferência de digitação. */
  readonly totalDeclarado: bigint;
  readonly observacao?: string | undefined;
  readonly usuarioId: Identificador;
}

/**
 * Lança a nota de entrada e move o estoque.
 *
 * ### Nota e movimentos são atômicos
 *
 * Tudo acontece numa transação só: ou a nota existe **com** os movimentos que
 * ela gerou, ou nada aconteceu. Meio caminho aqui é estoque que subiu sem
 * documento que o explique — e a conferência do inventário fica sem resposta.
 *
 * ### A duplicidade é o defeito a evitar
 *
 * A mesma nota lançada duas vezes dobra o estoque e some no meio de centenas de
 * lançamentos. A verificação por fornecedor + número + série acontece **dentro**
 * da transação; o índice único do banco é a garantia final quando duas telas
 * gravam no mesmo instante.
 *
 * ### O custo do cadastro é atualizado
 *
 * `Produto.custo` passa a ser o custo da última compra, com o desconto do
 * fornecedor embutido. Sem isso, o alerta de venda abaixo do custo compararia o
 * preço de hoje com um custo digitado uma vez no cadastro e nunca mais tocado —
 * que é exatamente o defeito que o alerta existe para pegar.
 *
 * Não confundir com o **custo médio ponderado**, que vive no saldo do estoque e
 * responde outra pergunta: quanto vale o que está na prateleira. Um é o último
 * preço pago; o outro, a média do que ainda não foi vendido.
 */
export class LancarNotaDeCompra {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(entrada: EntradaLancarNota): Promise<Result<NotaDeCompra, DomainError>> {
    const problemas: ErroValidacao[] = [];

    const totalDeclarado = interpretarCentavos(entrada.totalDeclarado, problemas);
    const brutos = interpretarItens(entrada.itens, problemas);

    if (problemas.length > 0 || totalDeclarado === undefined) {
      return err(agregarErros(problemas));
    }

    const agora = this.relogio.agora();

    return this.unitOfWork.transacao(async (repositorios) => {
      const fornecedor = await repositorios.fornecedores.porId(entrada.fornecedorId);

      if (fornecedor === undefined) {
        return err(
          new ErroNaoEncontrado(
            "FORNECEDOR_NAO_ENCONTRADO",
            "Fornecedor não encontrado. Cadastre-o antes de lançar a nota.",
          ),
        );
      }

      const jaLancada = await repositorios.notasDeCompra.porChave(
        entrada.fornecedorId,
        entrada.numero,
        entrada.serie,
      );

      if (jaLancada !== undefined) {
        return err(
          new ErroConflito(
            "NOTA_JA_LANCADA",
            `A nota ${jaLancada.chave} deste fornecedor já foi lançada. Lançá-la de novo dobraria o estoque.`,
            { notaId: jaLancada.id.valor },
          ),
        );
      }

      const carregados = await carregarProdutos(repositorios, brutos);
      if (carregados.isErr()) return err(carregados.error);

      const itens = montarItens(carregados.unwrap());
      if (itens.isErr()) return err(agregarErros(itens.error));

      const nota = NotaDeCompra.criar({
        id: this.geradorId.proximo(),
        fornecedorId: entrada.fornecedorId,
        numero: entrada.numero,
        serie: entrada.serie,
        emitidaEm: entrada.emitidaEm,
        recebidaEm: entrada.recebidaEm,
        itens: itens.unwrap(),
        totalDeclarado,
        usuarioId: entrada.usuarioId,
        observacao: entrada.observacao,
      });

      if (nota.isErr()) return err(agregarErros(nota.error));

      await repositorios.notasDeCompra.salvar(nota.unwrap());

      const efeito = await aplicarNoEstoque(
        repositorios,
        this.geradorId,
        nota.unwrap(),
        carregados.unwrap(),
        agora,
      );

      if (efeito.isErr()) return err(efeito.error);

      return ok(nota.unwrap());
    });
  }
}

/** Uma linha da nota já com o produto que ela referencia. */
interface LinhaCarregada {
  readonly produto: Produto;
  readonly quantidade: Quantidade;
  readonly custoUnitario: Dinheiro;
  readonly desconto: Dinheiro | undefined;
}

async function carregarProdutos(
  repositorios: Pick<Repositorios, "produtos">,
  brutos: readonly LinhaInterpretada[],
): Promise<Result<readonly LinhaCarregada[], DomainError>> {
  const carregadas: LinhaCarregada[] = [];

  for (const bruto of brutos) {
    const produto = await repositorios.produtos.porId(bruto.produtoId);

    if (produto === undefined) {
      return err(
        new ErroNaoEncontrado(
          "PRODUTO_NAO_ENCONTRADO",
          "Um dos produtos da nota não existe mais. Atualize a tela.",
          { produtoId: bruto.produtoId.valor },
        ),
      );
    }

    carregadas.push({
      produto,
      quantidade: bruto.quantidade,
      custoUnitario: bruto.custoUnitario,
      desconto: bruto.desconto,
    });
  }

  return ok(carregadas);
}

function montarItens(
  linhas: readonly LinhaCarregada[],
): Result<readonly ItemDaNota[], ErroValidacao[]> {
  const itens: ItemDaNota[] = [];
  const erros: ErroValidacao[] = [];

  for (const [posicao, linha] of linhas.entries()) {
    const item = ItemDaNota.criar(posicao + 1, {
      produtoId: linha.produto.id,
      // Congelada agora: renomear o produto amanhã não reescreve a nota.
      descricao: linha.produto.descricao,
      quantidade: linha.quantidade,
      custoUnitario: linha.custoUnitario,
      desconto: linha.desconto,
    });

    if (item.isErr()) erros.push(item.error);
    else itens.push(item.unwrap());
  }

  return erros.length > 0 ? err(erros) : ok(itens);
}

/**
 * Gera os movimentos de entrada e atualiza o custo do cadastro.
 *
 * O custo que vai para o estoque é o **efetivo** — já com o desconto do
 * fornecedor embutido —, porque é o que a loja pagou de verdade.
 */
async function aplicarNoEstoque(
  repositorios: Pick<Repositorios, "estoque" | "produtos">,
  geradorId: GeradorId,
  nota: NotaDeCompra,
  linhas: readonly LinhaCarregada[],
  agora: Date,
): Promise<Result<void, DomainError>> {
  for (const [posicao, linha] of linhas.entries()) {
    const item = nota.itens[posicao];
    /* v8 ignore next -- inalcançável: itens e linhas são a mesma lista */
    if (item === undefined) continue;

    const movimento = await movimentar(repositorios, geradorId, linha.produto, {
      tipo: "ENTRADA",
      quantidade: item.quantidade,
      custoUnitario: item.custoEfetivo,
      usuarioId: nota.usuarioId,
      origem: { tipo: "COMPRA", documentoId: nota.id },
      // A data da entrada da mercadoria, não a de hoje: lançar uma nota de
      // ontem precisa colocar o movimento em ontem, senão o custo médio sai da
      // ordem em que as compras aconteceram de verdade.
      ocorridoEm: nota.recebidaEm,
    });

    if (movimento.isErr()) return err(movimento.error);

    const custoNaUnidadeBase = movimento.unwrap().custoUnitario;

    if (custoNaUnidadeBase !== undefined) {
      const alterado = linha.produto.alterarCusto(custoNaUnidadeBase, agora);
      if (alterado.isErr()) return err(alterado.error);

      await repositorios.produtos.salvar(linha.produto);
    }
  }

  return ok(undefined);
}

interface LinhaInterpretada {
  readonly produtoId: Identificador;
  readonly quantidade: Quantidade;
  readonly custoUnitario: Dinheiro;
  readonly desconto: Dinheiro | undefined;
}

function interpretarItens(
  brutos: readonly ItemBruto[],
  erros: ErroValidacao[],
): readonly LinhaInterpretada[] {
  const linhas: LinhaInterpretada[] = [];

  for (const bruto of brutos) {
    const quantidade = Quantidade.deMilesimos(bruto.quantidade, bruto.unidade);
    const custoUnitario = Dinheiro.deCentavos(bruto.custoUnitario);
    const desconto =
      bruto.desconto === undefined ? undefined : Dinheiro.deCentavos(bruto.desconto);

    if (quantidade.isErr()) erros.push(quantidade.error);
    if (custoUnitario.isErr()) erros.push(custoUnitario.error);
    if (desconto?.isErr() === true) erros.push(desconto.error);

    if (quantidade.isErr() || custoUnitario.isErr() || desconto?.isErr() === true) {
      continue;
    }

    linhas.push({
      produtoId: bruto.produtoId,
      quantidade: quantidade.unwrap(),
      custoUnitario: custoUnitario.unwrap(),
      desconto: desconto?.unwrap(),
    });
  }

  return linhas;
}

function interpretarCentavos(
  centavos: bigint,
  erros: ErroValidacao[],
): Dinheiro | undefined {
  const valor = Dinheiro.deCentavos(centavos);

  if (valor.isErr()) {
    erros.push(valor.error);
    return undefined;
  }

  return valor.unwrap();
}
