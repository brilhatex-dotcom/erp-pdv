/// <reference lib="webworker" />

import {
  cachePrimeiro,
  type Dependencias,
  limparCachesAntigos,
  redePrimeiro,
} from "./cache.js";
import { estrategiaPara } from "./estrategia.js";

/**
 * Service worker do PDV.
 *
 * Casca em volta de `estrategia.ts` e `cache.ts`, que é onde moram as decisões
 * e os testes. Aqui só há ligação com o navegador: ouvir evento, perguntar a
 * estratégia, cumprir.
 *
 * ### O que ele resolve, e o que não é papel dele
 *
 * **Resolve:** a tela abrir com o servidor da loja fora do ar. Sem isso, uma
 * queda de rede no meio do expediente mostra a tela de erro do navegador, e o
 * caixa para antes mesmo de o Agente Local ter chance de enfileirar qualquer
 * coisa.
 *
 * **Não é papel dele:** guardar venda, preço ou catálogo. Isso é do Agente
 * Local, que grava em disco com `fsync` (ADR-0023). O cache do navegador pode
 * ser descartado pelo sistema a qualquer momento — aceitável para a tela,
 * inaceitável para uma venda.
 */

declare const self: ServiceWorkerGlobalScope;

/**
 * O nome carrega a versão do build.
 *
 * Cache antigo com código novo é a origem clássica de "só funciona depois de
 * limpar o navegador" — e no balcão ninguém vai limpar navegador. Trocar o nome
 * a cada versão faz a limpeza acontecer sozinha, no `activate`.
 */
const CACHE = `pdv-${__VERSAO_DO_BUILD__}`;

const dependencias: Dependencias = {
  armazem: caches,
  buscar: async (pedido) => fetch(pedido),
  nomeDoCache: CACHE,
};

self.addEventListener("install", (evento) => {
  // `skipWaiting`: a estação do caixa costuma ficar dias com a mesma aba aberta.
  // Esperar todas fecharem para ativar a versão nova significa nunca ativar.
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      await limparCachesAntigos(await caches.keys(), CACHE, async (nome) =>
        caches.delete(nome),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);

  // Outra origem não é problema nosso: deixa passar direto, sem interceptar.
  if (url.origin !== self.location.origin) return;

  const estrategia = estrategiaPara({
    metodo: evento.request.method,
    caminho: url.pathname,
    ehNavegacao: evento.request.mode === "navigate",
  });

  if (estrategia === "SEMPRE_REDE") return;

  evento.respondWith(
    estrategia === "CACHE_PRIMEIRO"
      ? cachePrimeiro(evento.request, dependencias)
      : redePrimeiro(evento.request, dependencias),
  );
});
