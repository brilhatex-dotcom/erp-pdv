import {
  type Dinheiro,
  type DomainError,
  err,
  type ErroValidacao,
  type Identificador,
  MovimentoEstoque,
  ok,
  type OrigemMovimento,
  type Produto,
  type Quantidade,
  type Result,
  type TipoMovimento,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";

/**
 * O ato de mover estoque, sem a transação em volta.
 *
 * Existe como função, e não só dentro de `RegistrarMovimento`, porque a entrada
 * de mercadoria precisa do mesmo comportamento **dentro da transação da nota**:
 * a nota e os movimentos que ela gera são atômicos, ou o estoque sobe sem
 * documento que o explique. Chamar um caso de uso de dentro de outro abriria
 * uma segunda transação, e a atomicidade se perderia justamente aí.
 */

export interface DadosMovimentacao {
  readonly tipo: TipoMovimento;
  /** Na unidade em que a mercadoria foi contada — pode ser uma embalagem. */
  readonly quantidade: Quantidade;
  /** Centavos, por unidade **informada**. Convertido junto com a quantidade. */
  readonly custoUnitario?: Dinheiro | undefined;
  readonly lote?: string | undefined;
  readonly observacao?: string | undefined;
  readonly usuarioId: Identificador;
  readonly origem: OrigemMovimento;
  readonly ocorridoEm: Date;
}

export async function movimentar(
  repositorios: Pick<Repositorios, "estoque">,
  geradorId: GeradorId,
  produto: Produto,
  dados: DadosMovimentacao,
): Promise<Result<MovimentoEstoque, DomainError>> {
  const convertido = converter(produto, dados.quantidade, dados.custoUnitario);
  if (convertido.isErr()) return err(convertido.error);

  const { quantidade, custoUnitario } = convertido.unwrap();

  const movimento = MovimentoEstoque.criar({
    id: geradorId.proximo(),
    produtoId: produto.id,
    tipo: dados.tipo,
    quantidade,
    origem: dados.origem,
    usuarioId: dados.usuarioId,
    ocorridoEm: dados.ocorridoEm,
    custoUnitario,
    lote: dados.lote,
    observacao: dados.observacao,
  });

  if (movimento.isErr()) return err(movimento.error);

  await repositorios.estoque.registrar(movimento.unwrap());

  return ok(movimento.unwrap());
}

/** Quantidade e custo já na unidade base do produto. */
interface NaUnidadeBase {
  readonly quantidade: Quantidade;
  readonly custoUnitario: Dinheiro | undefined;
}

/**
 * Converte quantidade e custo para a unidade base do produto.
 *
 * Os dois andam juntos de propósito: o custo informado é **por unidade
 * informada**, e a proporção que o converte é a mesma que converte a
 * quantidade. Calculá-los em lugares separados é como um deles deixa de
 * acompanhar o outro.
 */
export function converter(
  produto: Produto,
  informada: Quantidade,
  custo: Dinheiro | undefined,
): Result<NaUnidadeBase, ErroValidacao> {
  const convertida = produto.converterParaUnidadeBase(informada);
  if (convertida.isErr()) return err(convertida.error);

  const quantidade = convertida.unwrap();

  if (custo === undefined) return ok({ quantidade, custoUnitario: undefined });

  // Custo total dividido pela quantidade base: R$ 60,00 o fardo de 12 vira
  // R$ 5,00 a unidade. Sem isto, o custo médio do produto passaria a ser o
  // preço do fardo, e a margem de todo relatório iria junto.
  return ok({
    quantidade,
    custoUnitario: custo.escalar(informada.milesimos, quantidade.milesimos),
  });
}
