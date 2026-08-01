/**
 * O contrato da ponte, visto pelos dois lados.
 *
 * Só tipos — nada aqui existe em tempo de execução. É de propósito: o processo
 * principal lê disco e o renderizador roda isolado, e um arquivo que ambos
 * importam não pode arrastar `node:fs` para dentro do navegador.
 *
 * Declarar estas formas duas vezes, uma de cada lado, faria a divergência
 * aparecer como campo `undefined` no meio de uma venda offline — não como erro
 * de compilação. Aqui, mudar um campo quebra os dois lados na hora certa.
 */

export interface ItemNaPonte {
  readonly numero: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: { readonly milesimos: string; readonly unidade: string };
  readonly precoUnitario: string;
  readonly total: string;
}

/** A venda offline. Sem número: quem numera é o servidor, na importação. */
export interface VendaNaPonte {
  readonly id: string;
  readonly offline: true;
  readonly total: string;
  readonly faltaPagar: string;
  readonly itens: readonly ItemNaPonte[];
}

export type ResultadoItemNaPonte =
  | { readonly tipo: "OK"; readonly venda: VendaNaPonte }
  | { readonly tipo: "ERRO"; readonly mensagem: string };

export type ResultadoPagamentoNaPonte =
  | { readonly tipo: "OK"; readonly faltaPagar: string }
  | { readonly tipo: "ERRO"; readonly mensagem: string };

export type ResultadoFinalizacaoNaPonte =
  | { readonly tipo: "OK"; readonly troco: string }
  | { readonly tipo: "ERRO"; readonly mensagem: string };

export type EstadoConexaoNaPonte =
  | { readonly tipo: "CONECTADO" }
  | { readonly tipo: "OFFLINE"; readonly pendentes: number }
  | {
      readonly tipo: "OFFLINE_CRITICO";
      readonly pendentes: number;
      readonly desdeMs: number;
    };

export interface ResumoSincronizacaoNaPonte {
  readonly enviadas: number;
  readonly recusadas: number;
  readonly interrompida: boolean;
}
