// ── Base ────────────────────────────────────────────────────────────────
export {
  DomainError,
  ErroConflito,
  ErroNaoAutorizado,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  ErroValidacao,
  type TipoErro,
} from "./shared/DomainError.js";
export { combine, combineAll, err, Err, ok, Ok, type Result } from "./shared/Result.js";
export type { ValueObject } from "./shared/ValueObject.js";

// ── Objetos de valor ────────────────────────────────────────────────────
export { CNPJ } from "./valores/CNPJ.js";
export { CPF } from "./valores/CPF.js";
export { Dinheiro } from "./valores/Dinheiro.js";
export { CASAS_DECIMAIS, Quantidade } from "./valores/Quantidade.js";
export {
  type CodigoUnidade,
  ehCodigoUnidade,
  obterUnidade,
  UNIDADES,
  type UnidadeMedida,
} from "./valores/UnidadeMedida.js";
