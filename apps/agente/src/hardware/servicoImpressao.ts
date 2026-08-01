import { type DadosCupom, montarCupomVenda } from "@erp/printing";

import type { Impressora, ResultadoImpressao } from "./impressora.js";

/**
 * Impressão de cupom, com o caminho degradado que o balcão exige.
 *
 * **Este módulo existe para garantir uma coisa: a venda nunca espera pela
 * impressora.** É o princípio 1 do projeto, e é onde ele deixa de ser texto e
 * vira código.
 *
 * A ordem importa. O cupom é impresso **depois** de a venda estar gravada no
 * servidor, nunca antes. Imprimir primeiro e gravar depois produz o pior
 * defeito possível deste tipo de sistema: o cliente sai da loja com um cupom de
 * uma venda que o caixa não registrou.
 *
 * Falha de impressão vira **aviso**, não erro: a venda aconteceu, o dinheiro
 * entrou, e o operador precisa saber que o papel acabou — não que "a operação
 * falhou", que é falso e o faria refazer a venda.
 */

export type Aviso =
  | { readonly tipo: "IMPRESSO" }
  | { readonly tipo: "NAO_IMPRESSO"; readonly mensagem: string };

export interface DadosImpressaoCupom {
  readonly cupom: DadosCupom;
  readonly colunas?: number | undefined;
  /** Houve pagamento em espécie — só então a gaveta abre. */
  readonly houveDinheiro: boolean;
}

export class ServicoImpressao {
  constructor(
    private readonly impressora: Impressora,
    private readonly registrar: (mensagem: string) => void = () => undefined,
  ) {}

  async imprimirCupom(dados: DadosImpressaoCupom): Promise<Aviso> {
    const bytes = montarCupomVenda(dados.cupom, {
      ...(dados.colunas === undefined ? {} : { colunas: dados.colunas }),
      abrirGaveta: dados.houveDinheiro,
    });

    return this.#entregar(bytes, "Cupom não impresso");
  }

  /**
   * Abre a gaveta fora de uma venda.
   *
   * Sangria, suprimento e troca de operador precisam disto. O comando vai
   * sozinho no fluxo, sem texto: a impressora executa o pulso e não consome
   * papel.
   */
  async abrirGaveta(): Promise<Aviso> {
    // ESC p 0 — o mesmo pulso do cupom, isolado.
    const pulso = Uint8Array.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

    return this.#entregar(pulso, "Gaveta não abriu");
  }

  async #entregar(bytes: Uint8Array, contexto: string): Promise<Aviso> {
    let resultado: ResultadoImpressao;

    try {
      resultado = await this.impressora.imprimir(bytes);
    } catch (causa) {
      // Rede de segurança: um transporte que lance em vez de devolver `FALHOU`
      // é defeito de programação, mas não pode derrubar o caixa por isso.
      resultado = {
        tipo: "FALHOU",
        motivo: causa instanceof Error ? causa.message : String(causa),
      };
    }

    if (resultado.tipo === "IMPRESSO") return { tipo: "IMPRESSO" };

    // O detalhe técnico vai para o log — é o que permite diagnosticar sem ir à
    // loja. Para o operador vai a frase que ele consegue agir sobre.
    this.registrar(`${contexto}: ${resultado.motivo}`);

    return {
      tipo: "NAO_IMPRESSO",
      mensagem: `${contexto}. A venda foi registrada normalmente.`,
    };
  }
}
