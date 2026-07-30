/**
 * Contrato dos objetos de valor.
 *
 * Objeto de valor não tem identidade: dois `Dinheiro` de R$ 10,00 são o mesmo
 * valor. Por isso a igualdade é **estrutural**, e cada tipo sabe compará-la
 * melhor do que uma comparação genérica saberia — `Dinheiro` compara centavos,
 * `Quantidade` compara valor **e** unidade.
 *
 * Deliberadamente uma interface, não uma classe base. Uma base genérica com
 * `props` obrigaria os objetos a guardar estado num formato conveniente para
 * ela, e não para o próprio domínio — abstração que atrapalha em vez de ajudar
 * (CLAUDE.md §4, princípio 6).
 */
export interface ValueObject<T> {
  /** Igualdade estrutural. */
  equals(outro: T): boolean;
}
