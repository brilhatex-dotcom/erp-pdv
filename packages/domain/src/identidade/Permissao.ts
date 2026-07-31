/**
 * Catálogo de permissões, no formato `recurso:acao`.
 *
 * É uma **união fechada**, não `string`. A diferença aparece no dia em que
 * alguém escreve `"venda:cancela"` num decorador de autorização: com `string`,
 * a verificação simplesmente nunca encontra a permissão e a rota fica aberta ou
 * fechada por engano, em silêncio. Com a união, o TypeScript recusa o typo.
 *
 * A granularidade segue casos reais do balcão (ARQUITETURA.md §9.3), não uma
 * simetria bonita: `produto:ver_custo` é separado de `produto:editar` porque em
 * boa parte das lojas o custo de compra é informação estratégica que o operador
 * de caixa não deve enxergar.
 */
export const PERMISSOES = [
  // Vendas
  "venda:criar",
  "venda:cancelar",
  "venda:desconto",
  "venda:desconto_acima_limite",
  "venda:consultar_propria",
  "venda:consultar_todas",

  // Catálogo
  "produto:criar",
  "produto:editar",
  "produto:alterar_preco",
  "produto:ver_custo",

  // Estoque
  "estoque:entrada",
  "estoque:ajuste",
  "estoque:inventario",

  // Caixa
  "caixa:abrir",
  "caixa:fechar",
  "caixa:sangria",
  "caixa:reabrir",

  // Fiscal — só existe com o módulo habilitado (ADR-0016)
  "fiscal:emitir",
  "fiscal:cancelar",
  "fiscal:inutilizar",
  "fiscal:configurar",

  // Financeiro
  "financeiro:ver",
  "financeiro:lancar",
  "financeiro:conciliar",

  // Relatórios
  "relatorio:vendas",
  "relatorio:financeiro",
  "relatorio:margem",

  // Administração
  "usuario:criar",
  "usuario:editar_permissoes",
  "config:empresa",
  "config:fiscal",
  "config:backup",
] as const;

export type Permissao = (typeof PERMISSOES)[number];

export function ehPermissao(valor: string): valor is Permissao {
  return (PERMISSOES as readonly string[]).includes(valor);
}
