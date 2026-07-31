// ── Erros ───────────────────────────────────────────────────────────────
export { ErroInfraestrutura } from "./erros/ErroInfraestrutura.js";

// ── Portas ──────────────────────────────────────────────────────────────
export type { GeradorId } from "./portas/infraestrutura/GeradorId.js";
export type { Relogio } from "./portas/infraestrutura/Relogio.js";
export type { UnitOfWork } from "./portas/infraestrutura/UnitOfWork.js";
export type {
  CaixaRepository,
  EstoqueRepository,
  OutboxRepository,
  ProdutoRepository,
  Repositorios,
  VendaRepository,
} from "./portas/repositorios/Repositorios.js";

// ── Casos de uso ────────────────────────────────────────────────────────
export {
  AdicionarItemPorCodigo,
  type EntradaAdicionarItem,
} from "./casos-de-uso/vendas/AdicionarItemPorCodigo.js";
export {
  type EntradaFinalizarVenda,
  FinalizarVenda,
  type SaidaFinalizarVenda,
} from "./casos-de-uso/vendas/FinalizarVenda.js";
export {
  type EntradaIniciarVenda,
  IniciarVenda,
} from "./casos-de-uso/vendas/IniciarVenda.js";
export {
  type EntradaRegistrarPagamento,
  RegistrarPagamento,
  type SaidaRegistrarPagamento,
} from "./casos-de-uso/vendas/RegistrarPagamento.js";
