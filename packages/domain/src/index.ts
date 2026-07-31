// ── Base ────────────────────────────────────────────────────────────────
export { AggregateRoot } from "./shared/AggregateRoot.js";
export type { DomainEvent } from "./shared/DomainEvent.js";
export {
  DomainError,
  ErroConflito,
  ErroNaoAutorizado,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  ErroValidacao,
  type TipoErro,
} from "./shared/DomainError.js";
export { Entity } from "./shared/Entity.js";
export {
  BYTES_ALEATORIOS_UUID_V7,
  Identificador,
  montarUuidV7,
} from "./shared/Identificador.js";
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

// ── Catálogo ────────────────────────────────────────────────────────────
export {
  type ConteudoBalanca,
  ehCodigoDeBalanca,
  interpretarCodigoBalanca,
  LAYOUT_BALANCA_PADRAO,
  type LayoutBalanca,
  type LeituraBalanca,
} from "./catalogo/CodigoBalanca.js";
export {
  CodigoBarras,
  type PadraoCodigo,
  temDigitoVerificadorValido,
} from "./catalogo/CodigoBarras.js";
export { Embalagem } from "./catalogo/Embalagem.js";
export {
  custoAlterado,
  type CustoAlterado,
  type EventoCatalogo,
  precoAlterado,
  type PrecoAlterado,
  type ProdutoAtivado,
  type ProdutoDesativado,
} from "./catalogo/eventos.js";
export { type DadosProduto, Produto, type TipoProduto } from "./catalogo/Produto.js";
export { ReferenciaProduto, type TipoReferencia } from "./catalogo/ReferenciaProduto.js";
