import type { GeradorId } from "../portas/infraestrutura/GeradorId.js";
import type { Repositorios } from "../portas/repositorios/Repositorios.js";
import type { RegistroAuditoria } from "./tipos.js";

export {
  ACOES_AUDITADAS,
  type AcaoAuditada,
  type DadoAuditado,
  ehAcaoAuditada,
  type RegistroAuditoria,
} from "./tipos.js";

/** Tamanho da coluna; descrição maior é cortada, nunca recusada. */
const TAMANHO_MAXIMO_DESCRICAO = 300;

/**
 * Grava um registro de auditoria **dentro da transação de quem chamou**.
 *
 * Nunca em transação própria: auditoria gravada separada da operação pode
 * existir sem a operação — ou faltar para uma operação que aconteceu. As duas
 * situações destroem o valor de prova do registro.
 */
export async function auditar(
  repositorios: Repositorios,
  geradorId: GeradorId,
  registro: Omit<RegistroAuditoria, "id">,
): Promise<void> {
  const descricao =
    registro.descricao.length > TAMANHO_MAXIMO_DESCRICAO
      ? `${registro.descricao.slice(0, TAMANHO_MAXIMO_DESCRICAO - 1)}…`
      : registro.descricao;

  await repositorios.auditoria.registrar({
    ...registro,
    id: geradorId.proximo(),
    descricao,
  });
}
