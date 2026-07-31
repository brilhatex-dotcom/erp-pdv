import { ErroValidacao } from "@erp/domain";

/**
 * Reúne os erros de um formulário num único erro transportável.
 *
 * O domínio devolve **lista** de `ErroValidacao` no cadastro longo, de
 * propósito: o usuário precisa ver os cinco campos errados de uma vez. Mas a
 * fronteira — HTTP, fila, importador — trafega **um** erro. Espremer a lista em
 * "o primeiro" desfaria justamente o que o domínio se deu ao trabalho de fazer,
 * e o operador voltaria a corrigir um campo por gravação.
 *
 * A saída carrega a lista em `detalhes.erros`, que o adapter HTTP repassa ao
 * cliente. Cada item já é seguro para exibir: `mensagem` de `DomainError` é,
 * por contrato, escrita para o operador (CLAUDE.md §9).
 */
export function agregarErros(erros: readonly ErroValidacao[]): ErroValidacao {
  const primeiro = erros[0];

  /* v8 ignore next 3 -- inalcançável: só se chama com lista não vazia */
  if (primeiro === undefined) {
    return new ErroValidacao("DADOS_INVALIDOS", "Confira os dados informados.");
  }

  // Erro único não vira agregado: preserva o código específico, que é o que
  // teste e log usam para identificar a regra violada.
  if (erros.length === 1) return primeiro;

  return new ErroValidacao("DADOS_INVALIDOS", "Confira os campos destacados.", {
    erros: erros.map((erro) => ({ codigo: erro.codigo, mensagem: erro.mensagem })),
  });
}
