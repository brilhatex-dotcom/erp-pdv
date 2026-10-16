import {
  ConfiguracaoLoja,
  type Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  type Identificador,
  ok,
  type Produto,
  type Result,
  type ResumoVenda,
  type Venda,
  type VendaItem,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";

/**
 * Peças que os casos de uso da venda compartilham.
 *
 * Moram juntas porque cada uma é a **mesma** pergunta feita por vários casos de
 * uso, e duas respostas diferentes à mesma pergunta são o defeito que se quer
 * evitar: o custo de uma venda calculado de um jeito na bipada e de outro na
 * devolução produziria uma margem que nenhum relatório consegue explicar.
 */

export async function carregarVenda(
  repositorios: Repositorios,
  vendaId: Identificador,
): Promise<Result<Venda, DomainError>> {
  const venda = await repositorios.vendas.porId(vendaId);

  if (venda === undefined) {
    return err(
      new ErroNaoEncontrado("VENDA_NAO_ENCONTRADA", "Venda não encontrada.", {
        vendaId: vendaId.valor,
      }),
    );
  }

  return ok(venda);
}

/**
 * A configuração da loja — ou a de fábrica, enquanto ninguém configurou.
 *
 * A de fábrica não é gravada aqui: ler não pode ter efeito colateral, e a
 * primeira gravação é decisão de quem configura, na retaguarda.
 */
export async function configuracaoDaLoja(
  repositorios: Repositorios,
  geradorId: GeradorId,
): Promise<ConfiguracaoLoja> {
  return (
    (await repositorios.configuracao.atual()) ??
    ConfiguracaoLoja.padrao(geradorId.proximo())
  );
}

/**
 * O custo da unidade **agora**, para congelar no item vendido.
 *
 * Primeiro o custo médio do estoque, que é o que a contabilidade chama de CMV
 * pelo método do custo médio ponderado móvel: ele já reflete o que a loja de
 * fato pagou nas compras lançadas. Sem compra lançada, o custo informado no
 * cadastro — a estimativa do dono. Sem nenhum dos dois, **desconhecido**: zero
 * aqui faria o relatório mostrar margem de 100% numa venda que não deu lucro.
 */
export async function custoNoMomento(
  repositorios: Repositorios,
  produto: Produto,
): Promise<Dinheiro | undefined> {
  const saldo = await repositorios.estoque.saldo(produto.id, produto.unidadeBase.codigo);

  if (saldo.custoMedio.ehPositivo()) return saldo.custoMedio;
  if (produto.custo.ehPositivo()) return produto.custo;

  return undefined;
}

/** O que o caixa precisa saber de uma venda — na entrada e no estorno. */
export function resumoParaCaixa(venda: Venda): ResumoVenda {
  return {
    vendaId: venda.id,
    total: venda.total,
    pagamentos: venda.pagamentos.map((pagamento) => ({
      forma: pagamento.forma.codigo,
      valor: pagamento.valor,
    })),
    troco: venda.troco,
    desconto: venda.descontoTotal,
  };
}

/** "2 un de Refrigerante (item 3)" — como o item aparece num registro de auditoria. */
export function descreverItem(item: VendaItem): string {
  return `${item.quantidade.formatar()} de ${item.descricao} (item ${String(item.numero)})`;
}

/** Soma o que a venda já tem de um produto — a base da conferência de estoque. */
export function quantidadeNaVenda(venda: Venda, produtoId: Identificador): bigint {
  return venda.itens
    .filter((item) => item.produtoId.equals(produtoId))
    .reduce((soma, item) => soma + item.quantidade.milesimos, 0n);
}

/** Percentual em pontos-base, formatado como o dono lê: `1050` → "10,5%". */
export function formatarPercentual(bps: number): string {
  const inteiro = Math.trunc(bps / 100);
  const fracao = Math.abs(bps % 100);

  if (fracao === 0) return `${String(inteiro)}%`;

  return `${String(inteiro)},${String(fracao).padStart(2, "0").replace(/0$/, "")}%`;
}
