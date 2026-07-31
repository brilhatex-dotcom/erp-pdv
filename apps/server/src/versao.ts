import { createRequire } from "node:module";
import { z } from "zod";

/**
 * Versão instalada, lida do `package.json`.
 *
 * Lida em tempo de execução, e não copiada para uma constante, porque duas
 * fontes de verdade para a versão divergem — e divergem exatamente quando
 * importam: no atendimento de um cliente que está numa versão diferente da que
 * o log diz. A versão é o primeiro dado de qualquer diagnóstico remoto
 * (ARQUITETURA.md §13.3).
 *
 * `createRequire` em vez de `import` de JSON: o caminho relativo resolve igual
 * rodando de `src/` e de `dist/`, e não depende de flag experimental do Node.
 */
const zPacote = z.object({ version: z.string().min(1) });

export const VERSAO: string = lerVersao();

function lerVersao(): string {
  const conteudo: unknown = createRequire(import.meta.url)("../package.json");

  return zPacote.parse(conteudo).version;
}
