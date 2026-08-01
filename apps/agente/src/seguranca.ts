/**
 * A porta de entrada do Agente, e a razão de ela ser estreita.
 *
 * ### O risco que um agente local cria
 *
 * Um serviço HTTP escutando na máquina do caixa é alcançável por **qualquer
 * página aberta naquele navegador** — inclusive uma que o operador abriu por
 * engano. Sem defesa, um site qualquer poderia mandar imprimir, esvaziar a fila
 * ou ler o catálogo da loja. É a falha clássica de agente local, e já derrubou
 * produto grande.
 *
 * ### Três camadas, em ordem de força
 *
 * 1. **Escuta só em `127.0.0.1`.** Ninguém na rede da loja alcança o Agente —
 *    nem o Wi-Fi de visitante, nem a máquina vizinha comprometida.
 *
 * 2. **`Origin` conferido contra lista.** É a defesa que importa: o navegador
 *    preenche esse cabeçalho e **JavaScript não consegue forjá-lo**. Um site
 *    hostil chega com o `Origin` dele, que não está na lista, e o pedido morre
 *    antes de tocar em disco.
 *
 * 3. **Segredo de emparelhamento.** Gravado na instalação, compartilhado com o
 *    servidor da loja. Não protege contra navegador — protege contra programa
 *    local qualquer, que não passa por CORS nenhum.
 *
 * ### Por que o `Host` também é conferido
 *
 * Um atacante pode apontar `mal.exemplo` para `127.0.0.1` e fazer o navegador
 * falar com o Agente achando que é o site dele — é o *DNS rebinding*. O
 * `Origin` já barra isso; conferir o `Host` fecha a porta de novo, por um
 * caminho independente. Duas trancas diferentes na mesma porta.
 */

export interface Requisicao {
  readonly origem: string | undefined;
  readonly host: string | undefined;
  readonly segredo: string | undefined;
}

export type Veredito =
  { readonly tipo: "PERMITIDO" } | { readonly tipo: "NEGADO"; readonly motivo: string };

export interface PoliticaAcesso {
  /** Origens autorizadas — o endereço do servidor da loja. */
  readonly origensPermitidas: readonly string[];
  readonly segredo: string;
}

const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function avaliarAcesso(politica: PoliticaAcesso, pedido: Requisicao): Veredito {
  const anfitriao = (pedido.host ?? "").split(":")[0] ?? "";

  if (!HOSTS_LOCAIS.has(anfitriao)) {
    return { tipo: "NEGADO", motivo: "Host não é a própria máquina." };
  }

  // Pedido sem `Origin` não vem de página: vem de programa local, `curl` ou
  // navegação direta. O segredo decide sozinho nesse caminho.
  if (
    pedido.origem !== undefined &&
    !politica.origensPermitidas.includes(pedido.origem)
  ) {
    return { tipo: "NEGADO", motivo: "Origem não autorizada." };
  }

  if (!segredosIguais(pedido.segredo ?? "", politica.segredo)) {
    return { tipo: "NEGADO", motivo: "Segredo inválido." };
  }

  return { tipo: "PERMITIDO" };
}

/**
 * Compara em tempo constante.
 *
 * Comparar com `===` vaza, pelo tempo de resposta, quantos caracteres iniciais
 * estão certos — e um atacante local descobre o segredo caractere a caractere.
 * O custo de fazer certo é uma dezena de linhas.
 */
function segredosIguais(oferecido: string, esperado: string): boolean {
  if (oferecido.length !== esperado.length) return false;

  let diferenca = 0;

  for (let indice = 0; indice < esperado.length; indice += 1) {
    diferenca |= oferecido.charCodeAt(indice) ^ esperado.charCodeAt(indice);
  }

  return diferenca === 0;
}

/**
 * Cabeçalhos de CORS para uma origem já autorizada.
 *
 * Devolvidos **só** depois de `avaliarAcesso` permitir. Responder
 * `Access-Control-Allow-Origin: *` seria desfazer a camada 2 com uma linha.
 */
export function cabecalhosCors(
  origem: string,
  cabecalhoSegredo: string,
): Record<string, string> {
  return {
    "access-control-allow-origin": origem,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": `content-type, ${cabecalhoSegredo}`,
    "access-control-max-age": "600",
    // Sem credenciais: o Agente não usa cookie, e permiti-las abriria o pedido
    // autenticado do servidor da loja para uma aba qualquer.
    vary: "Origin",
  };
}
