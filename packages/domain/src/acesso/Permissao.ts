/**
 * Catálogo de permissões — `recurso:acao` (ARQUITETURA.md §9.3).
 *
 * É uma lista fechada, e não texto livre, para que uma permissão escrita errada
 * seja erro de compilação em vez de acesso silenciosamente negado. Permissão que
 * não existe se comporta exatamente como permissão não concedida, e esse é o
 * defeito mais difícil de diagnosticar em autorização: nada quebra, alguém
 * apenas não consegue trabalhar.
 */
export const PERMISSOES = [
  // ── Venda ─────────────────────────────────────────────────────────────
  "venda:criar",
  "venda:cancelar",
  "venda:desconto",
  /**
   * Desconto acima do limite do papel.
   *
   * Separada de `venda:desconto` porque o limite é a regra que segura o furto
   * interno: o operador pode dar 5%, e passar disso exige alguém que responda
   * por isso (§9.4).
   */
  "venda:desconto_acima_limite",
  "venda:consultar_propria",
  "venda:consultar_todas",

  // ── Produto ───────────────────────────────────────────────────────────
  "produto:criar",
  "produto:editar",
  "produto:alterar_preco",
  /**
   * Ver o custo de compra.
   *
   * Separada de `produto:editar` de propósito: em muitas empresas a margem é
   * informação estratégica, e quem opera o caixa não deve vê-la. Juntar as duas
   * transformaria "pode corrigir a descrição" em "conhece a margem de tudo".
   */
  "produto:ver_custo",

  // ── Estoque ───────────────────────────────────────────────────────────
  "estoque:entrada",
  "estoque:ajuste",
  "estoque:inventario",

  // ── Caixa ─────────────────────────────────────────────────────────────
  "caixa:abrir",
  "caixa:fechar",
  "caixa:sangria",
  "caixa:reabrir",

  // ── Fiscal ────────────────────────────────────────────────────────────
  "fiscal:emitir",
  "fiscal:cancelar",
  "fiscal:inutilizar",
  "fiscal:configurar",

  // ── Financeiro ────────────────────────────────────────────────────────
  "financeiro:ver",
  "financeiro:lancar",
  "financeiro:conciliar",

  // ── Relatórios ────────────────────────────────────────────────────────
  "relatorio:vendas",
  "relatorio:financeiro",
  "relatorio:margem",

  // ── Usuários ──────────────────────────────────────────────────────────
  "usuario:criar",
  "usuario:editar_permissoes",

  // ── Configuração ──────────────────────────────────────────────────────
  "config:empresa",
  "config:fiscal",
  "config:backup",
] as const;

export type Permissao = (typeof PERMISSOES)[number];

const CONHECIDAS: ReadonlySet<string> = new Set(PERMISSOES);

/**
 * Estreita texto para `Permissao`.
 *
 * Necessário na fronteira: permissão que chega do banco ou de uma requisição é
 * texto até ser verificada. Uma permissão desconhecida vinda do banco significa
 * que a base é mais nova que o código — situação real durante atualização — e
 * precisa ser ignorada, não confiada.
 */
export function ehPermissao(valor: string): valor is Permissao {
  return CONHECIDAS.has(valor);
}
