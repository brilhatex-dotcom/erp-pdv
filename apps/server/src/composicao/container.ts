import {
  AgendaDeCopias,
  Autenticar,
  AutorizarOperacao,
  ConferirCopiaDeSeguranca,
  ConsultarCopiasDeSeguranca,
  DefinirConfiguracaoDeBackup,
  FazerCopiaDeSeguranca,
  type FerramentaDeBackup,
  type PastaDeCopias,
  RestaurarCopiaDeSeguranca,
  TravaDeCopias,
  type GeradorId,
  type Hasher,
  IniciarVenda,
  AbrirCaixa,
  FecharCaixa,
  RegistrarSangria,
  RegistrarSuprimento,
  AdicionarItemPorCodigo,
  AlterarUsuario,
  CadastrarUsuario,
  CriarPrimeiroAdministrador,
  DefinirCredencial,
  InstalacaoPrecisaConfiguracao,
  AlterarCategoria,
  AlterarCliente,
  AlterarPrecoDoProduto,
  AlterarProduto,
  CadastrarProduto,
  CancelarNotaDeCompra,
  LancarNotaDeCompra,
  RegistrarMovimento,
  AlterarFornecedor,
  CadastrarCategoria,
  CadastrarCliente,
  CadastrarFornecedor,
  AdiarVencimento,
  CancelarTitulo,
  DefinirEmpresa,
  EstornarRecebimento,
  LancarTitulo,
  RegistrarRecebimento,
  FinalizarVenda,
  RegistrarPagamento,
  RenovarSessao,
  AlterarQuantidadeItem,
  AplicarDesconto,
  CancelarVenda,
  DefinirConfiguracaoLoja,
  GuardarImagem,
  IdentificarCliente,
  ObterConfiguracaoLoja,
  RegistrarDevolucao,
  RemoverItem,
  RemoverPagamento,
  RetomarVenda,
  SuspenderVenda,
  type Relogio,
  type Repositorios,
  type UnitOfWork,
} from "@erp/application";
import {
  criarPrismaClient,
  FerramentaPostgres,
  HasherArgon2,
  montarRepositorios,
  PastaDeCopiasNoDisco,
  type PrismaClient,
  UnitOfWorkPrisma,
} from "@erp/database";
import { BYTES_ALEATORIOS_UUID_V7, type Identificador, montarUuidV7 } from "@erp/domain";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";

import type { Ambiente } from "../ambiente.js";
import { ManutencaoDoServidor } from "./manutencao.js";

/**
 * Container de composição.
 *
 * É o **único** lugar do sistema que conhece implementações concretas. Tudo
 * abaixo dele fala com portas. Trocar Postgres por outro banco, ou Argon2id por
 * outro algoritmo, é mexer aqui — e em nenhum caso de uso.
 *
 * É explícito de propósito, sem framework de injeção: um container de 60 linhas
 * que se lê de cima a baixo tem custo de manutenção menor que decorators e
 * resolução mágica, e o comitê já rejeitou NestJS pelo mesmo motivo
 * (ARQUITETURA.md §5.2.3).
 *
 * Quando o módulo fiscal entrar, é aqui que o `ProvedorFiscalNulo` é registrado
 * para a empresa que não emite documento (ADR-0016) — sem um `if` sequer dentro
 * do domínio.
 */
/**
 * Qual banco este container serve.
 *
 * O modo treinamento é uma **segunda instalação lógica** dentro do mesmo
 * servidor: outro banco, outras vendas, os mesmos casos de uso (ADR-0026). O
 * modo vai no container, e não numa variável global, para que nada fora da
 * composição precise saber qual dos dois está atendendo.
 */
export type ModoOperacao = "REAL" | "TREINAMENTO";

/** As cópias de segurança do banco da loja, com a pasta onde elas moram. */
export interface CopiasDoServidor {
  readonly pasta: string;
  readonly fazer: FazerCopiaDeSeguranca;
  readonly conferir: ConferirCopiaDeSeguranca;
  readonly restaurar: RestaurarCopiaDeSeguranca;
  readonly consultar: ConsultarCopiasDeSeguranca;
  readonly definirAgenda: DefinirConfiguracaoDeBackup;
  readonly agenda: AgendaDeCopias;
}

/** Trocas que o teste faz na composição. */
export interface OpcoesDoContainer {
  /**
   * A ferramenta e a pasta das cópias, no lugar das de verdade.
   *
   * É o que deixa o teste das rotas provocar a cópia que falha, sem precisar
   * corromper um banco de verdade para isso.
   */
  readonly copias?: {
    readonly ferramenta: FerramentaDeBackup;
    readonly pasta: PastaDeCopias;
  };
}

export interface Container {
  readonly ambiente: Ambiente;
  readonly modo: ModoOperacao;
  readonly prisma: PrismaClient;
  readonly unitOfWork: UnitOfWork;
  /**
   * Repositórios **fora** de transação, para leitura.
   *
   * Consulta que só lê não precisa de transação: abrir uma para responder "quem
   * sou eu" gastaria uma conexão do pool — que tem 20 no servidor da loja — sem
   * ganhar garantia nenhuma.
   */
  readonly leitura: Repositorios;
  readonly relogio: Relogio;
  readonly geradorId: GeradorId;
  readonly hasher: Hasher;

  /**
   * As cópias de segurança — só do banco real, e só com a pasta configurada.
   *
   * O banco de treinamento não tem cópia: ele é de mentira por definição, e a
   * cópia dele ocuparia o disco que a cópia de verdade precisa.
   */
  readonly copias: CopiasDoServidor | undefined;
  /** Ligada enquanto o banco é trocado por uma cópia: a API responde 503. */
  readonly manutencao: ManutencaoDoServidor;

  readonly autenticar: Autenticar;
  readonly renovarSessao: RenovarSessao;
  readonly autorizarOperacao: AutorizarOperacao;

  readonly cadastrarUsuario: CadastrarUsuario;
  readonly alterarUsuario: AlterarUsuario;
  readonly definirCredencial: DefinirCredencial;
  readonly criarPrimeiroAdministrador: CriarPrimeiroAdministrador;
  readonly instalacaoPrecisaConfiguracao: InstalacaoPrecisaConfiguracao;

  readonly abrirCaixa: AbrirCaixa;
  readonly registrarSangria: RegistrarSangria;
  readonly registrarSuprimento: RegistrarSuprimento;
  readonly fecharCaixa: Pick<FecharCaixa, "executar">;
  readonly iniciarVenda: IniciarVenda;
  readonly adicionarItem: AdicionarItemPorCodigo;
  readonly registrarPagamento: RegistrarPagamento;
  readonly finalizarVenda: FinalizarVenda;
  readonly alterarQuantidadeItem: AlterarQuantidadeItem;
  readonly removerItem: RemoverItem;
  readonly removerPagamento: RemoverPagamento;
  readonly aplicarDesconto: AplicarDesconto;
  readonly identificarCliente: IdentificarCliente;
  readonly suspenderVenda: SuspenderVenda;
  readonly retomarVenda: RetomarVenda;
  readonly cancelarVenda: CancelarVenda;
  readonly registrarDevolucao: RegistrarDevolucao;

  readonly obterConfiguracao: ObterConfiguracaoLoja;
  readonly definirConfiguracao: DefinirConfiguracaoLoja;
  readonly guardarImagem: GuardarImagem;

  readonly registrarMovimento: RegistrarMovimento;

  readonly lancarNotaDeCompra: LancarNotaDeCompra;
  readonly cancelarNotaDeCompra: CancelarNotaDeCompra;

  readonly cadastrarProduto: CadastrarProduto;
  readonly alterarProduto: AlterarProduto;
  readonly alterarPrecoDoProduto: AlterarPrecoDoProduto;

  readonly cadastrarCategoria: CadastrarCategoria;
  readonly alterarCategoria: AlterarCategoria;
  readonly cadastrarCliente: CadastrarCliente;
  readonly alterarCliente: AlterarCliente;
  readonly cadastrarFornecedor: CadastrarFornecedor;
  readonly alterarFornecedor: AlterarFornecedor;
  readonly definirEmpresa: DefinirEmpresa;

  readonly lancarTitulo: LancarTitulo;
  readonly registrarRecebimento: RegistrarRecebimento;
  readonly estornarRecebimento: EstornarRecebimento;
  readonly adiarVencimento: AdiarVencimento;
  readonly cancelarTitulo: CancelarTitulo;

  encerrar(): Promise<void>;
}

/** Relógio do sistema. É porta porque teste com relógio real não é determinístico. */
const relogioDoSistema: Relogio = { agora: () => new Date() };

/**
 * Gerador de UUIDv7 (ADR-0008).
 *
 * O domínio expõe `montarUuidV7`, que é puro; quem fornece tempo e entropia é
 * este adapter — porque `Date.now` e `randomBytes` são infraestrutura.
 */
const geradorUuidV7: GeradorId = {
  proximo(): Identificador {
    const aleatorios = new Uint8Array(randomBytes(BYTES_ALEATORIOS_UUID_V7));
    // Entrada sempre válida: instante atual e a quantidade exata de bytes.
    return montarUuidV7(Date.now(), aleatorios).unwrap();
  },
};

/**
 * Segredo do refresh token.
 *
 * 256 bits de `randomBytes` — gerador criptográfico, nunca `Math.random`. O
 * valor só existe em claro dentro do cookie do cliente; o banco guarda o hash.
 */
function gerarRefresh(): string {
  return randomBytes(32).toString("base64url");
}

export function montarContainer(
  ambiente: Ambiente,
  modo: ModoOperacao = "REAL",
  urlBanco: string = ambiente.DATABASE_URL,
  opcoes: OpcoesDoContainer = {},
): Container {
  const prisma = criarPrismaClient({
    urlBanco,
    // Só no desenvolvimento. No teste, cada consulta registrada vai para o log
    // do CI — mais de um milhão de caracteres por execução —, e a saída da
    // suíte que falhou fica soterrada além do que se consegue ler.
    registrarConsultas: ambiente.NODE_ENV === "development",
  });

  const unitOfWork = new UnitOfWorkPrisma(prisma);
  const hasher = new HasherArgon2();
  const relogio = relogioDoSistema;
  const geradorId = geradorUuidV7;
  // Uma instância só: a política de autorização é a mesma para todo caso de uso
  // que precisa dela, e duplicá-la abriria a porta para duas configurarem
  // diferente sem ninguém notar.
  const autorizar = new AutorizarOperacao(relogio, hasher);
  const leitura = montarRepositorios(prisma);
  const manutencao = new ManutencaoDoServidor();
  const copias =
    modo === "REAL" && ambiente.PASTA_COPIAS !== ""
      ? montarCopias(
          ambiente,
          urlBanco,
          unitOfWork,
          relogio,
          geradorId,
          manutencao,
          opcoes,
        )
      : undefined;
  const fecharCaixa = new FecharCaixa(unitOfWork, relogio, geradorId);

  return {
    ambiente,
    modo,
    prisma,
    unitOfWork,
    leitura,
    relogio,
    geradorId,
    hasher,
    copias,
    manutencao,

    autenticar: new Autenticar(unitOfWork, relogio, geradorId, hasher, gerarRefresh),
    renovarSessao: new RenovarSessao(
      unitOfWork,
      relogio,
      geradorId,
      hasher,
      gerarRefresh,
    ),
    autorizarOperacao: autorizar,

    cadastrarUsuario: new CadastrarUsuario(unitOfWork, geradorId, hasher),
    alterarUsuario: new AlterarUsuario(unitOfWork, geradorId),
    definirCredencial: new DefinirCredencial(unitOfWork, hasher),
    criarPrimeiroAdministrador: new CriarPrimeiroAdministrador(
      unitOfWork,
      geradorId,
      hasher,
    ),
    instalacaoPrecisaConfiguracao: new InstalacaoPrecisaConfiguracao(unitOfWork),

    abrirCaixa: new AbrirCaixa(unitOfWork, relogio, geradorId),
    registrarSangria: new RegistrarSangria(unitOfWork, relogio, geradorId, autorizar),
    registrarSuprimento: new RegistrarSuprimento(unitOfWork, relogio, geradorId),
    fecharCaixa:
      copias === undefined ? fecharCaixa : fechamentoComCopia(fecharCaixa, copias.agenda),
    iniciarVenda: new IniciarVenda(unitOfWork, relogio, geradorId),
    adicionarItem: new AdicionarItemPorCodigo(unitOfWork, geradorId, relogio, autorizar),
    registrarPagamento: new RegistrarPagamento(
      unitOfWork,
      geradorId,
      relogio,
      autorizar,
      {
        // Ligado só no banco de treinamento (ADR-0026). Na operação real, um
        // pagamento "simulado" seria dinheiro que nunca entrou.
        permiteSimulacao: modo === "TREINAMENTO",
      },
    ),
    finalizarVenda: new FinalizarVenda(unitOfWork, relogio, geradorId),
    alterarQuantidadeItem: new AlterarQuantidadeItem(
      unitOfWork,
      geradorId,
      relogio,
      autorizar,
    ),
    removerItem: new RemoverItem(unitOfWork, geradorId, relogio, autorizar),
    removerPagamento: new RemoverPagamento(unitOfWork, geradorId, relogio),
    aplicarDesconto: new AplicarDesconto(unitOfWork, geradorId, relogio, autorizar),
    identificarCliente: new IdentificarCliente(unitOfWork),
    suspenderVenda: new SuspenderVenda(unitOfWork, relogio),
    retomarVenda: new RetomarVenda(unitOfWork),
    cancelarVenda: new CancelarVenda(unitOfWork, geradorId, relogio, autorizar),
    registrarDevolucao: new RegistrarDevolucao(unitOfWork, geradorId, relogio, autorizar),

    obterConfiguracao: new ObterConfiguracaoLoja(leitura.configuracao, geradorId),
    definirConfiguracao: new DefinirConfiguracaoLoja(unitOfWork, geradorId, relogio),
    guardarImagem: new GuardarImagem(unitOfWork, geradorId, resumoSha256),

    registrarMovimento: new RegistrarMovimento(unitOfWork, relogio, geradorId),

    lancarNotaDeCompra: new LancarNotaDeCompra(unitOfWork, relogio, geradorId),
    cancelarNotaDeCompra: new CancelarNotaDeCompra(unitOfWork, relogio, geradorId),

    cadastrarProduto: new CadastrarProduto(unitOfWork, geradorId),
    alterarProduto: new AlterarProduto(unitOfWork, relogio, geradorId),
    alterarPrecoDoProduto: new AlterarPrecoDoProduto(unitOfWork, relogio, geradorId),

    cadastrarCategoria: new CadastrarCategoria(unitOfWork, geradorId),
    alterarCategoria: new AlterarCategoria(unitOfWork),
    cadastrarCliente: new CadastrarCliente(unitOfWork, geradorId),
    alterarCliente: new AlterarCliente(unitOfWork),
    cadastrarFornecedor: new CadastrarFornecedor(unitOfWork, geradorId),
    alterarFornecedor: new AlterarFornecedor(unitOfWork),
    definirEmpresa: new DefinirEmpresa(unitOfWork, geradorId),

    lancarTitulo: new LancarTitulo(unitOfWork, relogio, geradorId),
    registrarRecebimento: new RegistrarRecebimento(unitOfWork, relogio, geradorId),
    estornarRecebimento: new EstornarRecebimento(unitOfWork, relogio, geradorId),
    adiarVencimento: new AdiarVencimento(unitOfWork),
    cancelarTitulo: new CancelarTitulo(unitOfWork, relogio),

    async encerrar(): Promise<void> {
      await prisma.$disconnect();
    },
  };
}

function montarCopias(
  ambiente: Ambiente,
  urlBanco: string,
  unitOfWork: UnitOfWork,
  relogio: Relogio,
  geradorId: GeradorId,
  manutencao: ManutencaoDoServidor,
  opcoes: OpcoesDoContainer,
): CopiasDoServidor {
  const pasta = ambiente.PASTA_COPIAS;
  const ferramenta =
    opcoes.copias?.ferramenta ??
    new FerramentaPostgres({
      urlBanco,
      pastaBinarios:
        ambiente.PASTA_BINARIOS_POSTGRES === ""
          ? undefined
          : ambiente.PASTA_BINARIOS_POSTGRES,
      pastaDeTrabalho: join(pasta, ".em-andamento"),
    });
  const pastaDeCopias = opcoes.copias?.pasta ?? new PastaDeCopiasNoDisco(pasta);
  // Uma trava para todas as operações: cópia, conferência e restauração
  // disputam o mesmo banco e a mesma pasta.
  const trava = new TravaDeCopias();

  const fazer = new FazerCopiaDeSeguranca(
    ferramenta,
    pastaDeCopias,
    trava,
    unitOfWork,
    geradorId,
    relogio,
  );
  const conferir = new ConferirCopiaDeSeguranca(ferramenta, pastaDeCopias, trava);

  return {
    pasta,
    fazer,
    conferir,
    restaurar: new RestaurarCopiaDeSeguranca(
      conferir,
      fazer,
      ferramenta,
      manutencao,
      trava,
      unitOfWork,
      geradorId,
      relogio,
    ),
    consultar: new ConsultarCopiasDeSeguranca(pastaDeCopias, trava, unitOfWork),
    definirAgenda: new DefinirConfiguracaoDeBackup(unitOfWork, geradorId, relogio),
    agenda: new AgendaDeCopias(fazer, pastaDeCopias, trava, unitOfWork, relogio),
  };
}

/**
 * O fechamento de caixa que pede a cópia do dia ao terminar.
 *
 * Pede e não espera: o operador não fica olhando o `pg_dump` para ir embora, e
 * a cópia que falhar não desfaz um fechamento que deu certo.
 */
function fechamentoComCopia(
  fechar: FecharCaixa,
  agenda: AgendaDeCopias,
): Pick<FecharCaixa, "executar"> {
  return {
    async executar(entrada) {
      const resultado = await fechar.executar(entrada);
      if (resultado.isOk()) void agenda.pedirCopiaDoFechamento();
      return resultado;
    },
  };
}

/** SHA-256 do conteúdo, em hexadecimal — a chave de deduplicação das imagens. */
const resumoSha256 = {
  sha256: (conteudo: Uint8Array): string =>
    createHash("sha256").update(conteudo).digest("hex"),
};

/** Identificador de dispositivo, quando o cliente não informou um. */
export function novoDispositivoId(): string {
  return randomUUID();
}
