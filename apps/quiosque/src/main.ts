import { app, BrowserWindow, shell } from "electron";

import { enderecoDaPwa, opcoesDaJanela, permiteNavegarPara } from "./janela.js";

/**
 * Casca de quiosque do PDV (ADR-0023).
 *
 * Abre a PWA em tela cheia e some. **Não tem lógica** — não imprime, não
 * enfileira venda, não conhece produto. Quem faz isso é o Agente Local, e quem
 * mostra é a própria PWA.
 *
 * Ela é **opcional**: a mesma PWA aberta no Chrome funciona igual. A casca
 * existe para a loja que quer a estação ligando direto no caixa, sem barra de
 * endereço e sem alguém abrir o Facebook no computador do balcão.
 *
 * Todo valor daqui vem de `janela.ts`, que é onde estão os testes. Se um `if`
 * aparecer neste arquivo, a regra do ADR foi quebrada.
 */

const endereco = enderecoDaPwa(process.env);

function abrirCaixa(): void {
  const janela = new BrowserWindow(opcoesDaJanela());

  janela.on("closed", () => {
    // Fechar a janela encerra o processo. Casca viva sem janela é um ícone
    // fantasma na bandeja que o lojista não sabe o que é.
    app.quit();
  });

  // Link para fora vai ao navegador do sistema, nunca abre janela aqui. Sem
  // isto, um clique acidental deixa o caixa preso numa página sem saída.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);

    return { action: "deny" };
  });

  janela.webContents.on("will-navigate", (evento, destino) => {
    if (!permiteNavegarPara(destino, endereco)) evento.preventDefault();
  });

  void janela.loadURL(endereco);
}

// Uma instância só: duas janelas de caixa na mesma estação seriam duas sessões
// disputando a mesma gaveta e a mesma numeração de série.
if (app.requestSingleInstanceLock()) {
  void app.whenReady().then(abrirCaixa);

  app.on("second-instance", () => {
    const [primeira] = BrowserWindow.getAllWindows();
    primeira?.focus();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
} else {
  app.quit();
}
