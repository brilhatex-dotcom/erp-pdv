/**
 * Filtro das buscas da retaguarda.
 *
 * O limite é obrigatório por decisão de desempenho: a tela nunca pede "todos".
 * Uma loja com cinquenta mil produtos não deve conseguir montar uma consulta
 * que devolva cinquenta mil linhas para uma lista que mostra vinte.
 *
 * Vive num arquivo próprio porque é o mesmo filtro para produto, cliente e
 * fornecedor. Deixá-lo dentro do arquivo de um deles faria os outros importarem
 * de um vizinho sem relação — e a primeira mudança quebraria os três.
 */
export interface FiltroBusca {
  /** O que foi digitado. Vazio significa "os primeiros", não "todos". */
  readonly termo?: string | undefined;
  readonly apenasAtivos?: boolean | undefined;
  readonly limite: number;
}
