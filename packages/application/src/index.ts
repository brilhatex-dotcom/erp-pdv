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
  type SaidaAdicionarItem,
} from "./casos-de-uso/vendas/AdicionarItemPorCodigo.js";
export {
  type AlvoDesconto,
  AplicarDesconto,
  type EntradaAplicarDesconto,
} from "./casos-de-uso/vendas/AplicarDesconto.js";
export {
  CancelarVenda,
  type EntradaCancelarVenda,
  type EstornoAoCliente,
  type SaidaCancelarVenda,
} from "./casos-de-uso/vendas/CancelarVenda.js";
export {
  AlterarQuantidadeItem,
  type EntradaAlterarQuantidade,
  type EntradaRemoverItem,
  type EntradaRemoverPagamento,
  RemoverItem,
  RemoverPagamento,
} from "./casos-de-uso/vendas/CorrigirVenda.js";
export {
  type EntradaRetomarVenda,
  type EntradaSuspenderVenda,
  RetomarVenda,
  SuspenderVenda,
} from "./casos-de-uso/vendas/GuardarVenda.js";
export {
  type EntradaIdentificarCliente,
  IdentificarCliente,
} from "./casos-de-uso/vendas/IdentificarCliente.js";
export {
  type EntradaRegistrarDevolucao,
  RegistrarDevolucao,
} from "./casos-de-uso/vendas/RegistrarDevolucao.js";
export {
  configuracaoDaLoja,
  custoNoMomento,
  formatarPercentual,
  resumoParaCaixa,
} from "./casos-de-uso/vendas/apoio.js";

// ── Cópias de segurança ─────────────────────────────────────────────────
export {
  type ConferenciaDaCopia,
  ConferirCopiaDeSeguranca,
  descreverCopia,
  type EntradaFazerCopia,
  type EntradaRestaurarCopia,
  FazerCopiaDeSeguranca,
  formatarTamanho,
  PALAVRA_DE_CONFIRMACAO,
  RestaurarCopiaDeSeguranca,
  type SaidaRestaurarCopia,
  TravaDeCopias,
} from "./casos-de-uso/backup/CopiasDeSeguranca.js";
export {
  AgendaDeCopias,
  ConsultarCopiasDeSeguranca,
  copiaAutomaticaDevida,
  DefinirConfiguracaoDeBackup,
  type EntradaDefinirConfiguracaoDeBackup,
  type MarcosDaAgenda,
  proximaCopiaAutomatica,
  type SituacaoDasCopias,
} from "./casos-de-uso/backup/AgendaDeCopias.js";
export {
  CONFIGURACAO_DE_BACKUP_PADRAO,
  INTERVALOS_DE_BACKUP,
} from "./casos-de-uso/backup/configuracao.js";
export type {
  ArquivoGerado,
  CopiaGuardada,
  FerramentaDeBackup,
  Manutencao,
  PastaDeCopias,
  ProvaDaCopia,
  ResumoDoBanco,
} from "./casos-de-uso/backup/portas.js";
export type {
  BackupRepository,
  ConfiguracaoDeBackup,
  ExecucaoDeBackup,
  OperacaoDeBackup,
  OrigemDaCopia,
  SituacaoDaExecucao,
} from "./portas/repositorios/RepositoriosBackup.js";
export {
  copiasParaApagar,
  type PoliticaDeRetencao,
  RETENCAO_PADRAO,
  semanaIso,
} from "./casos-de-uso/backup/retencao.js";

// ── Configuração, imagens e auditoria ───────────────────────────────────
export {
  DefinirConfiguracaoLoja,
  type EntradaDefinirConfiguracao,
  ObterConfiguracaoLoja,
} from "./casos-de-uso/configuracao/ConfigurarLoja.js";
export {
  detectarTipoImagem,
  GuardarImagem,
  type ResumoDeConteudo,
  TAMANHO_MAXIMO_IMAGEM,
  type TipoImagem,
} from "./casos-de-uso/imagens/GuardarImagem.js";
export {
  type AcaoAuditada,
  ACOES_AUDITADAS,
  auditar,
  type DadoAuditado,
  ehAcaoAuditada,
  type RegistroAuditoria,
} from "./auditoria/RegistroAuditoria.js";
export type {
  AuditoriaRepository,
  ConfiguracaoLojaRepository,
  DevolucaoRepository,
  ImagemParaGravar,
  ImagemRepository,
} from "./portas/repositorios/RepositoriosBalcao.js";
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
  type OpcoesRegistrarPagamento,
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
  type Autorizacao,
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

// ── Financeiro ──────────────────────────────────────────────────────────
export type {
  FiltroTitulos,
  TituloRepository,
} from "./portas/repositorios/RepositoriosFinanceiro.js";
export {
  gerarTitulosDaVenda,
  type PedidoDeCrediario,
} from "./casos-de-uso/financeiro/gerarTitulosDaVenda.js";
export {
  type EntradaLancarTitulo,
  LancarTitulo,
} from "./casos-de-uso/financeiro/LancarTitulo.js";
export {
  AdiarVencimento,
  CancelarTitulo,
  type EntradaAdiarVencimento,
  type EntradaCancelarTitulo,
  type EntradaEstornarRecebimento,
  type EntradaRegistrarRecebimento,
  EstornarRecebimento,
  RegistrarRecebimento,
} from "./casos-de-uso/financeiro/MovimentarTitulo.js";

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

// ── Treinamento (ADR-0026) ──────────────────────────────────────────────
export {
  type BancoDeTreinamento,
  LojaDeTreinamento,
} from "./casos-de-uso/treinamento/LojaDeTreinamento.js";
export {
  CATEGORIAS_DE_TREINO,
  type CategoriaDeTreino,
  CLIENTES_DE_TREINO,
  type ClienteDeTreino,
  type ExemploDeCodigo,
  exemplosDeCodigo,
  PESSOAS_DE_TREINO,
  type PessoaDeTreino,
  PRODUTOS_DE_TREINO,
  type ProdutoDeTreino,
} from "./casos-de-uso/treinamento/lojaDeTreino.js";
