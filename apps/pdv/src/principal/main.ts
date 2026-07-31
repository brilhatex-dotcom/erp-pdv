import { readFileSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { type ConfiguracaoDaEstacao, interpretarConfiguracao } from "./configuracao.js";
import { montarImpressora } from "./ponte-hardware/impressora.js";
import { ServicoImpressao } from "./ponte-hardware/servicoImpressao.js";
import { registrarCanais } from "./ponte-ipc.js";

/**
 * Processo principal do PDV.
 *
 * É o único lugar do produto com acesso a arquivo, porta e rede local crua. A
 * tela roda isolada (`contextIsolation`) e só enxerga o que o `preload` expõe —
 * uma superfície de duas funções, ambas sobre impressão.
 *
 * Essa fronteira não é cerimônia: o renderizador carrega HTML e JavaScript
 * servidos pela rede da loja. Dar a ele acesso a `require` seria transformar
 * qualquer falha da retaguarda em execução de código na máquina do caixa.
 */

function carregarConfiguracao(): ConfiguracaoDaEstacao {
  const caminho = join(app.getPath("userData"), "estacao.json");

  let bruto: string | undefined;

  try {
    bruto = readFileSync(caminho, "utf8");
  } catch {
    // Arquivo ausente é o estado da instalação nova, não uma falha.
    bruto = undefined;
  }

  const { configuracao, aviso } = interpretarConfiguracao(bruto);

  if (aviso !== undefined) console.warn(`[configuracao] ${aviso}`);

  return configuracao;
}

function abrirJanela(configuracao: ConfiguracaoDaEstacao): BrowserWindow {
  const janela = new BrowserWindow({
    width: 1280,
    height: 800,
    // Quiosque por padrão: o balcão não navega em outra coisa, e barra de menu
    // é onde o operador se perde e o suporte é acionado.
    kiosk: configuracao.quiosque,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    // A tela só aparece pronta. Janela cinza piscando antes do login é o que
    // faz o operador clicar duas vezes e abrir duas instâncias.
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../ponte/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  janela.once("ready-to-show", () => {
    janela.show();
  });

  return janela;
}

async function iniciar(): Promise<void> {
  await app.whenReady();

  const configuracao = carregarConfiguracao();
  const servico = new ServicoImpressao(
    montarImpressora(configuracao.impressora),
    (mensagem) => {
      console.error(`[impressora] ${mensagem}`);
    },
  );

  registrarCanais(ipcMain, servico, configuracao);
  abrirJanela(configuracao);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) abrirJanela(configuracao);
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

/* v8 ignore start -- só executa dentro do Electron, fora do alcance do Vitest */
if (process.env["VITEST"] === undefined) {
  void iniciar();
}
/* v8 ignore stop */
