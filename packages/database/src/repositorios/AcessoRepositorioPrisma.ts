import type {
  PapelRepository,
  SessaoAcessoRepository,
  UsuarioRepository,
} from "@erp/application";
import type { Identificador, Matricula, Papel, SessaoAcesso, Usuario } from "@erp/domain";

import type { Prisma, PrismaClient } from "../gerado/index.js";
import {
  estacoesParaLinhas,
  papelParaDominio,
  papelParaLinha,
  permissoesParaLinhas,
  sessaoParaDominio,
  sessaoParaLinha,
  usuarioParaDominio,
  usuarioParaLinha,
} from "../mapeadores/identidadeMapeador.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

const INCLUIR_PAPEL = { permissoes: true } as const;
const INCLUIR_USUARIO = {
  papel: { include: INCLUIR_PAPEL },
  estacoes: true,
} as const;

export class PapelRepositorioPrisma implements PapelRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Papel | undefined> {
    const linha = await this.prisma.papel.findUnique({
      where: { id: id.valor },
      include: INCLUIR_PAPEL,
    });

    return linha === null ? undefined : papelParaDominio(linha);
  }

  async porCodigo(codigo: string): Promise<Papel | undefined> {
    const linha = await this.prisma.papel.findUnique({
      where: { codigo: codigo.trim().toUpperCase() },
      include: INCLUIR_PAPEL,
    });

    return linha === null ? undefined : papelParaDominio(linha);
  }

  async todos(): Promise<readonly Papel[]> {
    const linhas = await this.prisma.papel.findMany({
      include: INCLUIR_PAPEL,
      orderBy: { codigo: "asc" },
    });

    return linhas.map(papelParaDominio);
  }

  async salvar(papel: Papel): Promise<void> {
    const linha = papelParaLinha(papel);

    await this.prisma.papel.upsert({
      where: { id: linha.id },
      create: linha,
      update: linha,
    });

    // Regravação completa da coleção, como nas demais tabelas filhas: são
    // dezenas de permissões, não milhares, e o cálculo de diferença é onde
    // este tipo de código erra.
    await this.prisma.permissaoPapel.deleteMany({ where: { papelId: linha.id } });

    const permissoes = permissoesParaLinhas(papel);
    if (permissoes.length > 0) {
      await this.prisma.permissaoPapel.createMany({ data: permissoes });
    }
  }
}

export class UsuarioRepositorioPrisma implements UsuarioRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<Usuario | undefined> {
    const linha = await this.prisma.usuario.findUnique({
      where: { id: id.valor },
      include: INCLUIR_USUARIO,
    });

    return linha === null ? undefined : usuarioParaDominio(linha);
  }

  /**
   * Busca pela matrícula digitada no balcão.
   *
   * Igualdade em coluna única e indexada: é o caminho do login, e o operador
   * está com fila esperando.
   */
  async porMatricula(matricula: Matricula): Promise<Usuario | undefined> {
    const linha = await this.prisma.usuario.findUnique({
      where: { matricula: matricula.valor },
      include: INCLUIR_USUARIO,
    });

    return linha === null ? undefined : usuarioParaDominio(linha);
  }

  /**
   * Todos os usuários, para a tela de gestão.
   *
   * Sem paginação de propósito: uma loja tem dezenas de funcionários, não
   * milhares, e paginar uma lista de vinte linhas é complexidade que só serve
   * para o desenvolvedor.
   */
  async listar(): Promise<readonly Usuario[]> {
    const linhas = await this.prisma.usuario.findMany({
      include: INCLUIR_USUARIO,
      orderBy: { nome: "asc" },
    });

    return linhas.map((linha) => usuarioParaDominio(linha));
  }

  async quantidade(): Promise<number> {
    return this.prisma.usuario.count();
  }

  async salvar(usuario: Usuario): Promise<void> {
    const linha = usuarioParaLinha(usuario);

    await this.prisma.usuario.upsert({
      where: { id: linha.id },
      create: linha,
      update: linha,
    });

    await this.prisma.estacaoPermitida.deleteMany({ where: { usuarioId: linha.id } });

    const estacoes = estacoesParaLinhas(usuario);
    if (estacoes.length > 0) {
      await this.prisma.estacaoPermitida.createMany({ data: estacoes });
    }
  }
}

export class SessaoAcessoRepositorioPrisma implements SessaoAcessoRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async porId(id: Identificador): Promise<SessaoAcesso | undefined> {
    const linha = await this.prisma.sessaoAcesso.findUnique({ where: { id: id.valor } });

    return linha === null ? undefined : sessaoParaDominio(linha);
  }

  async salvar(sessao: SessaoAcesso): Promise<void> {
    const linha = sessaoParaLinha(sessao);

    await this.prisma.sessaoAcesso.upsert({
      where: { id: linha.id },
      create: linha,
      update: linha,
    });
  }

  /**
   * Revoga a família inteira num único `UPDATE`.
   *
   * Precisa ser uma operação só: revogar uma a uma deixaria uma janela — de
   * milissegundos, mas real — em que o ladrão ainda renovaria a sessão dele.
   */
  async revogarFamilia(familiaId: Identificador, agora: Date): Promise<void> {
    await this.prisma.sessaoAcesso.updateMany({
      where: { familiaId: familiaId.valor, revogadaEm: null },
      data: { revogadaEm: agora },
    });
  }

  async revogarDoUsuario(usuarioId: Identificador, agora: Date): Promise<void> {
    await this.prisma.sessaoAcesso.updateMany({
      where: { usuarioId: usuarioId.valor, revogadaEm: null },
      data: { revogadaEm: agora },
    });
  }
}
