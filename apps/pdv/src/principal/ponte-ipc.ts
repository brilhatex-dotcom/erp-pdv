import type { ConfiguracaoDaEstacao } from "./configuracao.js";
import type {
  Aviso,
  DadosImpressaoCupom,
  ServicoImpressao,
} from "./ponte-hardware/servicoImpressao.js";
import type {
  EstadoConexao,
  ResumoSincronizacao,
} from "./sincronizacao/sincronizador.js";
import type {
  ResultadoFinalizacao,
  ResultadoItem,
  ResultadoPagamento,
  VendaLocalNaTela,
} from "./venda-local/vendaLocal.js";

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

  // Contingência. A superfície cresceu de três para sete canais, e isso é uma
  // decisão de segurança, não uma conveniência: o renderizador carrega código
  // servido pela rede da loja. Cada canal aqui é uma operação **nomeada** sobre
  // a fila ou a réplica — nenhum recebe caminho de arquivo, e nenhum devolve
  // objeto vivo. Expor "grave este arquivo" em vez de "enfileire esta venda"
  // transformaria uma falha da retaguarda em escrita arbitrária no disco do
  // caixa.
  estadoConexao: "balcao:estado-conexao",
  iniciarVendaLocal: "balcao:venda-local-iniciar",
  itemLocal: "balcao:venda-local-item",
  pagamentoLocal: "balcao:venda-local-pagamento",
  finalizarVendaLocal: "balcao:venda-local-finalizar",
  cancelarVendaLocal: "balcao:venda-local-cancelar",
  sincronizarAgora: "balcao:sincronizar-agora",
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

/** O que os canais de contingência precisam do processo principal. */
export interface Contingencia {
  estado(): EstadoConexao;
  iniciar(estacaoId: string, operadorId: string): VendaLocalNaTela;
  adicionarItem(codigo: string): ResultadoItem;
  registrarPagamento(forma: string, valor: string): ResultadoPagamento;
  finalizar(): ResultadoFinalizacao;
  cancelar(): void;
  sincronizar(): Promise<ResumoSincronizacao>;
}

/**
 * Liga os canais da contingência.
 *
 * **Nenhum tratador daqui lança.** Vale mais aqui que na impressão: um `handle`
 * que rejeita vira exceção dentro da tela, e a tela está no meio de uma venda
 * offline — exatamente o momento em que não há para onde escalar o problema.
 * Falha vira `ERRO` com mensagem que o operador entende.
 */
export function registrarCanaisDeContingencia(
  ipc: RegistradorIpc,
  contingencia: Contingencia,
  registrar: (mensagem: string) => void = () => undefined,
): void {
  ipc.handle(CANAIS.estadoConexao, (): EstadoConexao => contingencia.estado());

  ipc.handle(CANAIS.iniciarVendaLocal, (_evento, dados): VendaLocalNaTela | undefined => {
    const pedido = dados as
      { readonly estacaoId?: unknown; readonly operadorId?: unknown } | undefined;

    if (typeof pedido?.estacaoId !== "string" || typeof pedido.operadorId !== "string") {
      // Chamada malformada é defeito da tela. Devolver `undefined` deixa o
      // caminho online assumir, em vez de derrubar o caixa.
      registrar("Pedido de venda local sem estação ou operador.");
      return undefined;
    }

    return contingencia.iniciar(pedido.estacaoId, pedido.operadorId);
  });

  ipc.handle(CANAIS.itemLocal, (_evento, dados): ResultadoItem => {
    const codigo = (dados as { readonly codigo?: unknown } | undefined)?.codigo;

    return typeof codigo === "string"
      ? contingencia.adicionarItem(codigo)
      : { tipo: "ERRO", mensagem: "Código inválido." };
  });

  ipc.handle(CANAIS.pagamentoLocal, (_evento, dados): ResultadoPagamento => {
    const pedido = dados as
      { readonly forma?: unknown; readonly valor?: unknown } | undefined;

    return typeof pedido?.forma === "string" && typeof pedido.valor === "string"
      ? contingencia.registrarPagamento(pedido.forma, pedido.valor)
      : { tipo: "ERRO", mensagem: "Pagamento inválido." };
  });

  ipc.handle(CANAIS.finalizarVendaLocal, (): ResultadoFinalizacao =>
    contingencia.finalizar(),
  );

  ipc.handle(CANAIS.cancelarVendaLocal, (): null => {
    contingencia.cancelar();
    // `null` e não `undefined`: o IPC do Electron serializa, e `undefined`
    // chega do outro lado como promessa resolvida sem valor — indistinguível
    // de canal inexistente.
    return null;
  });

  ipc.handle(CANAIS.sincronizarAgora, async (): Promise<ResumoSincronizacao> => {
    try {
      return await contingencia.sincronizar();
    } catch (causa) {
      registrar(`Sincronização manual falhou: ${String(causa)}`);
      return { enviadas: 0, recusadas: 0, interrompida: true };
    }
  });
}
