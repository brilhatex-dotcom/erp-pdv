/**
 * Qual estratégia de cache vale para cada pedido.
 *
 * Mora fora do service worker de propósito: é a única parte com **decisão**, e
 * service worker não roda em teste — o que ficar lá dentro não é exercitado por
 * ninguém até quebrar na loja. O `sw.ts` é casca em volta destas funções.
 */

export type Estrategia =
  /** Serve do cache; só vai à rede se não tiver. Para arquivo imutável. */
  | "CACHE_PRIMEIRO"
  /** Tenta a rede; se falhar, serve o que houver. Para a navegação. */
  | "REDE_PRIMEIRO"
  /** Não toca no cache, nem para ler nem para gravar. */
  | "SEMPRE_REDE";

/**
 * Caminhos que o cache **nunca** pode responder.
 *
 * ### `/api` é o que mais importa aqui
 *
 * Um preço servido do cache é um preço errado cobrado do cliente, e um estoque
 * servido do cache é uma venda aceita para mercadoria que acabou. Pior: seria
 * uma **segunda fonte da verdade** dentro do navegador, e o ADR-0023 decidiu
 * que a cópia local do catálogo e a fila de vendas offline são do Agente Local
 * — que grava em disco com `fsync`, coisa que o cache do navegador não promete.
 *
 * O navegador pode descartar o cache dele a qualquer momento, sem avisar. Isso
 * é aceitável para a tela; não é aceitável para uma venda.
 */
const NUNCA_CACHEIA = ["/api/", "/saude"];

export function estrategiaPara(pedido: {
  readonly metodo: string;
  readonly caminho: string;
  readonly ehNavegacao: boolean;
}): Estrategia {
  // Só GET entra em cache. `POST` de venda respondido do cache seria uma venda
  // que o operador vê como feita e que nunca chegou ao servidor.
  if (pedido.metodo !== "GET") return "SEMPRE_REDE";

  if (NUNCA_CACHEIA.some((prefixo) => pedido.caminho.startsWith(prefixo))) {
    return "SEMPRE_REDE";
  }

  // A navegação vai à rede primeiro para pegar a versão nova assim que ela
  // existir. Cair no cache é o que faz a tela abrir com o servidor da loja
  // desligado — princípio 1: o PDV nunca para.
  if (pedido.ehNavegacao) return "REDE_PRIMEIRO";

  // O Vite carimba hash no nome de todo arquivo construído, então `/assets/x-a1b2.js`
  // nunca muda de conteúdo: servir do cache é correto **e** é o caminho rápido.
  if (ehImutavel(pedido.caminho)) return "CACHE_PRIMEIRO";

  return "REDE_PRIMEIRO";
}

/** Arquivo com hash no nome — o conteúdo dele não muda, por construção. */
function ehImutavel(caminho: string): boolean {
  return /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(caminho);
}

/**
 * Resposta pode ser guardada?
 *
 * Guardar um 404 ou um 500 transformaria uma falha momentânea do servidor em
 * falha permanente da estação: a tela passaria a servir o erro do cache mesmo
 * depois de o servidor voltar.
 *
 * `opaque` (resposta de outra origem sem CORS) também fica de fora: não dá para
 * saber se deu certo, e ela ocupa cota inteira no disco.
 */
export function podeGuardar(resposta: {
  readonly ok: boolean;
  readonly status: number;
  readonly type: string;
}): boolean {
  return resposta.ok && resposta.status === 200 && resposta.type !== "opaque";
}
