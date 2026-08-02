import estaticos from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Entrega a PWA do PDV e a retaguarda pelo próprio servidor da loja.
 *
 * ### Por que não é detalhe de empacotamento
 *
 * O service worker do PDV **só registra em conteúdo da mesma origem**. Enquanto
 * a tela subia pelo Vite — ferramenta de desenvolvimento — e a API em outra
 * porta, a PWA nunca ligava de verdade: o cache existia no código e não no
 * navegador. Servir daqui é o que faz o ADR-0023 valer na loja.
 *
 * ### Duas aplicações, dois prefixos
 *
 * O PDV fica na **raiz** e a retaguarda em `/retaguarda`. A raiz é do balcão
 * porque é o que se digita com pressa e o que a casca de quiosque abre; quem
 * usa a retaguarda está sentado e digita o caminho uma vez, ou salva o atalho.
 *
 * ### O que acontece quando a pasta não existe
 *
 * Em desenvolvimento, `dist/` pode não ter sido construído — e nesse caso o
 * Vite está servindo a tela. Registrar um diretório inexistente derrubaria o
 * servidor na subida, tirando também a API. O registro é **condicional**, e a
 * ausência vira aviso no log: quem esqueceu de construir descobre pelo log, não
 * por um servidor que não sobe.
 */

/** Onde cada aplicação é servida. */
export const PREFIXO_RETAGUARDA = "/retaguarda";

export interface PastasDasTelas {
  /** `apps/pdv/dist` — a PWA do balcão. */
  readonly pdv: string;
  /** `apps/web/dist` — a retaguarda. */
  readonly retaguarda: string;
}

/**
 * Caminhos que **nunca** são tela.
 *
 * Sem esta lista, o `notFound` da aplicação de página única devolveria o
 * `index.html` para uma rota de API errada — e o cliente receberia HTML onde
 * esperava JSON, com erro de sintaxe em vez de "não encontrado".
 */
const NAO_SAO_TELA = ["/api/", "/saude"];

export function ehCaminhoDeTela(caminho: string): boolean {
  return !NAO_SAO_TELA.some((prefixo) => caminho.startsWith(prefixo));
}

export async function registrarTelas(
  servidor: FastifyInstance,
  pastas: PastasDasTelas,
): Promise<void> {
  const pdvExiste = existsSync(join(pastas.pdv, "index.html"));
  const retaguardaExiste = existsSync(join(pastas.retaguarda, "index.html"));

  if (retaguardaExiste) {
    await servidor.register(estaticos, {
      root: pastas.retaguarda,
      prefix: `${PREFIXO_RETAGUARDA}/`,
      decorateReply: false,
      ...cabecalhos(),
    });
  }

  if (pdvExiste) {
    await servidor.register(estaticos, {
      root: pastas.pdv,
      prefix: "/",
      // `decorateReply` só uma vez por instância: o segundo registro estouraria
      // com "sendFile já decorado".
      decorateReply: true,
      ...cabecalhos(),
    });
  }

  if (!pdvExiste || !retaguardaExiste) {
    servidor.log.warn(
      { pdv: pdvExiste, retaguarda: retaguardaExiste },
      "Tela não encontrada em dist/. Em desenvolvimento isso é esperado — o Vite serve. Em produção, o build faltou.",
    );
  }

  if (!pdvExiste) return;

  /**
   * Recarregar `/venda` precisa devolver a aplicação, não 404.
   *
   * As duas telas são de página única: o caminho é interpretado pelo
   * JavaScript, não pelo servidor. Sem isto, o operador que aperta F5 numa tela
   * interna cai em "não encontrado" — e a PWA nem chega a abrir do cache.
   */
  servidor.setNotFoundHandler((requisicao, resposta) => {
    if (requisicao.method !== "GET" || !ehCaminhoDeTela(requisicao.url)) {
      return resposta.status(404).send({
        erro: { codigo: "NAO_ENCONTRADO", mensagem: "Recurso não encontrado." },
      });
    }

    const raiz = requisicao.url.startsWith(PREFIXO_RETAGUARDA)
      ? pastas.retaguarda
      : pastas.pdv;

    // `sendFile` vem do `@fastify/static` registrado acima com
    // `decorateReply: true`. A raiz é escolhida aqui, e não no registro,
    // porque as duas telas compartilham este mesmo tratador.
    return resposta.sendFile("index.html", raiz);
  });
}

function cabecalhos() {
  return {
    setHeaders: (resposta: FastifyReply, caminho: string) => {
      // O service worker **não** pode ser cacheado pelo navegador: é ele que
      // decide o que fica em cache, e uma versão velha presa aqui congelaria a
      // estação numa versão antiga do sistema.
      if (caminho.endsWith("sw.js")) {
        void resposta.header("cache-control", "no-cache");
        return;
      }

      // Arquivo com hash no nome é imutável por construção: um ano de cache
      // poupa a rede da loja a cada abertura.
      if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(caminho)) {
        void resposta.header("cache-control", "public, max-age=31536000, immutable");
        return;
      }

      void resposta.header("cache-control", "no-cache");
    },
  };
}
