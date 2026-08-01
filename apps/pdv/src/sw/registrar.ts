/**
 * Registra o service worker, sem nunca derrubar a tela por causa disso.
 *
 * A PWA é uma melhoria: ela faz a tela abrir com o servidor da loja fora do ar.
 * Se o registro falhar — navegador antigo, origem sem HTTPS, política de
 * empresa bloqueando —, o PDV continua funcionando exatamente como antes. Um
 * `throw` aqui trocaria "sem cache" por "sem caixa", que é o oposto do
 * princípio 1.
 *
 * Por isso a falha vira `console.info`, e não erro: não é defeito, é ambiente.
 */
/**
 * O que este módulo precisa do navegador.
 *
 * `serviceWorker` é **opcional** aqui, ao contrário do que diz o tipo `Navigator`
 * do DOM. Aquele tipo descreve o navegador ideal; o que chega no balcão pode
 * ser um Chrome de empresa com a API desligada por política, ou a mesma página
 * servida por HTTP numa rede interna — e em nenhum dos dois a propriedade
 * existe. Declarar como obrigatória faria o compilador garantir uma coisa que o
 * mundo real não garante, e a verificação abaixo pareceria código morto.
 */
interface NavegadorComServiceWorker {
  readonly serviceWorker?: ServiceWorkerContainer | undefined;
}

export async function registrarServiceWorker(
  navegador: NavegadorComServiceWorker = globalThis.navigator,
): Promise<boolean> {
  const suporte = navegador.serviceWorker;

  if (suporte === undefined) return false;

  try {
    await suporte.register("/sw.js", { type: "module", scope: "/" });

    return true;
  } catch (causa) {
    // eslint-disable-next-line no-console -- ambiente sem PWA não é defeito
    console.info("Service worker não registrado; o PDV segue sem cache.", causa);

    return false;
  }
}
