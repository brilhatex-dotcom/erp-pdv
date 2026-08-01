import { describe, expect, it } from "vitest";

import { estrategiaPara, podeGuardar } from "./estrategia.js";

/**
 * As regras de cache do PDV.
 *
 * O erro caro aqui não é a tela abrir devagar: é o cache responder no lugar do
 * servidor em algo que precisa estar certo agora — preço, saldo, uma venda.
 */

function pedido(
  caminho: string,
  extras: { readonly metodo?: string; readonly ehNavegacao?: boolean } = {},
) {
  return {
    metodo: extras.metodo ?? "GET",
    caminho,
    ehNavegacao: extras.ehNavegacao ?? false,
  };
}

describe("o que o cache nunca responde", () => {
  it("🔑 /api fica de fora, sempre", () => {
    // Preço servido do cache é preço errado cobrado do cliente; saldo servido
    // do cache é venda aceita para mercadoria que acabou.
    expect(estrategiaPara(pedido("/api/produtos/buscar"))).toBe("SEMPRE_REDE");
    expect(estrategiaPara(pedido("/api/empresa"))).toBe("SEMPRE_REDE");
  });

  it("a verificação de saúde fica de fora", () => {
    // É o que decide se a loja está online. Respondê-la do cache faria o PDV
    // se achar conectado com o servidor desligado.
    expect(estrategiaPara(pedido("/saude"))).toBe("SEMPRE_REDE");
  });

  it("🔑 nada além de GET entra em cache", () => {
    // Um POST de venda respondido do cache é uma venda que o operador vê como
    // feita e que nunca chegou ao servidor.
    expect(estrategiaPara(pedido("/", { metodo: "POST", ehNavegacao: true }))).toBe(
      "SEMPRE_REDE",
    );
    expect(estrategiaPara(pedido("/assets/x-a1b2c3d4.js", { metodo: "HEAD" }))).toBe(
      "SEMPRE_REDE",
    );
  });
});

describe("o que o cache serve", () => {
  it("🔑 a navegação vai à rede primeiro — é o que traz a versão nova", () => {
    expect(estrategiaPara(pedido("/", { ehNavegacao: true }))).toBe("REDE_PRIMEIRO");
  });

  it("🔑 arquivo com hash no nome vem do cache", () => {
    // O Vite carimba hash em todo arquivo construído: o conteúdo não muda, por
    // construção. Ir à rede para confirmar seria latência sem ganho.
    expect(estrategiaPara(pedido("/assets/principal-a1b2c3d4.js"))).toBe(
      "CACHE_PRIMEIRO",
    );
    expect(estrategiaPara(pedido("/assets/estilo-Xy9_z8Q0.css"))).toBe("CACHE_PRIMEIRO");
  });

  it("arquivo sem hash vai à rede primeiro", () => {
    // Sem hash não há promessa de imutabilidade: servir do cache prenderia o
    // ícone ou o manifesto antigos para sempre.
    expect(estrategiaPara(pedido("/manifest.webmanifest"))).toBe("REDE_PRIMEIRO");
    expect(estrategiaPara(pedido("/icones/icone-192.png"))).toBe("REDE_PRIMEIRO");
    expect(estrategiaPara(pedido("/assets/logo.svg"))).toBe("REDE_PRIMEIRO");
  });

  it("caminho parecido com /api não é confundido", () => {
    // `/apiario` não é `/api/`. O prefixo é conferido com a barra.
    expect(estrategiaPara(pedido("/apiario"))).toBe("REDE_PRIMEIRO");
  });
});

describe("o que pode ser guardado", () => {
  it("resposta boa é guardada", () => {
    expect(podeGuardar({ ok: true, status: 200, type: "basic" })).toBe(true);
  });

  it("🔑 erro não é guardado", () => {
    // Guardar um 500 transformaria uma falha momentânea do servidor em falha
    // permanente da estação: a tela serviria o erro mesmo depois de ele passar.
    expect(podeGuardar({ ok: false, status: 500, type: "basic" })).toBe(false);
    expect(podeGuardar({ ok: false, status: 404, type: "basic" })).toBe(false);
  });

  it("resposta parcial não é guardada", () => {
    // 206 é pedaço de arquivo. Guardá-lo entrega meio arquivo na próxima vez.
    expect(podeGuardar({ ok: true, status: 206, type: "basic" })).toBe(false);
  });

  it("resposta opaca não é guardada", () => {
    // Sem CORS não dá para saber se deu certo, e ela ocupa cota inteira.
    expect(podeGuardar({ ok: true, status: 200, type: "opaque" })).toBe(false);
  });
});
