import { contextBridge, ipcRenderer } from "electron";

/**
 * A única superfície entre a tela e o sistema.
 *
 * Três funções, todas sobre impressão. Nada de `require`, `fs` ou `child_process`
 * atravessa: o renderizador carrega código servido pela rede da loja, e dar a
 * ele acesso ao Node transformaria qualquer falha da retaguarda em execução de
 * código na máquina do caixa.
 *
 * Tudo o que passa aqui é **serializável e assíncrono**. Uma ponte que devolve
 * objeto vivo vaza referência para dentro do contexto isolado e desfaz a
 * separação que ela existe para criar.
 */
contextBridge.exposeInMainWorld("balcao", {
  imprimirCupom: (dados: unknown) => ipcRenderer.invoke("balcao:imprimir-cupom", dados),
  abrirGaveta: () => ipcRenderer.invoke("balcao:abrir-gaveta"),
  configuracao: () => ipcRenderer.invoke("balcao:configuracao"),

  // Contingência. Cada função é uma operação nomeada sobre a fila ou a réplica:
  // a tela pede "enfileire esta venda", nunca "escreva neste arquivo".
  estadoConexao: () => ipcRenderer.invoke("balcao:estado-conexao"),
  iniciarVendaLocal: (dados: unknown) =>
    ipcRenderer.invoke("balcao:venda-local-iniciar", dados),
  itemLocal: (dados: unknown) => ipcRenderer.invoke("balcao:venda-local-item", dados),
  pagamentoLocal: (dados: unknown) =>
    ipcRenderer.invoke("balcao:venda-local-pagamento", dados),
  finalizarVendaLocal: () => ipcRenderer.invoke("balcao:venda-local-finalizar"),
  cancelarVendaLocal: () => ipcRenderer.invoke("balcao:venda-local-cancelar"),
  sincronizarAgora: () => ipcRenderer.invoke("balcao:sincronizar-agora"),
});
