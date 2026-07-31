import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroRegraNegocio } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";

import type { CredencialHash } from "./CredencialHash.js";
import { familiaDeSessaoRevogada } from "./eventos.js";

/** Onde a sessão nasceu. Muda a validade e o que a encerra. */
export type ContextoSessao = "PDV" | "RETAGUARDA";

export interface DadosSessaoAcesso {
  readonly id: Identificador;
  readonly usuarioId: Identificador;
  /**
   * Família da sessão.
   *
   * Todas as renovações de um mesmo login compartilham a família. É o que
   * permite revogar **a cadeia inteira** quando um refresh roubado é detectado,
   * em vez de revogar só o token que o ladrão usou — que não adiantaria nada.
   */
  readonly familiaId: Identificador;
  readonly dispositivoId: Identificador;
  readonly contexto: ContextoSessao;
  /** Hash do refresh. O valor em claro só existe no cookie do cliente. */
  readonly hashRefresh: CredencialHash;
  readonly criadaEm: Date;
  readonly expiraEm: Date;
}

export interface DadosReconstituicaoSessao extends DadosSessaoAcesso {
  readonly revogadaEm: Date | undefined;
  readonly usadaEm: Date | undefined;
  readonly sucessoraId: Identificador | undefined;
}

/**
 * Sessão de acesso — o elo entre um login e as requisições que vêm depois.
 *
 * Guarda apenas o **hash** do refresh token. Vazamento do banco não entrega
 * sessões ativas: o atacante levaria hashes, e hash não é aceito na renovação.
 *
 * ### Rotação com detecção de reúso
 *
 * Cada renovação gasta o refresh atual e emite um novo. Se um refresh **já
 * gasto** reaparece, só há duas explicações: ou foi roubado, ou foi clonado.
 * Nas duas, a resposta é a mesma e é agressiva — **revogar a família inteira**,
 * derrubando tanto o ladrão quanto o dono. O dono faz login de novo e perde
 * dez segundos; sem isso, o ladrão fica dentro do sistema até o token expirar
 * naturalmente (ARQUITETURA.md §8.2).
 */
export class SessaoAcesso extends AggregateRoot {
  readonly #usuarioId: Identificador;
  readonly #familiaId: Identificador;
  readonly #dispositivoId: Identificador;
  readonly #contexto: ContextoSessao;
  readonly #hashRefresh: CredencialHash;
  readonly #criadaEm: Date;
  #expiraEm: Date;
  #revogadaEm: Date | undefined;
  #usadaEm: Date | undefined;
  #sucessoraId: Identificador | undefined;

  private constructor(dados: DadosSessaoAcesso) {
    super(dados.id);
    this.#usuarioId = dados.usuarioId;
    this.#familiaId = dados.familiaId;
    this.#dispositivoId = dados.dispositivoId;
    this.#contexto = dados.contexto;
    this.#hashRefresh = dados.hashRefresh;
    this.#criadaEm = dados.criadaEm;
    this.#expiraEm = dados.expiraEm;
  }

  static abrir(dados: DadosSessaoAcesso): SessaoAcesso {
    return new SessaoAcesso(dados);
  }

  /** Uso exclusivo do repositório. Ver `Produto.reconstituir` sobre não revalidar. */
  static reconstituir(dados: DadosReconstituicaoSessao): SessaoAcesso {
    const sessao = new SessaoAcesso(dados);

    sessao.#revogadaEm = dados.revogadaEm;
    sessao.#usadaEm = dados.usadaEm;
    sessao.#sucessoraId = dados.sucessoraId;

    return sessao;
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  get usuarioId(): Identificador {
    return this.#usuarioId;
  }

  get familiaId(): Identificador {
    return this.#familiaId;
  }

  get dispositivoId(): Identificador {
    return this.#dispositivoId;
  }

  get contexto(): ContextoSessao {
    return this.#contexto;
  }

  get hashRefresh(): CredencialHash {
    return this.#hashRefresh;
  }

  get criadaEm(): Date {
    return this.#criadaEm;
  }

  get expiraEm(): Date {
    return this.#expiraEm;
  }

  get revogadaEm(): Date | undefined {
    return this.#revogadaEm;
  }

  get usadaEm(): Date | undefined {
    return this.#usadaEm;
  }

  get sucessoraId(): Identificador | undefined {
    return this.#sucessoraId;
  }

  get estaRevogada(): boolean {
    return this.#revogadaEm !== undefined;
  }

  /** Já foi trocada por outra — logo, o refresh dela está gasto. */
  get jaFoiUsada(): boolean {
    return this.#usadaEm !== undefined;
  }

  estaExpirada(agora: Date): boolean {
    return this.#expiraEm <= agora;
  }

  estaValida(agora: Date): boolean {
    return !this.estaRevogada && !this.jaFoiUsada && !this.estaExpirada(agora);
  }

  // ── Renovação ──────────────────────────────────────────────────────────

  /**
   * Verifica se esta sessão pode ser renovada.
   *
   * Distingue os dois "não" que parecem iguais e não são: sessão **expirada**
   * é rotina e o usuário só refaz o login; sessão **já usada** é um refresh que
   * voltou do além, e aí a família toda cai.
   */
  podeRenovar(agora: Date): Result<void, ErroRegraNegocio> {
    if (this.estaRevogada) {
      return err(
        new ErroRegraNegocio(
          "SESSAO_REVOGADA",
          "Sua sessão foi encerrada. Entre de novo.",
          {
            sessaoId: this.id.valor,
          },
        ),
      );
    }

    if (this.jaFoiUsada) {
      return err(
        new ErroRegraNegocio(
          "SESSAO_REUSO_DETECTADO",
          "Sua sessão foi encerrada por segurança. Entre de novo.",
          { sessaoId: this.id.valor, familiaId: this.#familiaId.valor },
        ),
      );
    }

    if (this.estaExpirada(agora)) {
      return err(
        new ErroRegraNegocio("SESSAO_EXPIRADA", "Sua sessão expirou. Entre de novo.", {
          sessaoId: this.id.valor,
        }),
      );
    }

    return ok(undefined);
  }

  /** Marca esta sessão como gasta, apontando para quem a substituiu. */
  marcarComoRenovada(sucessoraId: Identificador, agora: Date): void {
    this.#usadaEm = agora;
    this.#sucessoraId = sucessoraId;
  }

  /**
   * Registra que um refresh já gasto reapareceu.
   *
   * O evento é o que dispara a revogação da família e o alerta na retaguarda —
   * é o sinal mais forte de credencial roubada que o sistema consegue produzir.
   */
  registrarReuso(agora: Date): void {
    this.registrarEvento(
      familiaDeSessaoRevogada(this.id, this.#usuarioId, this.#familiaId, agora),
    );
  }

  revogar(agora: Date): void {
    if (this.estaRevogada) return;
    this.#revogadaEm = agora;
  }

  /**
   * Estende a validade enquanto o operador trabalha.
   *
   * **A sessão do PDV não expira com o caixa aberto.** Expirar no meio de uma
   * venda, com o cliente esperando, é defeito de produto — a sessão renova
   * enquanto há atividade e encerra no fechamento do caixa
   * (ARQUITETURA.md §8.2).
   */
  prorrogar(novoVencimento: Date): void {
    if (novoVencimento > this.#expiraEm) {
      this.#expiraEm = novoVencimento;
    }
  }
}
