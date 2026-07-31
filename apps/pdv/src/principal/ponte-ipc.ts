import type { ConfiguracaoDaEstacao } from "./configuracao.js";
import type {
  Aviso,
  DadosImpressaoCupom,
  ServicoImpressao,
} from "./ponte-hardware/servicoImpressao.js";

/**
 * Os canais que a tela pode chamar.
 *
 * Nomeados aqui, num lugar só, porque `preload` e processo principal precisam
 * concordar: um canal escrito diferente nos dois lados não dá erro de
 * compilação — dá uma promessa que nunca resolve, e o operador vê a tela
 * congelada sem mensagem nenhuma.
 */
export const CANAIS = {
  imprimirCupom: "balcao:imprimir-cupom",
  abrirGaveta: "balcao:abrir-gaveta",
  configuracao: "balcao:configuracao",
} as const;

/**
 * O que este módulo precisa do Electron.
 *
 * Recebido como parâmetro, e não importado: é o que permite exercitar o
 * roteamento dos canais sem subir um processo Electron inteiro. O `main.ts`
 * passa o `ipcMain` de verdade.
 */
export interface RegistradorIpc {
  handle(
    canal: string,
    // O evento do Electron não é usado por nenhum tratador daqui, e tipá-lo
    // exigiria importar `electron` — que é justamente o que este módulo evita,
    // para poder ser exercitado sem subir um processo Electron.
    tratador: (evento: unknown, ...argumentos: unknown[]) => unknown,
  ): void;
}

export interface ConfiguracaoVisivelNaTela {
  readonly api: string;
  readonly temImpressora: boolean;
}

/**
 * Liga os canais ao serviço de impressão.
 *
 * Nenhum tratador daqui lança: um `handle` que rejeita vira exceção do outro
 * lado da ponte, dentro da tela, no meio de uma venda. O serviço já devolve
 * `Aviso` em vez de erro — este módulo só garante que nada escape por cima.
 */
export function registrarCanais(
  ipc: RegistradorIpc,
  servico: ServicoImpressao,
  configuracao: ConfiguracaoDaEstacao,
): void {
  ipc.handle(CANAIS.imprimirCupom, async (_evento, dados): Promise<Aviso> => {
    const pedido = dados as DadosImpressaoCupom | undefined;

    // Chamada sem dados é defeito de programação da tela — e mesmo assim não
    // pode derrubar o caixa.
    if (pedido === undefined) {
      return { tipo: "NAO_IMPRESSO", mensagem: "Cupom não impresso." };
    }

    return servico.imprimirCupom({
      ...pedido,
      colunas: pedido.colunas ?? configuracao.colunas,
    });
  });

  ipc.handle(CANAIS.abrirGaveta, async (): Promise<Aviso> => servico.abrirGaveta());

  // A tela precisa saber se **há** impressora, para não oferecer "reimprimir"
  // numa estação que não imprime.
  ipc.handle(CANAIS.configuracao, (): ConfiguracaoVisivelNaTela => ({
    api: configuracao.api,
    temImpressora: configuracao.impressora.tipo !== "NENHUMA",
  }));
}
