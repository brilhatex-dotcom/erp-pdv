import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";

import type { CredencialHash } from "./CredencialHash.js";
import { credencialBloqueada, tentativaRecusada } from "./eventos.js";
import type { Matricula } from "./Matricula.js";
import type { Papel } from "./Papel.js";
import type { Permissao } from "./Permissao.js";

export type ErroUsuario = ErroValidacao | ErroRegraNegocio;

/** Tentativas erradas toleradas antes do primeiro bloqueio. */
export const TENTATIVAS_ATE_BLOQUEIO = 5;
/** Duração do primeiro bloqueio, em minutos. Dobra a cada reincidência. */
export const MINUTOS_PRIMEIRO_BLOQUEIO = 15;
/** Teto do bloqueio. Acima disso vira negação de serviço contra a própria loja. */
export const MINUTOS_BLOQUEIO_MAXIMO = 60;

export interface DadosUsuario {
  readonly id: Identificador;
  readonly matricula: Matricula;
  readonly nome: string;
  readonly papel: Papel;
  /** Hash do PIN, para o balcão. Ausente em quem não opera caixa. */
  readonly hashPin?: CredencialHash | undefined;
  /** Hash da senha, para a retaguarda. Ausente em quem só opera o PDV. */
  readonly hashSenha?: CredencialHash | undefined;
  /**
   * Obriga a troca no próximo acesso.
   *
   * Nasce `true` em todo usuário novo: **nunca existe senha padrão de fábrica**
   * (ARQUITETURA.md §8.3), e uma credencial que o administrador digitou é uma
   * credencial que o administrador conhece.
   */
  readonly precisaTrocarCredencial?: boolean | undefined;
  readonly ativo?: boolean | undefined;
  /**
   * Estações em que pode operar. Vazio significa **todas** — que é o caso da
   * imensa maioria das lojas de 1 a 3 computadores.
   */
  readonly estacoesPermitidas?: readonly Identificador[] | undefined;
}

/** Estado completo vindo do banco. */
export interface DadosReconstituicaoUsuario extends DadosUsuario {
  readonly tentativasFalhas: number;
  readonly bloqueadoAte: Date | undefined;
  readonly bloqueiosConsecutivos: number;
  readonly ultimoAcessoEm: Date | undefined;
}

/**
 * Usuário — quem opera o sistema.
 *
 * Guarda **hashes**, nunca credenciais em claro, e não sabe compará-los: a
 * conferência é feita pela porta que conhece o Argon2id, e o resultado é
 * informado ao agregado. Essa inversão é o que mantém o domínio sem
 * dependência de runtime (princípio 2) — e, de quebra, torna testável a parte
 * que realmente tem regra: o bloqueio progressivo.
 *
 * ### O bloqueio protege a loja dos dois lados
 *
 * Sem bloqueio, seis dígitos caem em minutos para quem tem acesso ao teclado.
 * Com bloqueio eterno, um cliente mal-intencionado — ou um colega em disputa —
 * derruba o caixa da loja errando PIN de propósito. Por isso ele **escala e tem
 * teto**: 15, 30, 60 minutos, e para de crescer.
 */
export class Usuario extends AggregateRoot {
  readonly #matricula: Matricula;
  #nome: string;
  #papel: Papel;
  #hashPin: CredencialHash | undefined;
  #hashSenha: CredencialHash | undefined;
  #precisaTrocarCredencial: boolean;
  #ativo: boolean;
  readonly #estacoesPermitidas: readonly Identificador[];
  #tentativasFalhas = 0;
  #bloqueadoAte: Date | undefined;
  #bloqueiosConsecutivos = 0;
  #ultimoAcessoEm: Date | undefined;

  private constructor(dados: DadosUsuario, nome: string) {
    super(dados.id);
    this.#matricula = dados.matricula;
    this.#nome = nome;
    this.#papel = dados.papel;
    this.#hashPin = dados.hashPin;
    this.#hashSenha = dados.hashSenha;
    this.#precisaTrocarCredencial = dados.precisaTrocarCredencial ?? true;
    this.#ativo = dados.ativo ?? true;
    this.#estacoesPermitidas = [...(dados.estacoesPermitidas ?? [])];
  }

  // ── Construção ─────────────────────────────────────────────────────────

  static criar(dados: DadosUsuario): Result<Usuario, ErroValidacao[]> {
    const erros: ErroValidacao[] = [];

    const nome = dados.nome.trim();
    if (nome === "") {
      erros.push(new ErroValidacao("USUARIO_NOME_VAZIO", "Informe o nome do usuário."));
    }

    // Usuário sem credencial alguma não consegue entrar em lugar nenhum: seria
    // um cadastro que parece pronto e não é, descoberto só no balcão.
    if (dados.hashPin === undefined && dados.hashSenha === undefined) {
      erros.push(
        new ErroValidacao(
          "USUARIO_SEM_CREDENCIAL",
          "Defina um PIN para o caixa ou uma senha para a retaguarda.",
        ),
      );
    }

    if (erros.length > 0) {
      return err(erros);
    }

    return ok(new Usuario(dados, nome));
  }

  /** Uso exclusivo do repositório. Ver `Produto.reconstituir` sobre não revalidar. */
  static reconstituir(dados: DadosReconstituicaoUsuario): Usuario {
    const usuario = new Usuario(dados, dados.nome.trim());

    usuario.#tentativasFalhas = dados.tentativasFalhas;
    usuario.#bloqueadoAte = dados.bloqueadoAte;
    usuario.#bloqueiosConsecutivos = dados.bloqueiosConsecutivos;
    usuario.#ultimoAcessoEm = dados.ultimoAcessoEm;

    return usuario;
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get matricula(): Matricula {
    return this.#matricula;
  }

  get nome(): string {
    return this.#nome;
  }

  get papel(): Papel {
    return this.#papel;
  }

  get hashPin(): CredencialHash | undefined {
    return this.#hashPin;
  }

  get hashSenha(): CredencialHash | undefined {
    return this.#hashSenha;
  }

  get precisaTrocarCredencial(): boolean {
    return this.#precisaTrocarCredencial;
  }

  get ativo(): boolean {
    return this.#ativo;
  }

  get estacoesPermitidas(): readonly Identificador[] {
    return this.#estacoesPermitidas;
  }

  get tentativasFalhas(): number {
    return this.#tentativasFalhas;
  }

  get bloqueadoAte(): Date | undefined {
    return this.#bloqueadoAte;
  }

  get bloqueiosConsecutivos(): number {
    return this.#bloqueiosConsecutivos;
  }

  get ultimoAcessoEm(): Date | undefined {
    return this.#ultimoAcessoEm;
  }

  /** Concede a permissão pelo papel. Nega por padrão. */
  temPermissao(permissao: Permissao): boolean {
    return this.#papel.concede(permissao);
  }

  podeOperarEstacao(estacaoId: Identificador): boolean {
    if (this.#estacoesPermitidas.length === 0) return true;
    return this.#estacoesPermitidas.some((atual) => atual.equals(estacaoId));
  }

  estaBloqueado(agora: Date): boolean {
    return this.#bloqueadoAte !== undefined && this.#bloqueadoAte > agora;
  }

  // ── Acesso ─────────────────────────────────────────────────────────────

  /**
   * Verifica se o usuário **pode tentar** se autenticar agora.
   *
   * Chamado **antes** de conferir a credencial: conferir hash de quem está
   * bloqueado gastaria o custo do Argon2id — deliberadamente alto — e abriria
   * um canal de tempo que responde se a conta existe.
   */
  podeTentarAcesso(agora: Date): Result<void, ErroRegraNegocio> {
    if (!this.#ativo) {
      return err(
        new ErroRegraNegocio(
          "USUARIO_INATIVO",
          "Este usuário não tem mais acesso. Procure o responsável.",
          { usuarioId: this.id.valor },
        ),
      );
    }

    if (this.estaBloqueado(agora)) {
      const minutos = this.#minutosRestantes(agora);
      return err(
        new ErroRegraNegocio(
          "USUARIO_BLOQUEADO",
          `Acesso bloqueado por mais ${String(minutos)} ${minutos === 1 ? "minuto" : "minutos"}. Chame o supervisor.`,
          { usuarioId: this.id.valor, bloqueadoAte: this.#bloqueadoAte?.toISOString() },
        ),
      );
    }

    return ok(undefined);
  }

  /**
   * Registra que a credencial conferiu.
   *
   * Zera o contador de falhas **e** o de bloqueios consecutivos: quem acertou
   * provou ser o dono da conta, e manter a escalada puniria o operador que
   * errou o PIN duas vezes de manhã e trabalhou o dia inteiro sem problema.
   */
  registrarAcessoBemSucedido(agora: Date): Result<void, ErroRegraNegocio> {
    const permitido = this.podeTentarAcesso(agora);
    if (permitido.isErr()) return permitido;

    this.#tentativasFalhas = 0;
    this.#bloqueiosConsecutivos = 0;
    this.#bloqueadoAte = undefined;
    this.#ultimoAcessoEm = agora;

    return ok(undefined);
  }

  /**
   * Registra que a credencial não conferiu, aplicando o bloqueio quando é hora.
   *
   * O evento vai para a auditoria mesmo quando não houve bloqueio: uma sequência
   * de tentativas espalhadas por várias contas é o padrão que denuncia quem está
   * testando PINs, e cada tentativa isolada pareceria só um dedo errado.
   */
  registrarTentativaFalha(agora: Date): void {
    this.#tentativasFalhas += 1;

    this.registrarEvento(
      tentativaRecusada(this.id, this.#matricula.valor, this.#tentativasFalhas, agora),
    );

    if (this.#tentativasFalhas < TENTATIVAS_ATE_BLOQUEIO) return;

    const minutos = this.#duracaoDoProximoBloqueio();

    this.#bloqueiosConsecutivos += 1;
    this.#bloqueadoAte = new Date(agora.getTime() + minutos * 60_000);
    this.#tentativasFalhas = 0;

    this.registrarEvento(
      credencialBloqueada(
        this.id,
        this.#matricula.valor,
        minutos,
        this.#bloqueadoAte,
        agora,
      ),
    );
  }

  /** Libera o acesso antes da hora. Exige `usuario:editar_permissoes`. */
  desbloquear(): void {
    this.#bloqueadoAte = undefined;
    this.#tentativasFalhas = 0;
    this.#bloqueiosConsecutivos = 0;
  }

  // ── Alterações ─────────────────────────────────────────────────────────

  definirPin(hash: CredencialHash): void {
    this.#hashPin = hash;
    this.#precisaTrocarCredencial = false;
  }

  definirSenha(hash: CredencialHash): void {
    this.#hashSenha = hash;
    this.#precisaTrocarCredencial = false;
  }

  /** Marca a credencial como temporária — o próximo acesso obriga a troca. */
  exigirTrocaDeCredencial(): void {
    this.#precisaTrocarCredencial = true;
  }

  alterarNome(nome: string): Result<void, ErroValidacao> {
    const limpo = nome.trim();

    if (limpo === "") {
      return err(new ErroValidacao("USUARIO_NOME_VAZIO", "Informe o nome do usuário."));
    }

    this.#nome = limpo;
    return ok(undefined);
  }

  alterarPapel(papel: Papel): void {
    this.#papel = papel;
  }

  /**
   * Desativa o usuário.
   *
   * Nunca apaga: as vendas dele continuam existindo, e um histórico que aponta
   * para um usuário inexistente é o que transforma auditoria em adivinhação.
   */
  desativar(): void {
    this.#ativo = false;
  }

  reativar(): void {
    this.#ativo = true;
    this.desbloquear();
  }

  // ── Interno ────────────────────────────────────────────────────────────

  #duracaoDoProximoBloqueio(): number {
    const dobrado = MINUTOS_PRIMEIRO_BLOQUEIO * 2 ** this.#bloqueiosConsecutivos;
    return Math.min(dobrado, MINUTOS_BLOQUEIO_MAXIMO);
  }

  #minutosRestantes(agora: Date): number {
    /* v8 ignore next -- inalcançável: só chamado com bloqueio vigente */
    if (this.#bloqueadoAte === undefined) return 0;
    return Math.ceil((this.#bloqueadoAte.getTime() - agora.getTime()) / 60_000);
  }
}
