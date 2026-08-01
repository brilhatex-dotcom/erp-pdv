import { createWriteStream } from "node:fs";
import { connect } from "node:net";

/**
 * Entrega de bytes à impressora térmica.
 *
 * ### Por que dois transportes, e não uma biblioteca nativa
 *
 * Acesso USB direto exigiria compilação nativa (`node-usb`, `node-gyp`), e isso
 * quebra o critério econômico dominante: um instalador que compila no cliente é
 * um instalador que **falha** no cliente, e cada falha é um chamado que se
 * multiplica pela base instalada. Os dois transportes daqui usam só `node:net` e
 * `node:fs` — zero dependência nativa, zero compilação na instalação.
 *
 * | Transporte | Como a loja liga | Por que cobre o caso |
 * |---|---|---|
 * | Rede (porta 9100) | Impressora com Ethernet, ou servidor de impressão | Protocolo cru, universal em térmica |
 * | Arquivo/porta | `\\\\.\\pipe`, `LPT1`, compartilhamento Windows, `/dev/usb/lp0` | O sistema operacional já enxerga a impressora; escrevemos bruto nela |
 *
 * A impressora USB entra pelo segundo: instalada no Windows, ela vira uma fila
 * de impressão para a qual se escreve em modo bruto. É como o mercado já
 * instala equipamento de balcão, e não exige nada do lojista.
 *
 * ### O resultado é valor, nunca exceção
 *
 * Impressora sem papel, desligada ou com a tampa aberta é **rotina** no balcão,
 * não excepcional. Quem chama precisa decidir o que fazer — e o que se faz
 * nunca é parar a venda (princípio 1).
 */

export type ResultadoImpressao =
  { readonly tipo: "IMPRESSO" } | { readonly tipo: "FALHOU"; readonly motivo: string };

export interface Impressora {
  imprimir(bytes: Uint8Array): Promise<ResultadoImpressao>;
}

/** Uma impressora que engoliu os bytes e não travou é o suficiente. */
const IMPRESSO: ResultadoImpressao = { tipo: "IMPRESSO" };

function falhou(causa: unknown, contexto: string): ResultadoImpressao {
  const detalhe = causa instanceof Error ? causa.message : String(causa);
  return { tipo: "FALHOU", motivo: `${contexto}: ${detalhe}` };
}

export interface OpcoesRede {
  readonly host: string;
  readonly porta?: number;
  /**
   * Tempo máximo esperando a impressora.
   *
   * Curto de propósito. O cupom não vale uma fila parada: se a impressora de
   * rede não respondeu em três segundos, ela não vai responder — e o operador
   * precisa da tela de volta, não de uma ampulheta.
   */
  readonly tempoLimiteMs?: number;
}

const PORTA_ESCPOS = 9100;
const TEMPO_LIMITE_PADRAO_MS = 3000;

/** Impressora de rede — protocolo cru na porta 9100. */
export function impressoraDeRede(opcoes: OpcoesRede): Impressora {
  return {
    imprimir(bytes) {
      return new Promise<ResultadoImpressao>((resolver) => {
        const socket = connect({
          host: opcoes.host,
          port: opcoes.porta ?? PORTA_ESCPOS,
        });

        // Uma só resolução, venha ela de onde vier: sem isto, um erro logo
        // depois da escrita resolveria a promessa duas vezes.
        let decidido = false;
        const decidir = (resultado: ResultadoImpressao): void => {
          if (decidido) return;
          decidido = true;
          resolver(resultado);
        };

        socket.setTimeout(opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS);

        socket.on("timeout", () => {
          decidir({
            tipo: "FALHOU",
            motivo: `Impressora ${opcoes.host} não respondeu.`,
          });
        });

        socket.on("error", (causa) => {
          decidir(falhou(causa, `Impressora ${opcoes.host}`));
        });

        socket.on("connect", () => {
          socket.write(bytes, (causa) => {
            if (causa !== undefined && causa !== null) {
              socket.destroy();
              decidir(falhou(causa, `Impressora ${opcoes.host}`));
              return;
            }

            // `end`, e **não** `destroy`: destruir logo após a escrita fecha a
            // conexão de forma abrupta, e os bytes que ainda estavam no buffer
            // do sistema podem ser descartados. Num cupom de trinta itens isso
            // sai como cupom cortado no meio — defeito que só aparece com
            // volume, e portanto na loja do cliente.
            socket.end();
          });
        });

        // O fechamento limpo é a confirmação de que tudo saiu.
        socket.on("close", () => {
          decidir(IMPRESSO);
        });
      });
    },
  };
}

/**
 * Impressora acessível como arquivo ou porta do sistema.
 *
 * É o caminho da impressora USB: o Windows a expõe como fila de impressão, o
 * Linux como `/dev/usb/lp0`. Escrever bruto ali é o que os sistemas de PDV
 * fazem há vinte anos.
 */
export function impressoraDeArquivo(caminho: string): Impressora {
  return {
    imprimir(bytes) {
      return new Promise<ResultadoImpressao>((resolver) => {
        let decidido = false;
        const decidir = (resultado: ResultadoImpressao): void => {
          if (decidido) return;
          decidido = true;
          resolver(resultado);
        };

        const destino = createWriteStream(caminho, { flags: "w" });

        destino.on("error", (causa) => {
          decidir(falhou(causa, `Impressora ${caminho}`));
        });

        destino.write(bytes, (causa) => {
          if (causa !== undefined && causa !== null) {
            decidir(falhou(causa, `Impressora ${caminho}`));
            return;
          }
          destino.end(() => {
            decidir(IMPRESSO);
          });
        });
      });
    },
  };
}

/**
 * Impressora que não existe.
 *
 * Não é enfeite de teste: é a configuração de quem **vende sem cupom**, e
 * existe gente assim entre os segmentos-alvo. Sem ela, a ausência de impressora
 * viraria erro em toda venda, e o operador aprenderia a ignorar mensagem de
 * erro — que é como um erro de verdade passa despercebido.
 */
export function impressoraNula(): Impressora {
  return {
    imprimir() {
      return Promise.resolve(IMPRESSO);
    },
  };
}

export type ConfiguracaoImpressora =
  | { readonly tipo: "REDE"; readonly host: string; readonly porta?: number | undefined }
  | { readonly tipo: "ARQUIVO"; readonly caminho: string }
  | { readonly tipo: "NENHUMA" };

export function montarImpressora(config: ConfiguracaoImpressora): Impressora {
  switch (config.tipo) {
    case "REDE":
      return impressoraDeRede(
        config.porta === undefined
          ? { host: config.host }
          : { host: config.host, porta: config.porta },
      );
    case "ARQUIVO":
      return impressoraDeArquivo(config.caminho);
    case "NENHUMA":
      return impressoraNula();
  }
}
