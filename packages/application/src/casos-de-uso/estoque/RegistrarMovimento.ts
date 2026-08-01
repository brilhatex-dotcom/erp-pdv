import {
  type CodigoUnidade,
  Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type ErroValidacao,
  type Identificador,
  MovimentoEstoque,
  ok,
  type OrigemMovimento,
  type Produto,
  Quantidade,
  type Result,
  type TipoMovimento,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

/**
 * Tipos que **não** entram por lançamento manual.
 *
 * `SAIDA` é a venda, e só a venda a produz: um lançamento manual de saída seria
 * mercadoria que sumiu do estoque sem sair do caixa, e a conferência do fim do
 * mês não teria como distinguir isso de furto. Quem precisa registrar quebra
 * usa `PERDA`, que exige justificativa.
 *
 * `TRANSFERENCIA_*` não tem para onde ir: uma instalação é uma loja (ADR-0024),
 * então não existe destino. O tipo continua no domínio para quando existir.
 */
const SO_PELO_SISTEMA: ReadonlySet<TipoMovimento> = new Set<TipoMovimento>([
  "SAIDA",
  "TRANSFERENCIA_ENTRADA",
  "TRANSFERENCIA_SAIDA",
]);

export interface EntradaMovimento {
  readonly produtoId: Identificador;
  readonly tipo: TipoMovimento;
  /** Milésimos, sempre positiva. O sinal vem do tipo. */
  readonly quantidade: bigint;
  /**
   * Unidade em que a quantidade foi informada.
   *
   * Pode ser uma **embalagem** do produto: recebeu 3 fardos, o sistema lança 36
   * unidades. É a conta que hoje o dono faz de cabeça na entrada da mercadoria
   * — e é por errá-la que o estoque nunca fecha.
   */
  readonly unidade: CodigoUnidade;
  /**
   * Centavos, **por unidade informada**. Convertido junto com a quantidade: se
   * o fardo de 12 custou R$ 60,00, a unidade entra a R$ 5,00.
   *
   * Ausente quando quem lança não pode ver custo — nesse caso o custo médio
   * fica como está, o que é melhor que recalculá-lo com zero.
   */
  readonly custoUnitario?: bigint | undefined;
  readonly lote?: string | undefined;
  readonly observacao?: string | undefined;
  readonly usuarioId: Identificador;
  readonly origem?: OrigemMovimento | undefined;
}

/**
 * Registra um movimento de estoque.
 *
 * O movimento é um **fato imutável** (ADR-0007): correção não altera o
 * lançamento anterior, gera um novo. É o que permite responder numa
 * fiscalização o que aconteceu, quando e por quem.
 */
export class RegistrarMovimento {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaMovimento,
  ): Promise<Result<MovimentoEstoque, DomainError>> {
    if (SO_PELO_SISTEMA.has(entrada.tipo)) {
      return err(
        new ErroRegraNegocio(
          "MOVIMENTO_NAO_MANUAL",
          "Este tipo de movimento é gerado pelo sistema e não pode ser lançado à mão.",
          { tipo: entrada.tipo },
        ),
      );
    }

    const informada = Quantidade.deMilesimos(entrada.quantidade, entrada.unidade);
    if (informada.isErr()) return err(informada.error);

    const agora = this.relogio.agora();

    return this.unitOfWork.transacao(async (repositorios) => {
      const produto = await repositorios.produtos.porId(entrada.produtoId);

      if (produto === undefined) {
        return err(
          new ErroNaoEncontrado("PRODUTO_NAO_ENCONTRADO", "Produto não encontrado."),
        );
      }

      // Produto inativo continua recebendo movimento de propósito: é assim que
      // se dá baixa no que sobrou de um item que saiu de linha, ou se devolve
      // ao fornecedor o resto do lote. Bloquear aqui deixaria saldo preso num
      // produto que ninguém mais consegue mexer.

      const convertida = converter(produto, informada.unwrap(), entrada.custoUnitario);
      if (convertida.isErr()) return err(convertida.error);

      const { quantidade, custoUnitario } = convertida.unwrap();

      const movimento = MovimentoEstoque.criar({
        id: this.geradorId.proximo(),
        produtoId: produto.id,
        tipo: entrada.tipo,
        quantidade,
        origem: entrada.origem ?? { tipo: "MANUAL" },
        usuarioId: entrada.usuarioId,
        ocorridoEm: agora,
        custoUnitario,
        lote: entrada.lote,
        observacao: entrada.observacao,
      });

      if (movimento.isErr()) return err(movimento.error);

      await repositorios.estoque.registrar(movimento.unwrap());

      return ok(movimento.unwrap());
    });
  }
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
function converter(
  produto: Produto,
  informada: Quantidade,
  centavos: bigint | undefined,
): Result<NaUnidadeBase, ErroValidacao> {
  const convertida = produto.converterParaUnidadeBase(informada);
  if (convertida.isErr()) return err(convertida.error);

  const quantidade = convertida.unwrap();

  if (centavos === undefined) return ok({ quantidade, custoUnitario: undefined });

  const informado = Dinheiro.deCentavos(centavos);
  if (informado.isErr()) return err(informado.error);

  // Custo total dividido pela quantidade base: R$ 60,00 o fardo de 12 vira
  // R$ 5,00 a unidade. Sem isto, o custo médio do produto passaria a ser o
  // preço do fardo, e a margem de todo relatório iria junto.
  const porUnidadeBase = informado
    .unwrap()
    .escalar(informada.milesimos, quantidade.milesimos);

  return ok({ quantidade, custoUnitario: porUnidadeBase });
}
