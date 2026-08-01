import type {
  CategoriaRepository,
  EmpresaRepository,
  ClienteRepository,
  FornecedorRepository,
} from "./RepositoriosCadastros.js";
import type {
  PapelRepository,
  SessaoAcessoRepository,
  UsuarioRepository,
} from "./RepositoriosAcesso.js";
import type {
  CodigoUnidade,
  DomainEvent,
  Identificador,
  MovimentoEstoque,
  Produto,
  SaldoEstoque,
  SessaoCaixa,
  Venda,
} from "@erp/domain";

/**
 * Repositórios falam de **negócio**, não de banco.
 *
 * Não existe `Repository<T>` genérico aqui de propósito: um repositório
 * genérico vira CRUD e vaza a abstração do banco para dentro do caso de uso.
 * `porCodigoDeBarras` diz o que o PDV precisa; `findOne` não diz nada.
 */

export interface ProdutoRepository {
  porId(id: Identificador): Promise<Produto | undefined>;

  /**
   * Busca por qualquer código do produto: barras, SKU ou referência de
   * fabricante. É a consulta do caminho quente do PDV — meta de 100 ms com
   * 50 mil SKUs (RNF-02).
   */
  porCodigo(codigo: string): Promise<Produto | undefined>;

  /** Busca pelo código interno usado na balança. */
  porCodigoBalanca(codigo: string): Promise<Produto | undefined>;

  salvar(produto: Produto): Promise<void>;
}

export interface VendaRepository {
  porId(id: Identificador): Promise<Venda | undefined>;
  salvar(venda: Venda): Promise<void>;
  /** Próximo número livre na série da estação. */
  proximoNumero(estacaoId: Identificador): Promise<number>;
}

export interface EstoqueRepository {
  /** Saldo projetado do produto. */
  saldo(produtoId: Identificador, unidade: CodigoUnidade): Promise<SaldoEstoque>;
  registrar(movimento: MovimentoEstoque): Promise<void>;
}

export interface CaixaRepository {
  porId(id: Identificador): Promise<SessaoCaixa | undefined>;
  /** Sessão aberta numa estação, se houver. Só pode existir uma. */
  abertaNaEstacao(estacaoId: Identificador): Promise<SessaoCaixa | undefined>;
  salvar(sessao: SessaoCaixa): Promise<void>;
}

/**
 * Fila de eventos a entregar.
 *
 * Gravada **na mesma transação** do dado que a originou (ADR-0006). É isso que
 * impede o pior defeito deste fluxo: a venda gravar e o evento se perder, ou o
 * contrário — nota fiscal emitida para venda que a transação reverteu.
 */
export interface OutboxRepository {
  enfileirar(eventos: readonly DomainEvent[]): Promise<void>;
}

/** Conjunto de repositórios participando da mesma transação. */
export interface Repositorios {
  readonly produtos: ProdutoRepository;
  readonly vendas: VendaRepository;
  readonly estoque: EstoqueRepository;
  readonly caixas: CaixaRepository;
  readonly outbox: OutboxRepository;
  readonly usuarios: UsuarioRepository;
  readonly papeis: PapelRepository;
  readonly sessoes: SessaoAcessoRepository;
  readonly empresa: EmpresaRepository;
  readonly categorias: CategoriaRepository;
  readonly clientes: ClienteRepository;
  readonly fornecedores: FornecedorRepository;
}
