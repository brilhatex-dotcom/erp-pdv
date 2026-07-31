/**
 * Natureza de um movimento de estoque.
 *
 * A quantidade informada é **sempre positiva** — quem digita nunca precisa
 * pensar em sinal. É o tipo que decide se soma ou subtrai. Pedir sinal ao
 * usuário é a origem clássica do ajuste de inventário que dobra o erro em vez
 * de corrigi-lo.
 */
export type TipoMovimento =
  | "ENTRADA" // compra de fornecedor
  | "DEVOLUCAO_CLIENTE" // cliente devolveu mercadoria
  | "AJUSTE_POSITIVO" // inventário encontrou a mais
  | "TRANSFERENCIA_ENTRADA" // veio de outra loja
  | "SAIDA" // venda
  | "PERDA" // quebra, vencimento, furto
  | "DEVOLUCAO_FORNECEDOR" // devolveu ao fornecedor
  | "AJUSTE_NEGATIVO" // inventário encontrou a menos
  | "TRANSFERENCIA_SAIDA"; // foi para outra loja

/** Direção de cada tipo: `1` soma ao saldo, `-1` subtrai. */
const EFEITOS: Readonly<Record<TipoMovimento, 1n | -1n>> = {
  ENTRADA: 1n,
  DEVOLUCAO_CLIENTE: 1n,
  AJUSTE_POSITIVO: 1n,
  TRANSFERENCIA_ENTRADA: 1n,
  SAIDA: -1n,
  PERDA: -1n,
  DEVOLUCAO_FORNECEDOR: -1n,
  AJUSTE_NEGATIVO: -1n,
  TRANSFERENCIA_SAIDA: -1n,
};

export function efeitoDoTipo(tipo: TipoMovimento): 1n | -1n {
  return EFEITOS[tipo];
}

export function ehEntrada(tipo: TipoMovimento): boolean {
  return EFEITOS[tipo] === 1n;
}

export function ehSaida(tipo: TipoMovimento): boolean {
  return EFEITOS[tipo] === -1n;
}

/**
 * Tipos que atualizam o custo médio.
 *
 * Só entrada de compra muda o custo. Devolução de cliente retorna mercadoria
 * que já foi custeada, e ajuste de inventário corrige quantidade, não valor —
 * tratá-los como compra distorceria a margem de todos os relatórios.
 */
export function afetaCustoMedio(tipo: TipoMovimento): boolean {
  return tipo === "ENTRADA";
}
