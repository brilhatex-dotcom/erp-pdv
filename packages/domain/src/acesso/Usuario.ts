import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio, ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";

import {
  acessoAutorizado,
  acessoRecusado,
  type MeioDeAcesso,
  usuarioBloqueado,
} from "./eventos.js";
import type { HashCredencial } from "./HashCredencial.js";
import {
  ILIMITADO,
  type LimiteDinheiro,
  type LimiteMinutos,
  LimitesPapel,
} from "./LimitesPapel.js";
import type { Matricula } from "./Matricula.js";
import type { Papel } from "./Papel.js";
import type { Permissao } from "./Permissao.js";

/**
 * Usuário — quem opera o sistema, e com qual alçada.
 *
 * Duas credenciais separadas, e não uma: PIN para o balcão, senha para a
 * retaguarda (ADR-0011). A mesma pessoa pode ter as duas, uma só, ou nenhuma
 * enquanto o cadastro não é concluído. Unificar em uma credencial obrigaria a
 * escolher entre "rápido no balcão" e "forte no escritório", e qualquer das duas
 * escolhas quebra um dos dois contextos.
 *
 * O agregado **não verifica credencial** — comparar hash é infraestrutura. O que
 * ele decide é o que depende de regra: se a conta está apta a entrar, o que
 * acontece depois de uma falha, quando o bloqueio expira e qual a alçada de quem
 * entrou.
 */

/** Falhas seguidas que disparam bloqueio (ARQUITETURA.md §8.1). */
export const TENTATIVAS_ATE_BLOQUEIO = 5;

/** Duração do primeiro bloqueio. */
export const BLOQUEIO_INICIAL_MINUTOS = 15;

/**
 * Teto da escalada.
 *
 * O bloqueio dobra a cada reincidência — é o que "progressivo" significa —, mas
 * com teto: bloqueio de dias tornaria o próprio mecanismo de defesa uma negação
 * de serviço contra a loja, e o caminho de recuperação (reset presencial pelo
 * ADMIN, §8.3) nem sempre está disponível na hora do movimento.
 */
export const BLOQUEIO_MAXIMO_MINUTOS = 60;

export interface DadosUsuario {
  readonly id: Identificador;
  readonly matricula: Matricula;
  readonly nome: string;
  readonly papeis: readonly Papel[];
}

export interface DadosReconstituicaoUsuario extends DadosUsuario {
  readonly hashPin: HashCredencial | undefined;
  readonly hashSenha: HashCredencial | undefined;
  readonly ativo: boolean;
  readonly precisaTrocarSenha: boolean;
  readonly tentativasSeguidas: number;
  readonly bloqueiosSeguidos: number;
  readonly bloqueadoAte: Date | undefined;
  readonly ultimoAcessoEm: Date | undefined;
}

/** Por que uma conta não pode entrar agora. */
export type MotivoImpedimento = "INATIVO" | "BLOQUEADO" | "SEM_CREDENCIAL";

export class Usuario extends AggregateRoot {
  readonly #matricula: Matricula;
  #nome: string;
  #papeis: readonly Papel[];
  #hashPin: HashCredencial | undefined;
  #hashSenha: HashCredencial | undefined;
  #ativo = true;
  #precisaTrocarSenha = false;
  #tentativasSeguidas = 0;
  #bloqueiosSeguidos = 0;
  #bloqueadoAte: Date | undefined;
  #ultimoAcessoEm: Date | undefined;

  private constructor(dados: DadosUsuario) {
    super(dados.id);
    this.#matricula = dados.matricula;
    this.#nome = dados.nome;
    this.#papeis = dados.papeis;
  }

  static criar(dados: DadosUsuario): Result<Usuario, ErroValidacao> {
    const nome = dados.nome.trim();

    if (nome === "") {
      return err(new ErroValidacao("USUARIO_SEM_NOME", "Informe o nome do usuário."));
    }

    if (dados.papeis.length === 0) {
      // Usuário sem papel não consegue fazer nada, e o cadastro pareceria
      // concluído. Recusar aqui evita o chamado "cadastrei e não funciona".
      return err(
        new ErroValidacao(
          "USUARIO_SEM_PAPEL",
          "Escolha ao menos um papel para o usuário.",
        ),
      );
    }

    return ok(new Usuario({ ...dados, nome }));
  }

  static reconstituir(dados: DadosReconstituicaoUsuario): Result<Usuario, ErroValidacao> {
    const criado = Usuario.criar(dados);
    if (criado.isErr()) return err(criado.error);

    const usuario = criado.unwrap();
    usuario.#hashPin = dados.hashPin;
    usuario.#hashSenha = dados.hashSenha;
    usuario.#ativo = dados.ativo;
    usuario.#precisaTrocarSenha = dados.precisaTrocarSenha;
    usuario.#tentativasSeguidas = dados.tentativasSeguidas;
    usuario.#bloqueiosSeguidos = dados.bloqueiosSeguidos;
    usuario.#bloqueadoAte = dados.bloqueadoAte;
    usuario.#ultimoAcessoEm = dados.ultimoAcessoEm;

    // Reconstituir é leitura do que já aconteceu, não um fato novo: eventos
    // acumulados aqui seriam auditoria duplicada a cada consulta.
    usuario.coletarEventos();

    return ok(usuario);
  }

  get matricula(): Matricula {
    return this.#matricula;
  }

  get nome(): string {
    return this.#nome;
  }

  get papeis(): readonly Papel[] {
    return this.#papeis;
  }

  get ativo(): boolean {
    return this.#ativo;
  }

  get precisaTrocarSenha(): boolean {
    return this.#precisaTrocarSenha;
  }

  get tentativasSeguidas(): number {
    return this.#tentativasSeguidas;
  }

  get bloqueiosSeguidos(): number {
    return this.#bloqueiosSeguidos;
  }

  get bloqueadoAte(): Date | undefined {
    return this.#bloqueadoAte;
  }

  get ultimoAcessoEm(): Date | undefined {
    return this.#ultimoAcessoEm;
  }

  get hashPin(): HashCredencial | undefined {
    return this.#hashPin;
  }

  get hashSenha(): HashCredencial | undefined {
    return this.#hashSenha;
  }

  estaBloqueado(agora: Date): boolean {
    return (
      this.#bloqueadoAte !== undefined && this.#bloqueadoAte.getTime() > agora.getTime()
    );
  }

  /**
   * A conta pode tentar entrar por este meio, agora?
   *
   * Verificado **antes** de comparar a credencial. Calcular o hash de um PIN de
   * conta bloqueada gastaria os 64 MB e as três iterações do Argon2id em algo
   * que vai ser recusado de todo modo — e é justamente o que um ataque de força
   * bruta explora para derrubar o servidor da loja.
   */
  podeTentarAcesso(meio: MeioDeAcesso, agora: Date): Result<void, ErroRegraNegocio> {
    if (!this.#ativo) {
      return err(this.#impedimento("INATIVO"));
    }

    if (this.estaBloqueado(agora)) {
      return err(this.#impedimento("BLOQUEADO"));
    }

    const credencial = meio === "PIN" ? this.#hashPin : this.#hashSenha;

    if (credencial === undefined) {
      return err(this.#impedimento("SEM_CREDENCIAL"));
    }

    return ok(undefined);
  }

  /**
   * Registra acesso bem-sucedido, zerando a escalada.
   *
   * Zerar `bloqueiosSeguidos` é decisão consciente: quem acertou a credencial é
   * quase certamente a pessoa, e carregar punição de um erro de digitação da
   * semana passada faria o segundo esquecimento render meia hora de caixa
   * parado.
   */
  registrarAcesso(meio: MeioDeAcesso, agora: Date): void {
    this.#tentativasSeguidas = 0;
    this.#bloqueiosSeguidos = 0;
    this.#bloqueadoAte = undefined;
    this.#ultimoAcessoEm = agora;

    this.registrarEvento(acessoAutorizado(this.id, this.#matricula.valor, meio, agora));
  }

  /**
   * Registra falha e bloqueia quando o limite é atingido.
   *
   * Devolve o instante do desbloqueio quando o bloqueio começa agora — é o que a
   * tela precisa para dizer "tente novamente às 14h32" em vez de "acesso
   * negado", que não informa nada a quem está com fila esperando.
   */
  registrarFalhaDeAcesso(meio: MeioDeAcesso, agora: Date): Date | undefined {
    this.#tentativasSeguidas += 1;

    this.registrarEvento(
      acessoRecusado(
        this.id,
        this.#matricula.valor,
        meio,
        this.#tentativasSeguidas,
        agora,
      ),
    );

    if (this.#tentativasSeguidas < TENTATIVAS_ATE_BLOQUEIO) {
      return undefined;
    }

    this.#bloqueiosSeguidos += 1;
    this.#tentativasSeguidas = 0;
    this.#bloqueadoAte = new Date(agora.getTime() + this.#duracaoDoBloqueioMs());

    this.registrarEvento(
      usuarioBloqueado(
        this.id,
        this.#matricula.valor,
        this.#bloqueadoAte,
        this.#bloqueiosSeguidos,
        agora,
      ),
    );

    return this.#bloqueadoAte;
  }

  /** Reset presencial pelo ADMIN (§8.3). Libera sem esperar o prazo. */
  desbloquear(): void {
    this.#bloqueadoAte = undefined;
    this.#tentativasSeguidas = 0;
    this.#bloqueiosSeguidos = 0;
  }

  definirPin(hash: HashCredencial): void {
    this.#hashPin = hash;
  }

  /**
   * Define a senha.
   *
   * `temporaria` marca troca obrigatória no próximo acesso — é o caminho do
   * primeiro acesso e do reset pelo ADMIN. Nunca existe senha padrão de fábrica
   * (§8.3): a senha é sorteada e entregue à pessoa, e morre no primeiro uso.
   */
  definirSenha(hash: HashCredencial, opcoes: { readonly temporaria: boolean }): void {
    this.#hashSenha = hash;
    this.#precisaTrocarSenha = opcoes.temporaria;
  }

  desativar(): void {
    this.#ativo = false;
  }

  reativar(): void {
    this.#ativo = true;
  }

  renomear(nome: string): Result<void, ErroValidacao> {
    const limpo = nome.trim();

    if (limpo === "") {
      return err(new ErroValidacao("USUARIO_SEM_NOME", "Informe o nome do usuário."));
    }

    this.#nome = limpo;
    return ok(undefined);
  }

  atribuirPapeis(papeis: readonly Papel[]): Result<void, ErroValidacao> {
    if (papeis.length === 0) {
      return err(
        new ErroValidacao(
          "USUARIO_SEM_PAPEL",
          "Escolha ao menos um papel para o usuário.",
        ),
      );
    }

    this.#papeis = papeis;
    return ok(undefined);
  }

  /** União das permissões dos papéis. */
  get permissoes(): readonly Permissao[] {
    return [...new Set(this.#papeis.flatMap((papel) => papel.permissoes))];
  }

  temPermissao(permissao: Permissao): boolean {
    return this.#papeis.some((papel) => papel.concede(permissao));
  }

  /**
   * Alçada efetiva: o **maior** limite entre os papéis.
   *
   * Papel adiciona capacidade, nunca subtrai. Somar um papel a alguém não pode
   * reduzir o que essa pessoa já podia fazer — se reduzisse, o gerente que ganha
   * um papel extra passaria a poder menos, e ninguém entenderia por quê.
   */
  get limites(): LimitesPapel {
    const todos = this.#papeis.map((papel) => papel.limites);

    /* v8 ignore next 3 -- inalcançável: o agregado recusa usuário sem papel,
       tanto na criação quanto na atribuição. */
    if (todos.length === 0) {
      return LimitesPapel.nenhum();
    }

    return LimitesPapel.criar({
      descontoItem: Math.max(...todos.map((l) => l.descontoItem)),
      descontoVenda: Math.max(...todos.map((l) => l.descontoVenda)),
      sangria: maiorLimiteDeValor(todos.map((l) => l.sangria)),
      estornoEmDinheiro: maiorLimiteDeValor(todos.map((l) => l.estornoEmDinheiro)),
      cancelarVendaAteMinutos: maiorLimiteDeMinutos(
        todos.map((l) => l.cancelarVendaAteMinutos),
      ),
      /* v8 ignore next -- inalcançável: os limites de origem já são válidos, e o
         máximo de valores válidos é válido. */
    }).unwrapOr(LimitesPapel.nenhum());
  }

  #impedimento(motivo: MotivoImpedimento): ErroRegraNegocio {
    // A mensagem é a mesma para "inativo", "bloqueado" e "sem credencial" de
    // propósito: dizer qual é revela a existência e o estado da conta a quem só
    // está testando matrículas. O motivo real vai em `detalhes`, para o log.
    return new ErroRegraNegocio(
      `ACESSO_${motivo}`,
      "Não foi possível entrar. Confira a matrícula e a senha, ou procure o responsável.",
      { motivo, matricula: this.#matricula.valor },
    );
  }

  #duracaoDoBloqueioMs(): number {
    const minutos = Math.min(
      BLOQUEIO_INICIAL_MINUTOS * 2 ** (this.#bloqueiosSeguidos - 1),
      BLOQUEIO_MAXIMO_MINUTOS,
    );

    return minutos * 60_000;
  }
}

function maiorLimiteDeValor(limites: readonly LimiteDinheiro[]): LimiteDinheiro {
  if (limites.includes(ILIMITADO)) return ILIMITADO;

  return limites.reduce<Dinheiro>((maior, limite) => {
    /* v8 ignore next -- `ILIMITADO` já foi descartado acima. */
    if (limite === ILIMITADO) return maior;
    return limite.maiorQue(maior) ? limite : maior;
  }, Dinheiro.zero());
}

function maiorLimiteDeMinutos(limites: readonly LimiteMinutos[]): LimiteMinutos {
  if (limites.includes(ILIMITADO)) return ILIMITADO;

  return limites.reduce<number>((maior, limite) => {
    /* v8 ignore next -- `ILIMITADO` já foi descartado acima. */
    if (limite === ILIMITADO) return maior;
    return Math.max(maior, limite);
  }, 0);
}
