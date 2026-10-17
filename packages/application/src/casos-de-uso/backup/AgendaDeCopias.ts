import {
  type DomainError,
  err,
  ErroValidacao,
  type Identificador,
  ok,
  type Result,
} from "@erp/domain";

import { auditar } from "../../auditoria/RegistroAuditoria.js";
import { ErroInfraestrutura } from "../../erros/ErroInfraestrutura.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type {
  ConfiguracaoDeBackup,
  ExecucaoDeBackup,
  OrigemDaCopia,
} from "../../portas/repositorios/RepositoriosBackup.js";
import { CONFIGURACAO_DE_BACKUP_PADRAO, INTERVALOS_DE_BACKUP } from "./configuracao.js";
import type { FazerCopiaDeSeguranca, TravaDeCopias } from "./CopiasDeSeguranca.js";
import type { CopiaGuardada, PastaDeCopias } from "./portas.js";

/**
 * Quando a cópia sai sozinha.
 *
 * A regra mora aqui, e não no servidor: o servidor só bate o relógio (a cada
 * minuto) e avisa do fechamento de caixa. Decidir se é hora — e o que fazer
 * quando a última falhou — é regra, e regra se testa sem esperar uma hora.
 */

const UMA_HORA_MS = 3_600_000;

export interface MarcosDaAgenda {
  readonly intervaloHoras: number;
  /** A cópia boa mais nova, de qualquer origem. */
  readonly ultimaProvada?: Date | undefined;
  /** A tentativa mais recente, boa ou não. */
  readonly ultimaTentativa?: Date | undefined;
}

/**
 * Quando sai a próxima cópia automática; `undefined` com a agenda desligada.
 *
 * Conta da última cópia **boa**, de qualquer origem — a feita à mão às 13h30
 * adia a das 14h. Depois de uma tentativa que falhou, tenta de novo em uma
 * hora, mesmo com a agenda de 24 em 24: esperar um dia inteiro para repetir
 * uma falha passageira deixaria a loja um dia a mais sem cópia.
 */
export function proximaCopiaAutomatica(marcos: MarcosDaAgenda): Date | undefined {
  // Zero só chega pelo banco, ajustado pelo suporte: a tela não oferece.
  if (marcos.intervaloHoras <= 0) return undefined;

  const intervalo = marcos.intervaloHoras * UMA_HORA_MS;
  const pelaUltimaBoa =
    marcos.ultimaProvada === undefined ? 0 : marcos.ultimaProvada.getTime() + intervalo;
  const pelaUltimaTentativa =
    marcos.ultimaTentativa === undefined
      ? 0
      : marcos.ultimaTentativa.getTime() + Math.min(intervalo, UMA_HORA_MS);

  return new Date(Math.max(pelaUltimaBoa, pelaUltimaTentativa));
}

export function copiaAutomaticaDevida(marcos: MarcosDaAgenda, agora: Date): boolean {
  const proxima = proximaCopiaAutomatica(marcos);

  return proxima !== undefined && proxima.getTime() <= agora.getTime();
}

/**
 * A agenda das cópias, batida pelo relógio do servidor.
 *
 * Nunca lança: ela roda num temporizador, e uma exceção ali derrubaria o
 * servidor do caixa por causa de uma cópia.
 */
export class AgendaDeCopias {
  #fechamentoPendente = false;
  #verificando = false;

  constructor(
    private readonly fazer: FazerCopiaDeSeguranca,
    private readonly pasta: PastaDeCopias,
    private readonly trava: TravaDeCopias,
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
  ) {}

  /**
   * O caixa fechou: a cópia sai em seguida, sem fazer o fechamento esperar.
   *
   * Se outra cópia estiver em andamento, o pedido fica guardado e sai na
   * próxima batida — a que está em andamento começou antes do fechamento e
   * não tem o movimento dele.
   */
  pedirCopiaDoFechamento(): Promise<OrigemDaCopia | undefined> {
    this.#fechamentoPendente = true;
    return this.verificar();
  }

  /** Faz a cópia devida, se houver; devolve a origem da que tentou. */
  async verificar(): Promise<OrigemDaCopia | undefined> {
    if (this.#verificando || this.trava.ocupada) return undefined;

    this.#verificando = true;

    try {
      const origem = await this.#devida();
      if (origem === undefined) return undefined;

      if (origem === "FECHAMENTO_DE_CAIXA") this.#fechamentoPendente = false;

      const feita = await this.fazer.executar({ origem });

      // Uma cópia pedida à mão começou no meio do caminho: o fechamento
      // espera a próxima batida, em vez de se perder.
      if (
        origem === "FECHAMENTO_DE_CAIXA" &&
        feita.isErr() &&
        feita.error.codigo === "COPIA_EM_ANDAMENTO"
      ) {
        this.#fechamentoPendente = true;
      }

      return origem;
    } catch {
      // A falha da cópia já fica no registro de tentativas; esta é a de ler a
      // agenda, que se repete na próxima batida.
      return undefined;
    } finally {
      this.#verificando = false;
    }
  }

  async #devida(): Promise<OrigemDaCopia | undefined> {
    const lida = await this.unitOfWork.transacao(async (repositorios) =>
      ok({
        configuracao:
          (await repositorios.backup.configuracao()) ?? CONFIGURACAO_DE_BACKUP_PADRAO,
        ultima: (await repositorios.backup.ultimasExecucoes(1, "BACKUP"))[0],
      }),
    );

    // Banco fora do ar: a cópia também não sairia. Tenta na próxima batida.
    if (lida.isErr()) return undefined;

    const { configuracao, ultima } = lida.value;

    if (this.#fechamentoPendente) {
      if (configuracao.aoFecharCaixa) return "FECHAMENTO_DE_CAIXA";
      this.#fechamentoPendente = false;
    }

    const marcos: MarcosDaAgenda = {
      intervaloHoras: configuracao.intervaloHoras,
      ultimaProvada: await this.#ultimaProvada(),
      ultimaTentativa: ultima?.iniciadaEm,
    };

    return copiaAutomaticaDevida(marcos, this.relogio.agora()) ? "AUTOMATICA" : undefined;
  }

  /**
   * A pasta que não abre conta como "nenhuma cópia boa": a tentativa sai, e a
   * falha dela fica registrada com o motivo — em vez de a agenda parar calada.
   */
  async #ultimaProvada(): Promise<Date | undefined> {
    try {
      return maisNovaProvada(await this.pasta.listar())?.criadaEm;
    } catch {
      return undefined;
    }
  }
}

function maisNovaProvada(copias: readonly CopiaGuardada[]): CopiaGuardada | undefined {
  return copias
    .filter((copia) => copia.prova.restaurou)
    .reduce<CopiaGuardada | undefined>(
      (maisNova, copia) =>
        maisNova === undefined || copia.criadaEm > maisNova.criadaEm ? copia : maisNova,
      undefined,
    );
}

export interface SituacaoDasCopias {
  /** Da mais nova para a mais antiga. */
  readonly copias: readonly CopiaGuardada[];
  readonly configuracao: ConfiguracaoDeBackup;
  readonly ultimaTentativa?: ExecucaoDeBackup | undefined;
  /** Uma cópia, conferência ou restauração rodando agora. */
  readonly emAndamento: boolean;
  /** `undefined` com a agenda desligada pelo suporte. */
  readonly proximaAutomatica?: Date | undefined;
}

export class ConsultarCopiasDeSeguranca {
  constructor(
    private readonly pasta: PastaDeCopias,
    private readonly trava: TravaDeCopias,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async executar(): Promise<Result<SituacaoDasCopias, DomainError>> {
    const lida = await this.unitOfWork.transacao(async (repositorios) =>
      ok({
        configuracao:
          (await repositorios.backup.configuracao()) ?? CONFIGURACAO_DE_BACKUP_PADRAO,
        ultimaTentativa: (await repositorios.backup.ultimasExecucoes(1, "BACKUP"))[0],
      }),
    );
    if (lida.isErr()) return err(lida.error);

    let copias: readonly CopiaGuardada[];

    try {
      copias = [...(await this.pasta.listar())].sort(
        (a, b) => b.criadaEm.getTime() - a.criadaEm.getTime(),
      );
    } catch (causa) {
      return err(
        new ErroInfraestrutura(
          "PASTA_DE_COPIAS_INACESSIVEL",
          "A pasta das cópias de segurança não abriu. Confira se o disco está ligado e chame o suporte.",
          { causa: causa instanceof Error ? causa.message : String(causa) },
        ),
      );
    }

    const { configuracao, ultimaTentativa } = lida.value;

    return ok({
      copias,
      configuracao,
      ultimaTentativa,
      emAndamento: this.trava.ocupada,
      proximaAutomatica: proximaCopiaAutomatica({
        intervaloHoras: configuracao.intervaloHoras,
        ultimaProvada: maisNovaProvada(copias)?.criadaEm,
        ultimaTentativa: ultimaTentativa?.iniciadaEm,
      }),
    });
  }
}

export interface EntradaDefinirConfiguracaoDeBackup {
  readonly usuarioId: Identificador;
  readonly intervaloHoras: number;
  readonly aoFecharCaixa: boolean;
}

/**
 * Muda a agenda. Fica na auditoria: espaçar as cópias é aceitar perder mais
 * vendas no dia do disco queimado, e "quem mudou isso?" vai ser perguntado.
 */
export class DefinirConfiguracaoDeBackup {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async executar(
    entrada: EntradaDefinirConfiguracaoDeBackup,
  ): Promise<Result<ConfiguracaoDeBackup, DomainError>> {
    if (!INTERVALOS_DE_BACKUP.includes(entrada.intervaloHoras)) {
      return err(
        new ErroValidacao(
          "INTERVALO_DE_BACKUP_INVALIDO",
          "Escolha de quanto em quanto tempo sai a cópia entre as opções da lista.",
        ),
      );
    }

    return this.unitOfWork.transacao(async (repositorios) => {
      const antes =
        (await repositorios.backup.configuracao()) ?? CONFIGURACAO_DE_BACKUP_PADRAO;
      const depois: ConfiguracaoDeBackup = {
        ...antes,
        intervaloHoras: entrada.intervaloHoras,
        aoFecharCaixa: entrada.aoFecharCaixa,
      };

      await repositorios.backup.salvarConfiguracao(depois, this.geradorId.proximo());

      if (resumir(antes) !== resumir(depois)) {
        await auditar(repositorios, this.geradorId, {
          ocorridoEm: this.relogio.agora(),
          acao: "CONFIGURACAO_ALTERADA",
          usuarioId: entrada.usuarioId,
          descricao: `Cópia de segurança alterada: ${resumir(depois)}.`,
          entidade: "configuracao_backup",
          dados: { antes: resumir(antes), depois: resumir(depois) },
        });
      }

      return ok(depois);
    });
  }
}

/** "de 4 em 4 horas, e ao fechar o caixa". */
function resumir(configuracao: ConfiguracaoDeBackup): string {
  const intervalo =
    configuracao.intervaloHoras === 1
      ? "de hora em hora"
      : `de ${String(configuracao.intervaloHoras)} em ${String(configuracao.intervaloHoras)} horas`;

  return configuracao.aoFecharCaixa
    ? `${intervalo}, e ao fechar o caixa`
    : `${intervalo}, sem cópia ao fechar o caixa`;
}
