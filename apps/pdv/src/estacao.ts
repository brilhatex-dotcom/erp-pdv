const CHAVE_ESTACAO = "erp.estacao";

/**
 * Identificador desta estação de caixa.
 *
 * A estação importa por três motivos de negócio: só pode haver **um** caixa
 * aberto por estação, a numeração fiscal tem **uma série por estação**
 * (`docs/fiscal/ARQUITETURA-FISCAL.md` §8) e o fechamento do dia é por
 * estação. Errar isso não dá erro na tela — dá conferência de caixa que não
 * fecha e série fiscal duplicada.
 *
 * **Provisório:** hoje o valor é sorteado e guardado no navegador na primeira
 * abertura. O certo é o instalador gravá-lo na configuração da máquina, junto
 * com o número do caixa que está escrito na etiqueta do computador — é assim que
 * o suporte consegue dizer "o caixa 2 travou" e o sistema saber de qual se
 * trata. Entra na etapa do instalador; até lá, reinstalar o navegador cria uma
 * estação nova, e isso é limitação conhecida, não descuido.
 */
export function identificadorDaEstacao(): string {
  const guardado = globalThis.localStorage.getItem(CHAVE_ESTACAO);

  if (guardado !== null && guardado !== "") return guardado;

  const novo = crypto.randomUUID();
  globalThis.localStorage.setItem(CHAVE_ESTACAO, novo);

  return novo;
}
