/**
 * A casca de quiosque, em forma de dados.
 *
 * ### Por que existe um módulo só para montar opções
 *
 * O ADR-0023 é explícito: a casca **não pode ganhar lógica**. Casca com lógica
 * volta a ser uma segunda aplicação, e todo defeito passa a precisar ser
 * reproduzido duas vezes — uma no navegador, outra no Electron.
 *
 * A forma de sustentar essa regra é esta: tudo o que é decisão vira valor
 * calculado aqui, testado aqui, e `main.ts` fica sendo três chamadas ao
 * Electron sem um `if`. O dia em que alguém precisar escrever uma condição no
 * `main.ts` é o dia em que a regra foi quebrada, e isso fica visível na revisão.
 */

/** Endereço da PWA servida pelo servidor da loja. */
export const ENDERECO_PADRAO = "http://localhost:3000/";

export interface OpcoesDaJanela {
  readonly fullscreen: boolean;
  readonly kiosk: boolean;
  readonly autoHideMenuBar: boolean;
  readonly backgroundColor: string;
  readonly webPreferences: {
    /**
     * Sem Node dentro da página, sempre.
     *
     * A casca carrega uma página **remota** — a PWA vem pelo servidor da loja.
     * Dar Node a conteúdo remoto é entregar a máquina do caixa a quem
     * conseguir responder no lugar do servidor. Não há caso de uso que
     * justifique: a casca não precisa de nada do sistema operacional, porque
     * quem fala com impressora e disco é o Agente Local.
     */
    readonly nodeIntegration: false;
    readonly contextIsolation: true;
    readonly sandbox: true;
    /** Sem `preload`: não há ponte para expor. Ela virou HTTP (ADR-0023). */
    readonly webSecurity: true;
  };
}

/**
 * Opções da janela do caixa.
 *
 * `kiosk` **e** `fullscreen`: são coisas diferentes no Windows. `fullscreen`
 * ocupa a tela; `kiosk` também tira o caminho de sair — que é o ponto num
 * balcão, onde a estação não é o computador pessoal de ninguém.
 */
export function opcoesDaJanela(): OpcoesDaJanela {
  return {
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    // O mesmo `--color-papel-fundo` do design system. Sem isto, a janela
    // pisca branco puro antes de a página pintar — e no escuro da madrugada de
    // um posto 24 horas esse flash é agressivo.
    backgroundColor: "#f7f7f8",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}

/**
 * Endereço a abrir.
 *
 * Vem de variável de ambiente porque a loja com duas estações aponta as duas
 * para o mesmo servidor, e esse endereço é decidido na instalação — não na
 * compilação. Valor em branco cai no padrão: instalador que esquece a variável
 * abre no servidor local em vez de abrir uma janela vazia.
 */
export function enderecoDaPwa(ambiente: Record<string, string | undefined> = {}): string {
  const informado = (ambiente["ERP_ENDERECO_PWA"] ?? "").trim();

  return informado === "" ? ENDERECO_PADRAO : informado;
}

/**
 * A casca abre **um** endereço e nada mais.
 *
 * Qualquer tentativa de abrir outra página — um `target="_blank"`, um link
 * externo, uma navegação injetada — é recusada. Sem isso, a casca vira um
 * navegador sem barra de endereço: o operador não teria como voltar, e um link
 * mal colocado deixaria o caixa preso numa página estranha até alguém
 * reiniciar a máquina.
 */
export function permiteNavegarPara(destino: string, permitido: string): boolean {
  try {
    return new URL(destino).origin === new URL(permitido).origin;
  } catch {
    // URL malformada não navega. `about:blank` e `data:` caem aqui ou em outra
    // origem, e os dois são vetores conhecidos de janela sem controle.
    return false;
  }
}
