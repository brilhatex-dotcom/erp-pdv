import {
  Autenticar,
  AutorizarOperacao,
  type GeradorId,
  type Hasher,
  IniciarVenda,
  AbrirCaixa,
  FecharCaixa,
  RegistrarSangria,
  RegistrarSuprimento,
  AdicionarItemPorCodigo,
  AlterarCategoria,
  AlterarCliente,
  AlterarFornecedor,
  CadastrarCategoria,
  CadastrarCliente,
  CadastrarFornecedor,
  DefinirEmpresa,
  FinalizarVenda,
  RegistrarPagamento,
  RenovarSessao,
  type Relogio,
  type Repositorios,
  type UnitOfWork,
} from "@erp/application";
import {
  criarPrismaClient,
  HasherArgon2,
  montarRepositorios,
  type PrismaClient,
  UnitOfWorkPrisma,
} from "@erp/database";
import {
  BYTES_ALEATORIOS_UUID_V7,
  type Identificador,
  LAYOUT_BALANCA_PADRAO,
  montarUuidV7,
} from "@erp/domain";
import { randomBytes, randomUUID } from "node:crypto";

import type { Ambiente } from "../ambiente.js";

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
export interface Container {
  readonly ambiente: Ambiente;
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

  readonly autenticar: Autenticar;
  readonly renovarSessao: RenovarSessao;
  readonly autorizarOperacao: AutorizarOperacao;

  readonly abrirCaixa: AbrirCaixa;
  readonly registrarSangria: RegistrarSangria;
  readonly registrarSuprimento: RegistrarSuprimento;
  readonly fecharCaixa: FecharCaixa;
  readonly iniciarVenda: IniciarVenda;
  readonly adicionarItem: AdicionarItemPorCodigo;
  readonly registrarPagamento: RegistrarPagamento;
  readonly finalizarVenda: FinalizarVenda;

  readonly cadastrarCategoria: CadastrarCategoria;
  readonly alterarCategoria: AlterarCategoria;
  readonly cadastrarCliente: CadastrarCliente;
  readonly alterarCliente: AlterarCliente;
  readonly cadastrarFornecedor: CadastrarFornecedor;
  readonly alterarFornecedor: AlterarFornecedor;
  readonly definirEmpresa: DefinirEmpresa;

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

export function montarContainer(ambiente: Ambiente): Container {
  const prisma = criarPrismaClient({
    urlBanco: ambiente.DATABASE_URL,
    registrarConsultas: !ambiente.ehProducao,
  });

  const unitOfWork = new UnitOfWorkPrisma(prisma);
  const hasher = new HasherArgon2();
  const relogio = relogioDoSistema;
  const geradorId = geradorUuidV7;
  // Uma instância só: a política de autorização é a mesma para todo caso de uso
  // que precisa dela, e duplicá-la abriria a porta para duas configurarem
  // diferente sem ninguém notar.
  const autorizar = new AutorizarOperacao(relogio, hasher);

  return {
    ambiente,
    prisma,
    unitOfWork,
    leitura: montarRepositorios(prisma),
    relogio,
    geradorId,
    hasher,

    autenticar: new Autenticar(unitOfWork, relogio, geradorId, hasher, gerarRefresh),
    renovarSessao: new RenovarSessao(
      unitOfWork,
      relogio,
      geradorId,
      hasher,
      gerarRefresh,
    ),
    autorizarOperacao: autorizar,

    abrirCaixa: new AbrirCaixa(unitOfWork, relogio, geradorId),
    registrarSangria: new RegistrarSangria(unitOfWork, relogio, geradorId, autorizar),
    registrarSuprimento: new RegistrarSuprimento(unitOfWork, relogio, geradorId),
    fecharCaixa: new FecharCaixa(unitOfWork, relogio),
    iniciarVenda: new IniciarVenda(unitOfWork, relogio, geradorId),
    adicionarItem: new AdicionarItemPorCodigo(unitOfWork, LAYOUT_BALANCA_PADRAO),
    registrarPagamento: new RegistrarPagamento(unitOfWork),
    finalizarVenda: new FinalizarVenda(unitOfWork, relogio, geradorId),

    cadastrarCategoria: new CadastrarCategoria(unitOfWork, geradorId),
    alterarCategoria: new AlterarCategoria(unitOfWork),
    cadastrarCliente: new CadastrarCliente(unitOfWork, geradorId),
    alterarCliente: new AlterarCliente(unitOfWork),
    cadastrarFornecedor: new CadastrarFornecedor(unitOfWork, geradorId),
    alterarFornecedor: new AlterarFornecedor(unitOfWork),
    definirEmpresa: new DefinirEmpresa(unitOfWork, geradorId),

    async encerrar(): Promise<void> {
      await prisma.$disconnect();
    },
  };
}

/** Identificador de dispositivo, quando o cliente não informou um. */
export function novoDispositivoId(): string {
  return randomUUID();
}
