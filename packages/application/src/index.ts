// ── Erros ───────────────────────────────────────────────────────────────
export { agregarErros } from "./erros/agregarErros.js";
export { ErroInfraestrutura } from "./erros/ErroInfraestrutura.js";

// ── Portas ──────────────────────────────────────────────────────────────
export type { FiltroBusca } from "./portas/repositorios/FiltroBusca.js";
export type { GeradorId } from "./portas/infraestrutura/GeradorId.js";
export type { Relogio } from "./portas/infraestrutura/Relogio.js";
export type { UnitOfWork } from "./portas/infraestrutura/UnitOfWork.js";
export type {
  CaixaRepository,
  EstoqueRepository,
  NotaDeCompraRepository,
  OutboxRepository,
  ProdutoRepository,
  Repositorios,
  VendaRepository,
} from "./portas/repositorios/Repositorios.js";

// ── Casos de uso ────────────────────────────────────────────────────────
export { AbrirCaixa, type EntradaAbrirCaixa } from "./casos-de-uso/caixa/AbrirCaixa.js";
export {
  CriarPrimeiroAdministrador,
  type EntradaPrimeiroAdministrador,
  InstalacaoPrecisaConfiguracao,
} from "./casos-de-uso/usuarios/CriarPrimeiroAdministrador.js";
export {
  DefinirEmpresa,
  type EntradaDefinirEmpresa,
} from "./casos-de-uso/cadastros/DefinirEmpresa.js";
export {
  AlterarUsuario,
  CadastrarUsuario,
  DefinirCredencial,
  type EntradaAlterarUsuario,
  type EntradaCadastrarUsuario,
  type EntradaDefinirCredencial,
} from "./casos-de-uso/usuarios/GerirUsuarios.js";
export {
  type EntradaFecharCaixa,
  FecharCaixa,
  type ResultadoFechamento,
} from "./casos-de-uso/caixa/FecharCaixa.js";
export {
  type EntradaSangria,
  type EntradaSuprimento,
  RegistrarSangria,
  RegistrarSuprimento,
} from "./casos-de-uso/caixa/MovimentarCaixa.js";
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

// ── Catálogo ────────────────────────────────────────────────────────────
export {
  AlterarPrecoDoProduto,
  type EntradaAlterarPreco,
} from "./casos-de-uso/catalogo/AlterarPrecoDoProduto.js";
export {
  AlterarProduto,
  type EntradaAlterarProduto,
} from "./casos-de-uso/catalogo/AlterarProduto.js";
export {
  CadastrarProduto,
  type EntradaCadastrarProduto,
} from "./casos-de-uso/catalogo/CadastrarProduto.js";
export type {
  EmbalagemBruta,
  ReferenciaBruta,
} from "./casos-de-uso/catalogo/interpretarProduto.js";

// ── Compras ─────────────────────────────────────────────────────────────
export {
  CancelarNotaDeCompra,
  type EntradaCancelarNota,
} from "./casos-de-uso/compras/CancelarNotaDeCompra.js";
export {
  type EntradaLancarNota,
  type ItemBruto,
  LancarNotaDeCompra,
} from "./casos-de-uso/compras/LancarNotaDeCompra.js";

// ── Estoque ─────────────────────────────────────────────────────────────
export {
  type EntradaMovimento,
  RegistrarMovimento,
} from "./casos-de-uso/estoque/RegistrarMovimento.js";

// ── Cadastros ───────────────────────────────────────────────────────────
export type {
  CategoriaRepository,
  ClienteRepository,
  EmpresaRepository,
  FornecedorRepository,
} from "./portas/repositorios/RepositoriosCadastros.js";
export {
  AlterarCategoria,
  type EntradaAlterarCategoria,
} from "./casos-de-uso/cadastros/AlterarCategoria.js";
export {
  AlterarCliente,
  type EntradaAlterarCliente,
} from "./casos-de-uso/cadastros/AlterarCliente.js";
export {
  AlterarFornecedor,
  type EntradaAlterarFornecedor,
} from "./casos-de-uso/cadastros/AlterarFornecedor.js";
export {
  CadastrarCategoria,
  type EntradaCadastrarCategoria,
} from "./casos-de-uso/cadastros/CadastrarCategoria.js";
export {
  CadastrarCliente,
  type EntradaCadastrarCliente,
} from "./casos-de-uso/cadastros/CadastrarCliente.js";
export {
  CadastrarFornecedor,
  type EntradaCadastrarFornecedor,
} from "./casos-de-uso/cadastros/CadastrarFornecedor.js";
