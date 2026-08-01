import { describe, expect, it } from "vitest";

import {
  ENDERECO_PADRAO,
  enderecoDaPwa,
  opcoesDaJanela,
  permiteNavegarPara,
} from "./janela.js";

/**
 * A casca de quiosque.
 *
 * Ela carrega uma página **remota** em tela cheia, sem barra de endereço e sem
 * caminho de saída. Isso é ótimo para o balcão e péssimo se algo der errado: o
 * operador não tem como voltar, e ninguém está olhando a tela de um caixa às
 * três da manhã. Por isso o que se verifica aqui é sobretudo o que ela recusa.
 */

describe("opções da janela", () => {
  it("🔑 nunca dá Node à página", () => {
    // Ela carrega conteúdo remoto. Node dentro dele entrega a máquina do caixa
    // a quem conseguir responder no lugar do servidor da loja. Não há caso de
    // uso: quem fala com impressora e disco é o Agente Local.
    const { webPreferences } = opcoesDaJanela();

    expect(webPreferences.nodeIntegration).toBe(false);
    expect(webPreferences.contextIsolation).toBe(true);
    expect(webPreferences.sandbox).toBe(true);
    expect(webPreferences.webSecurity).toBe(true);
  });

  it("abre em quiosque, não só em tela cheia", () => {
    // São coisas diferentes no Windows: `fullscreen` ocupa a tela, `kiosk`
    // também tira o caminho de sair — que é o ponto num balcão.
    const opcoes = opcoesDaJanela();

    expect(opcoes.fullscreen).toBe(true);
    expect(opcoes.kiosk).toBe(true);
    expect(opcoes.autoHideMenuBar).toBe(true);
  });

  it("tem cor de fundo, para não piscar branco antes de pintar", () => {
    expect(opcoesDaJanela().backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("endereço da PWA", () => {
  it("vem do ambiente, porque é decidido na instalação", () => {
    expect(enderecoDaPwa({ ERP_ENDERECO_PWA: "http://servidor.loja:3000/" })).toBe(
      "http://servidor.loja:3000/",
    );
  });

  it("🔑 ambiente ausente ou em branco cai no padrão", () => {
    // Instalador que esquece a variável abre no servidor local — não numa
    // janela vazia, que o lojista leria como "o sistema não abriu".
    expect(enderecoDaPwa({})).toBe(ENDERECO_PADRAO);
    expect(enderecoDaPwa({ ERP_ENDERECO_PWA: "   " })).toBe(ENDERECO_PADRAO);
    expect(enderecoDaPwa()).toBe(ENDERECO_PADRAO);
  });
});

describe("navegação", () => {
  const permitido = "http://servidor.loja:3000/";

  it("anda dentro da própria origem", () => {
    expect(permiteNavegarPara("http://servidor.loja:3000/venda", permitido)).toBe(true);
    expect(permiteNavegarPara("http://servidor.loja:3000/", permitido)).toBe(true);
  });

  it("🔑 recusa sair para outro site", () => {
    // Sem barra de endereço, um link para fora deixa o caixa preso numa página
    // estranha até alguém reiniciar a máquina.
    expect(permiteNavegarPara("https://exemplo.com/", permitido)).toBe(false);
  });

  it("🔑 recusa outra porta e outro esquema na mesma máquina", () => {
    // A porta faz parte da origem: `localhost:9787` é o Agente Local, e a
    // janela do caixa não tem o que fazer lá.
    expect(permiteNavegarPara("http://servidor.loja:9787/", permitido)).toBe(false);
    expect(permiteNavegarPara("https://servidor.loja:3000/", permitido)).toBe(false);
  });

  it("🔑 recusa `about:` e `data:`", () => {
    // Vetores conhecidos de janela sem controle, e nenhum deles tem uso aqui.
    expect(permiteNavegarPara("about:blank", permitido)).toBe(false);
    expect(permiteNavegarPara("data:text/html,<h1>oi</h1>", permitido)).toBe(false);
  });

  it("URL malformada não navega", () => {
    expect(permiteNavegarPara("não é url", permitido)).toBe(false);
    expect(permiteNavegarPara("", permitido)).toBe(false);
  });
});
