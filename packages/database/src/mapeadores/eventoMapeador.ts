import { Dinheiro, type DomainEvent, Identificador, Quantidade } from "@erp/domain";

import type { Prisma } from "../gerado/index.js";

/**
 * Serializa um evento de domínio para o corpo JSON da outbox.
 *
 * O formato do payload é decisão **de infraestrutura**, e por isso mora aqui e
 * não no domínio: quem consome a fila — o worker fiscal, a replicação para o
 * PDV — é que precisa de um formato estável.
 *
 * `JSON.stringify` sozinho não serve. Os objetos de valor guardam o estado em
 * campos privados (`#valor`), então sairiam como `{}` — o evento chegaria vazio
 * ao worker fiscal e a nota seria emitida sem valor. E `bigint` faz o
 * `stringify` lançar. Os dois casos são tratados explicitamente abaixo.
 */
export function serializarEvento(evento: DomainEvent): Prisma.InputJsonValue {
  return converter(evento) as Prisma.InputJsonValue;
}

function converter(valor: unknown): unknown {
  // Dinheiro vira **centavos em texto**, nunca número: `2^53` centavos é um
  // teto que a soma anual de uma rede alcança, e perder o centavo aqui é
  // perdê-lo no documento fiscal.
  if (valor instanceof Dinheiro) return valor.centavos.toString();

  if (valor instanceof Quantidade) {
    return { milesimos: valor.milesimos.toString(), unidade: valor.unidade.codigo };
  }

  if (valor instanceof Identificador) return valor.valor;

  if (valor instanceof Date) return valor.toISOString();

  if (typeof valor === "bigint") return valor.toString();

  if (Array.isArray(valor)) return valor.map(converter);

  if (typeof valor === "object" && valor !== null) {
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor)) {
      // `undefined` some no JSON de qualquer forma; omitir aqui deixa o payload
      // explícito sobre o que o evento realmente carregava.
      if (item !== undefined) saida[chave] = converter(item);
    }
    return saida;
  }

  return valor;
}
