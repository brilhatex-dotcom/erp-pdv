/**
 * Os caminhos que o Agente Local expõe.
 *
 * Num lugar só, porque cliente e servidor precisam concordar: caminho escrito
 * diferente nos dois lados não dá erro de compilação — dá 404 no meio de uma
 * venda offline, que é quando não há para onde escalar.
 */
export const ROTAS = {
  saude: "/saude",
  estado: "/estado",
  iniciarVenda: "/venda/iniciar",
  item: "/venda/item",
  pagamento: "/venda/pagamento",
  finalizar: "/venda/finalizar",
  cancelar: "/venda/cancelar",
  sincronizar: "/sincronizar",
  imprimirCupom: "/impressao/cupom",
  abrirGaveta: "/impressao/gaveta",
} as const;

/**
 * Porta do Agente Local.
 *
 * Fixa de propósito: a tela precisa encontrá-lo sem configuração, e pedir ao
 * lojista que digite uma porta é um chamado de suporte garantido. Escolhida
 * fora das faixas comuns de desenvolvimento e da 9100 das impressoras de rede.
 */
export const PORTA_AGENTE = 9787;

/** Onde a tela procura o Agente. Sempre a própria máquina. */
export const ENDERECO_AGENTE = `http://127.0.0.1:${String(PORTA_AGENTE)}`;

/**
 * Cabeçalho com o segredo de emparelhamento.
 *
 * O Agente e o servidor da loja compartilham este valor, gravado na instalação.
 * Ele **não** é a defesa principal — a defesa é o `Origin` conferido pelo
 * Agente, que o navegador não deixa forjar. Este cabeçalho é a segunda camada,
 * para o caso de um programa local qualquer resolver falar com o Agente.
 */
export const CABECALHO_SEGREDO = "x-erp-agente";
