import type { Identificador } from "@erp/domain";

/*
 * Os tipos ficam separados da função `auditar` porque a porta do repositório
 * precisa deles, e a função precisa da porta: juntos, formariam um ciclo.
 */

/**
 * O que se audita.
 *
 * A lista é o que o dono pergunta quando o caixa não bate ou o estoque some:
 * quem cancelou, quem deu desconto, quem tirou item, quem mexeu no preço e no
 * estoque, quem tirou dinheiro da gaveta. Venda comum **não** entra — o
 * registro dela é a própria venda, e auditar cada uma afogaria o que importa.
 */
export type AcaoAuditada =
  | "VENDA_CANCELADA"
  | "VENDA_DESCARTADA"
  | "ITEM_REMOVIDO"
  | "QUANTIDADE_REDUZIDA"
  | "DESCONTO_ITEM"
  | "DESCONTO_VENDA"
  | "PAGAMENTO_REMOVIDO"
  | "VENDA_SEM_ESTOQUE"
  | "FIADO_ACIMA_DO_LIMITE"
  | "DEVOLUCAO"
  | "CAIXA_ABERTO"
  | "CAIXA_FECHADO"
  | "SANGRIA"
  | "SUPRIMENTO"
  | "PRECO_ALTERADO"
  | "ESTOQUE_AJUSTADO"
  | "ESTOQUE_PERDA"
  | "CONFIGURACAO_ALTERADA"
  | "BACKUP_EXECUTADO"
  | "BACKUP_RESTAURADO";

export const ACOES_AUDITADAS: readonly AcaoAuditada[] = [
  "VENDA_CANCELADA",
  "VENDA_DESCARTADA",
  "ITEM_REMOVIDO",
  "QUANTIDADE_REDUZIDA",
  "DESCONTO_ITEM",
  "DESCONTO_VENDA",
  "PAGAMENTO_REMOVIDO",
  "VENDA_SEM_ESTOQUE",
  "FIADO_ACIMA_DO_LIMITE",
  "DEVOLUCAO",
  "CAIXA_ABERTO",
  "CAIXA_FECHADO",
  "SANGRIA",
  "SUPRIMENTO",
  "PRECO_ALTERADO",
  "ESTOQUE_AJUSTADO",
  "ESTOQUE_PERDA",
  "CONFIGURACAO_ALTERADA",
  "BACKUP_EXECUTADO",
  "BACKUP_RESTAURADO",
];

export function ehAcaoAuditada(valor: string): valor is AcaoAuditada {
  return (ACOES_AUDITADAS as readonly string[]).includes(valor);
}

/** Valor simples o bastante para virar JSON sem conversão. Dinheiro vai em texto. */
export type DadoAuditado = string | number | boolean | null;

export interface RegistroAuditoria {
  readonly id: Identificador;
  readonly ocorridoEm: Date;
  readonly acao: AcaoAuditada;
  /** Ausente nas ações do próprio sistema, como o backup agendado. */
  readonly usuarioId?: Identificador | undefined;
  /** Quem liberou, quando a operação passou da alçada de quem pediu. */
  readonly autorizadoPorId?: Identificador | undefined;
  /**
   * Escrita para o dono, que lê a lista sem abrir detalhe nenhum:
   * "Desconto de R$ 2,00 (10%) no item 3 da venda 47".
   */
  readonly descricao: string;
  readonly entidade?: string | undefined;
  readonly entidadeId?: Identificador | undefined;
  readonly dados?: Readonly<Record<string, DadoAuditado>> | undefined;
}
