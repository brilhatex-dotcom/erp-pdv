import { podeGuardar } from "./estrategia.js";

/**
 * As duas maneiras de responder, e a regra de guardar.
 *
 * Mora fora do `sw.ts` porque é aqui que está o comportamento que sustenta o
 * princípio 1 — **a tela abre com o servidor da loja fora do ar**. Deixar isso
 * dentro do service worker significaria não ter teste nenhum sobre ele: service
 * worker não roda em suíte, e o que não é exercitado só falha na loja, às três
 * da manhã, quando ninguém está olhando.
 *
 * As dependências chegam por parâmetro em vez de virem do escopo global. Não é
 * cerimônia: é o que permite exercitar a queda de rede, que é exatamente o caso
 * que não dá para reproduzir de outro jeito.
 */

/** O pedaço do `CacheStorage` que este módulo usa. */
export interface Armazem {
  match(pedido: Request): Promise<Response | undefined>;
  open(
    nome: string,
  ): Promise<{ put(pedido: Request, resposta: Response): Promise<void> }>;
}

export interface Dependencias {
  readonly armazem: Armazem;
  readonly buscar: (pedido: Request) => Promise<Response>;
  readonly nomeDoCache: string;
}

/** Serve do cache; só vai à rede se não tiver. Para arquivo imutável. */
export async function cachePrimeiro(
  pedido: Request,
  dependencias: Dependencias,
): Promise<Response> {
  const guardado = await dependencias.armazem.match(pedido);
  if (guardado !== undefined) return guardado;

  const resposta = await dependencias.buscar(pedido);
  await guardar(pedido, resposta, dependencias);

  return resposta;
}

/**
 * Tenta a rede; se ela falhar, serve o que houver.
 *
 * A ordem importa: rede primeiro é o que traz a versão nova assim que ela
 * existe. Cache primeiro deixaria a estação rodando código velho até alguém
 * perceber — e ninguém percebe, porque tudo parece funcionar.
 */
export async function redePrimeiro(
  pedido: Request,
  dependencias: Dependencias,
): Promise<Response> {
  try {
    const resposta = await dependencias.buscar(pedido);
    await guardar(pedido, resposta, dependencias);

    return resposta;
  } catch (causa) {
    const guardado = await dependencias.armazem.match(pedido);
    if (guardado !== undefined) return guardado;

    // Navegação sem nada guardado para aquele endereço exato: cai na raiz, que
    // é o mesmo documento — a aplicação é de página única. É ela que sabe dizer
    // "sem conexão" com as palavras do operador, em vez da tela de erro do
    // navegador, que fala de DNS para quem está com um cliente na frente.
    if (pedido.mode === "navigate") {
      // A raiz é resolvida contra a origem do próprio pedido: `new Request("/")`
      // sem base depende de onde o código roda, e no service worker isso é
      // sutilmente diferente de na página.
      const raiz = await dependencias.armazem.match(
        new Request(new URL("/", pedido.url)),
      );
      if (raiz !== undefined) return raiz;
    }

    throw causa;
  }
}

async function guardar(
  pedido: Request,
  resposta: Response,
  dependencias: Dependencias,
): Promise<void> {
  if (!podeGuardar(resposta)) return;

  const cache = await dependencias.armazem.open(dependencias.nomeDoCache);
  // `clone` porque o corpo só pode ser lido uma vez, e quem pediu ainda vai lê-lo.
  await cache.put(pedido, resposta.clone());
}

/**
 * Apaga os caches de versões anteriores.
 *
 * Sem isto, cada atualização deixa para trás o build inteiro da versão velha, e
 * a estação de caixa — que fica anos sem ser formatada — vai enchendo o disco
 * com cópias que ninguém mais lê.
 */
export async function limparCachesAntigos(
  nomes: readonly string[],
  atual: string,
  apagar: (nome: string) => Promise<boolean>,
): Promise<readonly string[]> {
  const antigos = nomes.filter((nome) => nome !== atual);

  await Promise.all(antigos.map(async (nome) => apagar(nome)));

  return antigos;
}
