import type { DadosCupom } from "@erp/printing";

/**
 * A ponte, vista de dentro da tela.
 *
 * `undefined` quando o PDV roda no navegador — em desenvolvimento, e no teste.
 * A tela **precisa** funcionar sem ela: a venda não depende de impressora
 * (princípio 1), e amarrar a tela ao Electron impediria de desenvolvê-la.
 */
export interface Balcao {
  imprimirCupom(dados: {
    readonly cupom: DadosCupom;
    readonly houveDinheiro: boolean;
  }): Promise<AvisoDeImpressao>;
  abrirGaveta(): Promise<AvisoDeImpressao>;
  configuracao(): Promise<{ readonly api: string; readonly temImpressora: boolean }>;
}

export type AvisoDeImpressao =
  | { readonly tipo: "IMPRESSO" }
  | { readonly tipo: "NAO_IMPRESSO"; readonly mensagem: string };

declare global {
  interface Window {
    readonly balcao?: Balcao;
  }
}

/** A ponte quando ela existe. Fora do Electron, `undefined`. */
export function balcao(): Balcao | undefined {
  return globalThis.window.balcao;
}

/**
 * Imprime o cupom **sem nunca lançar**.
 *
 * Chamado depois de a venda estar gravada. Devolve `undefined` quando não há o
 * que avisar — sem impressora configurada, ou cupom impresso com sucesso.
 */
export async function imprimirCupomDaVenda(dados: {
  readonly cupom: DadosCupom;
  readonly houveDinheiro: boolean;
}): Promise<string | undefined> {
  const ponte = balcao();

  // Navegador: não há impressora, e isso não é erro. Avisar "sem impressora" a
  // cada venda ensinaria o operador a ignorar avisos.
  if (ponte === undefined) return undefined;

  try {
    const aviso = await ponte.imprimirCupom(dados);
    return aviso.tipo === "IMPRESSO" ? undefined : aviso.mensagem;
  } catch {
    // A ponte quebrou. A venda já está gravada; o operador precisa saber do
    // cupom, não de um erro de IPC.
    return "Cupom não impresso. A venda foi registrada normalmente.";
  }
}
