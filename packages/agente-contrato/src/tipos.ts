/**
 * O contrato entre a tela do PDV e o Agente Local.
 *
 * Só tipos — nada aqui existe em tempo de execução. É de propósito: o Agente lê
 * disco e a tela roda no navegador, e um arquivo que ambos importam não pode
 * arrastar `node:fs` para dentro do bundle.
 *
 * Vive num pacote, e não dentro de um dos dois lados, porque o grafo de
 * dependências proíbe aplicação depender de aplicação (`ARQUITETURA.md` §3.3) —
 * e porque declarar estas formas duas vezes faria a divergência aparecer como
 * campo `undefined` no meio de uma venda offline, em vez de erro de compilação.
 */

export interface ItemNoAgente {
  readonly numero: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: { readonly milesimos: string; readonly unidade: string };
  readonly precoUnitario: string;
  readonly total: string;
}

/** A venda offline. Sem número: quem numera é o servidor, na importação. */
export interface VendaNoAgente {
  readonly id: string;
  readonly offline: true;
  readonly total: string;
  readonly faltaPagar: string;
  readonly itens: readonly ItemNoAgente[];
}

export type ResultadoItemNoAgente =
  | { readonly tipo: "OK"; readonly venda: VendaNoAgente }
  | { readonly tipo: "ERRO"; readonly mensagem: string };

export type ResultadoPagamentoNoAgente =
  | { readonly tipo: "OK"; readonly faltaPagar: string }
  | { readonly tipo: "ERRO"; readonly mensagem: string };

export type ResultadoFinalizacaoNoAgente =
  | { readonly tipo: "OK"; readonly troco: string }
  | { readonly tipo: "ERRO"; readonly mensagem: string };

export type EstadoConexaoNoAgente =
  /** Conectado também carrega a fila: ela pode não ter sido esvaziada ainda. */
  | { readonly tipo: "CONECTADO"; readonly pendentes: number }
  | { readonly tipo: "OFFLINE"; readonly pendentes: number }
  | {
      readonly tipo: "OFFLINE_CRITICO";
      readonly pendentes: number;
      readonly desdeMs: number;
    };

export interface ResumoSincronizacaoNoAgente {
  readonly enviadas: number;
  readonly recusadas: number;
  readonly interrompida: boolean;
}
