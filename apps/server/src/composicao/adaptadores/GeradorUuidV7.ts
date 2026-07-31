import type { GeradorId, Relogio } from "@erp/application";
import { BYTES_ALEATORIOS_UUID_V7, type Identificador, montarUuidV7 } from "@erp/domain";
import { randomFillSync } from "node:crypto";

/**
 * Gerador de UUIDv7 (ADR-0008).
 *
 * Os dois insumos que o domínio não pode ter — instante e entropia — entram por
 * aqui. O instante vem do `Relogio`, e não de `Date.now()` direto, para que o
 * identificador e o registro que ele nomeia carreguem **a mesma** fonte de
 * tempo: ordenar vendas pelo id e ordenar pela data precisam dar o mesmo
 * resultado, ou o diagnóstico remoto passa a mentir.
 *
 * A entropia vem de `randomFillSync`, do gerador criptográfico do sistema.
 * `Math.random` seria previsível, e identificador previsível permite adivinhar
 * o id da venda seguinte.
 */
export class GeradorUuidV7 implements GeradorId {
  constructor(private readonly relogio: Relogio) {}

  proximo(): Identificador {
    const aleatorios = randomFillSync(new Uint8Array(BYTES_ALEATORIOS_UUID_V7));

    const identificador = montarUuidV7(this.relogio.agora().getTime(), aleatorios);

    // Inalcançável: instante do relógio e tamanho do buffer são ambos válidos
    // por construção. O `throw` existe porque, se algum dia deixarem de ser, o
    // defeito é de programação — e aí precisa parar o processo, não gerar
    // identificador silenciosamente errado.
    /* v8 ignore start */
    if (identificador.isErr()) {
      throw new Error(`Falha ao gerar identificador: ${identificador.error.codigo}`);
    }
    /* v8 ignore stop */

    return identificador.unwrap();
  }
}
