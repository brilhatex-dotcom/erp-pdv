import type { Identificador } from "@erp/domain";

/**
 * Gerador de identificadores UUIDv7.
 *
 * O domínio expõe apenas `montarUuidV7`, que é puro e recebe instante e
 * entropia. Quem fornece os dois é o adapter — e é por isso que a geração é
 * uma porta: `crypto.getRandomValues` e o relógio são infraestrutura, e o
 * domínio não os conhece.
 */
export interface GeradorId {
  proximo(): Identificador;
}
