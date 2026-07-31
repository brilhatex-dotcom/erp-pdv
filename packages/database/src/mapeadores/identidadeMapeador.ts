import {
  CredencialHash,
  type DadosPapel,
  Matricula,
  Papel,
  type Permissao,
  SessaoAcesso,
  Usuario,
} from "@erp/domain";

import type {
  EstacaoPermitida as EstacaoLinha,
  Papel as PapelLinha,
  PermissaoPapel as PermissaoLinha,
  SessaoAcesso as SessaoLinha,
  Usuario as UsuarioLinha,
} from "../gerado/index.js";
import { ouNulo, paraDinheiro, paraId } from "./comuns.js";

export type PapelCompleto = PapelLinha & {
  readonly permissoes: readonly PermissaoLinha[];
};

export type UsuarioCompleto = UsuarioLinha & {
  readonly papel: PapelCompleto;
  readonly estacoes: readonly EstacaoLinha[];
};

// ── Papel ─────────────────────────────────────────────────────────────────

export function papelParaDominio(linha: PapelCompleto): Papel {
  return Papel.reconstituir({
    id: paraId(linha.id),
    codigo: linha.codigo,
    nome: linha.nome,
    // Já validadas quando foram gravadas; reconstituição não revalida.
    permissoes: linha.permissoes.map((atual) => atual.permissao as Permissao),
    limites: {
      descontoMaximoItemBps: linha.descontoMaximoItemBps ?? undefined,
      descontoMaximoVendaBps: linha.descontoMaximoVendaBps ?? undefined,
      valorMaximoSangria:
        linha.valorMaximoSangria === null
          ? undefined
          : paraDinheiro(linha.valorMaximoSangria),
      minutosParaCancelarVenda: linha.minutosParaCancelarVenda ?? undefined,
      estornoMaximoEmDinheiro:
        linha.estornoMaximoEmDinheiro === null
          ? undefined
          : paraDinheiro(linha.estornoMaximoEmDinheiro),
    },
    padrao: linha.padrao,
  } satisfies DadosPapel);
}

export function papelParaLinha(papel: Papel): PapelLinha {
  const { limites } = papel;

  return {
    id: papel.id.valor,
    codigo: papel.codigo,
    nome: papel.nome,
    padrao: papel.ehPadrao,
    descontoMaximoItemBps: ouNulo(limites.descontoMaximoItemBps),
    descontoMaximoVendaBps: ouNulo(limites.descontoMaximoVendaBps),
    valorMaximoSangria: ouNulo(limites.valorMaximoSangria?.centavos),
    minutosParaCancelarVenda: ouNulo(limites.minutosParaCancelarVenda),
    estornoMaximoEmDinheiro: ouNulo(limites.estornoMaximoEmDinheiro?.centavos),
  };
}

export function permissoesParaLinhas(papel: Papel): PermissaoLinha[] {
  return [...papel.permissoes].map((permissao) => ({
    papelId: papel.id.valor,
    permissao,
  }));
}

// ── Usuário ───────────────────────────────────────────────────────────────

export function usuarioParaDominio(linha: UsuarioCompleto): Usuario {
  return Usuario.reconstituir({
    id: paraId(linha.id),
    // Já normalizada quando foi gravada.
    matricula: Matricula.criar(linha.matricula).unwrap(),
    nome: linha.nome,
    papel: papelParaDominio(linha.papel),
    hashPin: montarHash(linha.hashPin, linha.algoritmoPin),
    hashSenha: montarHash(linha.hashSenha, linha.algoritmoSenha),
    precisaTrocarCredencial: linha.precisaTrocarCredencial,
    ativo: linha.ativo,
    estacoesPermitidas: linha.estacoes.map((estacao) => paraId(estacao.estacaoId)),
    tentativasFalhas: linha.tentativasFalhas,
    bloqueadoAte: linha.bloqueadoAte ?? undefined,
    bloqueiosConsecutivos: linha.bloqueiosConsecutivos,
    ultimoAcessoEm: linha.ultimoAcessoEm ?? undefined,
  });
}

export function usuarioParaLinha(
  usuario: Usuario,
): Omit<UsuarioLinha, "criadoEm" | "atualizadoEm"> {
  return {
    id: usuario.id.valor,
    matricula: usuario.matricula.valor,
    nome: usuario.nome,
    papelId: usuario.papel.id.valor,
    hashPin: ouNulo(usuario.hashPin?.valor),
    algoritmoPin: ouNulo(usuario.hashPin?.algoritmo),
    hashSenha: ouNulo(usuario.hashSenha?.valor),
    algoritmoSenha: ouNulo(usuario.hashSenha?.algoritmo),
    precisaTrocarCredencial: usuario.precisaTrocarCredencial,
    ativo: usuario.ativo,
    tentativasFalhas: usuario.tentativasFalhas,
    bloqueadoAte: ouNulo(usuario.bloqueadoAte),
    bloqueiosConsecutivos: usuario.bloqueiosConsecutivos,
    ultimoAcessoEm: ouNulo(usuario.ultimoAcessoEm),
  };
}

export function estacoesParaLinhas(usuario: Usuario): EstacaoLinha[] {
  return usuario.estacoesPermitidas.map((estacaoId) => ({
    usuarioId: usuario.id.valor,
    estacaoId: estacaoId.valor,
  }));
}

// ── Sessão de acesso ──────────────────────────────────────────────────────

export function sessaoParaDominio(linha: SessaoLinha): SessaoAcesso {
  return SessaoAcesso.reconstituir({
    id: paraId(linha.id),
    usuarioId: paraId(linha.usuarioId),
    familiaId: paraId(linha.familiaId),
    dispositivoId: paraId(linha.dispositivoId),
    contexto: linha.contexto,
    hashRefresh: CredencialHash.criar(linha.hashRefresh, linha.algoritmoRefresh).unwrap(),
    criadaEm: linha.criadaEm,
    expiraEm: linha.expiraEm,
    revogadaEm: linha.revogadaEm ?? undefined,
    usadaEm: linha.usadaEm ?? undefined,
    sucessoraId: linha.sucessoraId === null ? undefined : paraId(linha.sucessoraId),
  });
}

export function sessaoParaLinha(sessao: SessaoAcesso): SessaoLinha {
  return {
    id: sessao.id.valor,
    usuarioId: sessao.usuarioId.valor,
    familiaId: sessao.familiaId.valor,
    dispositivoId: sessao.dispositivoId.valor,
    contexto: sessao.contexto,
    hashRefresh: sessao.hashRefresh.valor,
    algoritmoRefresh: sessao.hashRefresh.algoritmo,
    criadaEm: sessao.criadaEm,
    expiraEm: sessao.expiraEm,
    revogadaEm: ouNulo(sessao.revogadaEm),
    usadaEm: ouNulo(sessao.usadaEm),
    sucessoraId: ouNulo(sessao.sucessoraId?.valor),
  };
}

/**
 * Monta o hash quando as duas colunas existem.
 *
 * Valor e algoritmo andam juntos: um sem o outro é linha corrompida, e tratar
 * como "sem credencial" esconderia o defeito em vez de expô-lo.
 */
function montarHash(
  valor: string | null,
  algoritmo: string | null,
): CredencialHash | undefined {
  if (valor === null || algoritmo === null) return undefined;

  const hash = CredencialHash.criar(valor, algoritmo);

  if (hash.isErr()) {
    throw new Error(`Credencial inválida no banco: algoritmo ${algoritmo}`);
  }

  return hash.unwrap();
}
