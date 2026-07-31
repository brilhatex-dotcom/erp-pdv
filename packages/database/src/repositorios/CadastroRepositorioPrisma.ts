import type {
  CategoriaRepository,
  ClienteRepository,
  FiltroBusca,
  FornecedorRepository,
} from "@erp/application";
import {
  Categoria,
  Cliente,
  Dinheiro,
  Documento,
  Fornecedor,
  type Identificador,
} from "@erp/domain";
import { normalizarParaBusca } from "@erp/utils";

import {
  documentoDeColuna,
  emailDeColuna,
  enderecoDeColunas,
  enderecoParaColunas,
  inscricaoDeColuna,
  telefoneDeColuna,
} from "../mapeadores/cadastroMapeador.js";
import { paraId } from "../mapeadores/comuns.js";
import type { Prisma, PrismaClient } from "../gerado/index.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

/**
 * Teto absoluto de linhas devolvidas pela busca.
 *
 * A porta já exige `limite`, mas ela é chamada por código que pode errar. Este
 * teto é a rede: nenhuma consulta da retaguarda devolve mais que isto, nem se
 * alguém pedir. Uma lista de vinte itens não precisa de dez mil linhas
 * atravessando a rede da loja.
 */
const TETO_BUSCA = 200;

function limitar(limite: number): number {
  return Math.min(Math.max(limite, 1), TETO_BUSCA);
}

// ── Categoria ────────────────────────────────────────────────────────────

export class CategoriaRepositorioPrisma implements CategoriaRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Categoria | undefined> {
    const linha = await this.prisma.categoria.findUnique({ where: { id: id.valor } });
    return linha === null ? undefined : paraCategoria(linha);
  }

  /**
   * Busca pelo nome **normalizado**.
   *
   * É o que impede "Bebidas" e "bebidas " de coexistirem — na tela parecem a
   * mesma coisa, e no relatório dividem o faturamento em duas linhas que
   * ninguém consegue somar depois.
   */
  async porNome(nome: string): Promise<Categoria | undefined> {
    const linha = await this.prisma.categoria.findUnique({
      where: { nomeBusca: normalizarParaBusca(nome) },
    });

    return linha === null ? undefined : paraCategoria(linha);
  }

  async listar(apenasAtivas: boolean): Promise<readonly Categoria[]> {
    const linhas = await this.prisma.categoria.findMany({
      where: apenasAtivas ? { ativa: true } : {},
      orderBy: { nomeBusca: "asc" },
    });

    return linhas.map(paraCategoria);
  }

  async salvar(categoria: Categoria): Promise<void> {
    const dados = {
      nome: categoria.nome,
      nomeBusca: categoria.nomeBusca,
      ativa: categoria.ativa,
    };

    await this.prisma.categoria.upsert({
      where: { id: categoria.id.valor },
      create: { id: categoria.id.valor, ...dados },
      update: dados,
    });
  }
}

function paraCategoria(linha: { id: string; nome: string; ativa: boolean }): Categoria {
  return Categoria.reconstituir({
    id: paraId(linha.id),
    nome: linha.nome,
    ativa: linha.ativa,
  });
}

// ── Cliente ──────────────────────────────────────────────────────────────

export class ClienteRepositorioPrisma implements ClienteRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Cliente | undefined> {
    const linha = await this.prisma.cliente.findUnique({ where: { id: id.valor } });
    return linha === null ? undefined : paraCliente(linha);
  }

  /**
   * Existe para impedir o defeito clássico do módulo: o mesmo CPF cadastrado
   * duas vezes. O atendente não acha o cliente, cadastra de novo, e o histórico
   * de compra passa a estar dividido entre dois registros.
   */
  async porDocumento(documento: Documento): Promise<Cliente | undefined> {
    const linha = await this.prisma.cliente.findUnique({
      where: { documento: documento.valor },
    });

    return linha === null ? undefined : paraCliente(linha);
  }

  async buscar(filtro: FiltroBusca): Promise<readonly Cliente[]> {
    const termo = normalizarParaBusca(filtro.termo ?? "");

    const linhas = await this.prisma.cliente.findMany({
      where: {
        ...(filtro.apenasAtivos === true ? { ativo: true } : {}),
        // Prefixo, não `contains`: `LIKE 'ana%'` usa o índice; `LIKE '%ana%'`
        // varre a tabela inteira a cada tecla digitada.
        ...(termo === "" ? {} : { nomeBusca: { startsWith: termo } }),
      },
      orderBy: { nomeBusca: "asc" },
      take: limitar(filtro.limite),
    });

    return linhas.map(paraCliente);
  }

  async salvar(cliente: Cliente): Promise<void> {
    const dados = {
      nome: cliente.nome,
      apelido: cliente.apelido ?? null,
      nomeBusca: cliente.nomeBusca,
      tipoPessoa: cliente.tipoPessoa,
      documento: cliente.documento?.valor ?? null,
      inscricaoEstadual: cliente.inscricaoEstadual?.valor ?? null,
      telefone: cliente.telefone?.digitos ?? null,
      email: cliente.email?.valor ?? null,
      limiteCredito: cliente.limiteCredito.centavos,
      observacao: cliente.observacao ?? null,
      ativo: cliente.ativo,
      ...enderecoParaColunas(cliente.endereco),
    };

    await this.prisma.cliente.upsert({
      where: { id: cliente.id.valor },
      create: { id: cliente.id.valor, ...dados },
      update: dados,
    });
  }
}

interface LinhaCliente {
  id: string;
  nome: string;
  apelido: string | null;
  tipoPessoa: string;
  documento: string | null;
  inscricaoEstadual: string | null;
  telefone: string | null;
  email: string | null;
  limiteCredito: bigint;
  observacao: string | null;
  ativo: boolean;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigoMunicipioIbge: string | null;
  uf: string | null;
  cep: string | null;
}

function paraCliente(linha: LinhaCliente): Cliente {
  return Cliente.reconstituir({
    id: paraId(linha.id),
    nome: linha.nome,
    apelido: linha.apelido ?? undefined,
    tipoPessoa: linha.tipoPessoa === "JURIDICA" ? "JURIDICA" : "FISICA",
    documento: documentoDeColuna(linha.documento),
    inscricaoEstadual: inscricaoDeColuna(linha.inscricaoEstadual),
    telefone: telefoneDeColuna(linha.telefone),
    email: emailDeColuna(linha.email),
    endereco: enderecoDeColunas(linha),
    limiteCredito: Dinheiro.deCentavos(linha.limiteCredito).unwrap(),
    observacao: linha.observacao ?? undefined,
    ativo: linha.ativo,
  });
}

// ── Fornecedor ───────────────────────────────────────────────────────────

export class FornecedorRepositorioPrisma implements FornecedorRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Fornecedor | undefined> {
    const linha = await this.prisma.fornecedor.findUnique({ where: { id: id.valor } });
    return linha === null ? undefined : paraFornecedor(linha);
  }

  async porDocumento(documento: Documento): Promise<Fornecedor | undefined> {
    const linha = await this.prisma.fornecedor.findUnique({
      where: { documento: documento.valor },
    });

    return linha === null ? undefined : paraFornecedor(linha);
  }

  async buscar(filtro: FiltroBusca): Promise<readonly Fornecedor[]> {
    const termo = normalizarParaBusca(filtro.termo ?? "");

    const linhas = await this.prisma.fornecedor.findMany({
      where: {
        ...(filtro.apenasAtivos === true ? { ativo: true } : {}),
        ...(termo === "" ? {} : { razaoSocialBusca: { startsWith: termo } }),
      },
      orderBy: { razaoSocialBusca: "asc" },
      take: limitar(filtro.limite),
    });

    return linhas.map(paraFornecedor);
  }

  async salvar(fornecedor: Fornecedor): Promise<void> {
    const dados = {
      razaoSocial: fornecedor.razaoSocial,
      nomeFantasia: fornecedor.nomeFantasia ?? null,
      razaoSocialBusca: fornecedor.razaoSocialBusca,
      documento: fornecedor.documento.valor,
      inscricaoEstadual: fornecedor.inscricaoEstadual?.valor ?? null,
      telefone: fornecedor.telefone?.digitos ?? null,
      email: fornecedor.email?.valor ?? null,
      prazoEntregaDias: fornecedor.prazoEntregaDias ?? null,
      observacao: fornecedor.observacao ?? null,
      ativo: fornecedor.ativo,
      ...enderecoParaColunas(fornecedor.endereco),
    };

    await this.prisma.fornecedor.upsert({
      where: { id: fornecedor.id.valor },
      create: { id: fornecedor.id.valor, ...dados },
      update: dados,
    });
  }
}

interface LinhaFornecedor {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  documento: string;
  inscricaoEstadual: string | null;
  telefone: string | null;
  email: string | null;
  prazoEntregaDias: number | null;
  observacao: string | null;
  ativo: boolean;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigoMunicipioIbge: string | null;
  uf: string | null;
  cep: string | null;
}

function paraFornecedor(linha: LinhaFornecedor): Fornecedor {
  return Fornecedor.reconstituir({
    id: paraId(linha.id),
    razaoSocial: linha.razaoSocial,
    nomeFantasia: linha.nomeFantasia ?? undefined,
    documento: Documento.criar(linha.documento).unwrap(),
    inscricaoEstadual: inscricaoDeColuna(linha.inscricaoEstadual),
    telefone: telefoneDeColuna(linha.telefone),
    email: emailDeColuna(linha.email),
    endereco: enderecoDeColunas(linha),
    prazoEntregaDias: linha.prazoEntregaDias ?? undefined,
    observacao: linha.observacao ?? undefined,
    ativo: linha.ativo,
  });
}
