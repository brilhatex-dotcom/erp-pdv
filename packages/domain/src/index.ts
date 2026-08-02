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
export { Documento, type TipoDocumento } from "./valores/Documento.js";
export { Email } from "./valores/Email.js";
export { type DadosEndereco, Endereco } from "./valores/Endereco.js";
export { InscricaoEstadual } from "./valores/InscricaoEstadual.js";
export { CASAS_DECIMAIS, Quantidade } from "./valores/Quantidade.js";
export { Telefone } from "./valores/Telefone.js";
export {
  ehSiglaUF,
  obterUF,
  type SiglaUF,
  UFS,
  type UnidadeFederativa,
} from "./valores/UF.js";
export {
  type CodigoUnidade,
  ehCodigoUnidade,
  obterUnidade,
  UNIDADES,
  type UnidadeMedida,
} from "./valores/UnidadeMedida.js";

// ── Cadastros ───────────────────────────────────────────────────────────
export { Categoria, type DadosCategoria } from "./cadastros/Categoria.js";
export { Cliente, type DadosCliente, type TipoPessoa } from "./cadastros/Cliente.js";
export {
  type DadosEmpresa,
  ehRegimeTributario,
  Empresa,
  REGIMES_TRIBUTARIOS,
  type RegimeTributario,
} from "./cadastros/Empresa.js";
export { type DadosFornecedor, Fornecedor } from "./cadastros/Fornecedor.js";

// ── Financeiro ──────────────────────────────────────────────────────────
export {
  type Baixa,
  type DadosTitulo,
  ehOrigemTitulo,
  ehTipoTitulo,
  ORIGENS_TITULO,
  type OrigemTitulo,
  type SituacaoTitulo,
  SITUACOES_TITULO,
  type TipoTitulo,
  TIPOS_TITULO,
  Titulo,
} from "./financeiro/Titulo.js";
export {
  DIAS_ENTRE_PARCELAS_PADRAO,
  DIAS_PRIMEIRO_VENCIMENTO_PADRAO,
  montarPlanoDeParcelas,
  type Parcela,
  type PedidoDeParcelamento,
} from "./financeiro/planoDeParcelas.js";

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

// ── Compras ─────────────────────────────────────────────────────────────
export { type DadosItemDaNota, ItemDaNota } from "./compras/ItemDaNota.js";
export {
  type DadosNotaDeCompra,
  NotaDeCompra,
  type StatusNota,
} from "./compras/NotaDeCompra.js";

// ── Estoque ─────────────────────────────────────────────────────────────
export {
  type DadosMovimento,
  MovimentoEstoque,
  type OrigemMovimento,
} from "./estoque/MovimentoEstoque.js";
export { type EstoqueMovimentado, estoqueMovimentado } from "./estoque/eventos.js";
export { SaldoEstoque } from "./estoque/SaldoEstoque.js";
export {
  afetaCustoMedio,
  efeitoDoTipo,
  ehEntrada,
  ehSaida,
  type TipoMovimento,
} from "./estoque/TipoMovimento.js";

// ── Vendas ──────────────────────────────────────────────────────────────
export {
  type CodigoFormaPagamento,
  CODIGOS_FORMA_PAGAMENTO,
  ehCodigoFormaPagamento,
  type FormaPagamento,
  FORMAS_PAGAMENTO,
  obterFormaPagamento,
} from "./vendas/FormaPagamento.js";
export { Pagamento } from "./vendas/Pagamento.js";
export {
  type EventoVenda,
  type ItemVendido,
  type VendaCancelada,
  type VendaFinalizada,
} from "./vendas/eventos.js";
export {
  type DadosReconstituicaoVenda,
  type DadosVenda,
  type StatusVenda,
  Venda,
} from "./vendas/Venda.js";
export { type DadosItemVenda, VendaItem } from "./vendas/VendaItem.js";

// ── Caixa ───────────────────────────────────────────────────────────────
export {
  type DadosMovimentoCaixa,
  MovimentoCaixa,
  type TipoMovimentoCaixa,
} from "./caixa/MovimentoCaixa.js";
export {
  type ConferenciaCaixa,
  type ConferenciaForma,
  type DadosReconstituicaoCaixa,
  type DadosSessaoCaixa,
  type ErroCaixa,
  type PagamentoResumido,
  type ResumoVenda,
  SessaoCaixa,
  type StatusCaixa,
} from "./caixa/SessaoCaixa.js";

// ── Identidade ──────────────────────────────────────────────────────────
export { CredencialHash } from "./identidade/CredencialHash.js";
export {
  type CredencialBloqueada,
  credencialBloqueada,
  type EventoIdentidade,
  type FamiliaDeSessaoRevogada,
  familiaDeSessaoRevogada,
  type OperacaoAutorizadaPorSupervisor,
  operacaoAutorizadaPorSupervisor,
  type TentativaRecusada,
  tentativaRecusada,
} from "./identidade/eventos.js";
export { Matricula } from "./identidade/Matricula.js";
export {
  BASE_PERCENTUAL,
  type DadosPapel,
  type LimitesPapel,
  Papel,
} from "./identidade/Papel.js";
export {
  type CodigoPapelPadrao,
  MODELOS_PAPEL_PADRAO,
  papelPadrao,
} from "./identidade/papeisPadrao.js";
export { ehPermissao, type Permissao, PERMISSOES } from "./identidade/Permissao.js";
export { Pin, TAMANHO_PIN } from "./identidade/Pin.js";
export {
  type AcaoSolicitada,
  avaliar,
  type Decisao,
  podeAutorizar,
} from "./identidade/PoliticaAutorizacao.js";
export { Senha, TAMANHO_MINIMO_SENHA } from "./identidade/Senha.js";
export {
  type ContextoSessao,
  type DadosReconstituicaoSessao,
  type DadosSessaoAcesso,
  SessaoAcesso,
} from "./identidade/SessaoAcesso.js";
export {
  type DadosReconstituicaoUsuario,
  type DadosUsuario,
  type ErroUsuario,
  MINUTOS_BLOQUEIO_MAXIMO,
  MINUTOS_PRIMEIRO_BLOQUEIO,
  TENTATIVAS_ATE_BLOQUEIO,
  Usuario,
} from "./identidade/Usuario.js";
