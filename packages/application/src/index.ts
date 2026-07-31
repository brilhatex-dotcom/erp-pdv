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
export { AbrirCaixa, type EntradaAbrirCaixa } from "./casos-de-uso/caixa/AbrirCaixa.js";
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

// ── Acesso ──────────────────────────────────────────────────────────────
export type { Hasher } from "./portas/infraestrutura/Hasher.js";
export type {
  PapelRepository,
  SessaoAcessoRepository,
  UsuarioRepository,
} from "./portas/repositorios/RepositoriosAcesso.js";
export {
  Autenticar,
  type EntradaAutenticar,
  HORAS_SESSAO_PDV,
  HORAS_SESSAO_RETAGUARDA,
  type SaidaAutenticar,
  vencimento,
} from "./casos-de-uso/acesso/Autenticar.js";
export {
  AutorizarOperacao,
  type CredencialSupervisor,
  type EntradaAutorizar,
} from "./casos-de-uso/acesso/AutorizarOperacao.js";
export {
  type EntradaRenovarSessao,
  RenovarSessao,
  type SaidaRenovarSessao,
} from "./casos-de-uso/acesso/RenovarSessao.js";
