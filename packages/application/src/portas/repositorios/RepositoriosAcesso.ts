import type { Identificador, Matricula, Papel, SessaoAcesso, Usuario } from "@erp/domain";

export interface UsuarioRepository {
  porId(id: Identificador): Promise<Usuario | undefined>;
  /** Busca pela matrícula digitada no balcão. */
  porMatricula(matricula: Matricula): Promise<Usuario | undefined>;
  salvar(usuario: Usuario): Promise<void>;
}

export interface PapelRepository {
  porId(id: Identificador): Promise<Papel | undefined>;
  porCodigo(codigo: string): Promise<Papel | undefined>;
  todos(): Promise<readonly Papel[]>;
  salvar(papel: Papel): Promise<void>;
}

export interface SessaoAcessoRepository {
  porId(id: Identificador): Promise<SessaoAcesso | undefined>;
  salvar(sessao: SessaoAcesso): Promise<void>;

  /**
   * Revoga **todas** as sessões de uma família de uma vez.
   *
   * É a resposta ao reúso de refresh token, e precisa ser uma operação só:
   * revogar uma a uma deixaria uma janela em que o ladrão ainda renova.
   */
  revogarFamilia(familiaId: Identificador, agora: Date): Promise<void>;

  /** Encerra tudo de um usuário — troca de senha, demissão, suspeita. */
  revogarDoUsuario(usuarioId: Identificador, agora: Date): Promise<void>;
}
