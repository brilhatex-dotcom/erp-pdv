import {
  type DomainError,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
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
import {
  CONFIGURACAO_DE_BACKUP_PADRAO,
  politicaDe,
  textoDoErro,
} from "./configuracao.js";
import type {
  CopiaGuardada,
  FerramentaDeBackup,
  Manutencao,
  PastaDeCopias,
  ProvaDaCopia,
  ResumoDoBanco,
} from "./portas.js";
import { copiasParaApagar } from "./retencao.js";

/**
 * Cópias de segurança: fazer, conferir e restaurar.
 *
 * ### Toda cópia é provada
 *
 * A cópia é restaurada numa base descartável logo depois de feita, e o que
 * ela contém (vendas, produtos, clientes, período) fica registrado junto. Uma
 * cópia que não restaura é avisada no mesmo minuto — e não no dia em que a
 * loja precisa dela (ARQUITETURA.md §10.4).
 *
 * ### Toda tentativa fica registrada
 *
 * Inclusive a que falhou sem deixar arquivo. É o registro que mostra, na tela
 * e ao suporte, que a última cópia boa é de três dias atrás — a pergunta que
 * ninguém faz até precisar da cópia.
 *
 * ### Restaurar é a operação mais perigosa do sistema
 *
 * Ela substitui tudo o que a loja fez desde a cópia. Por isso: só quem tem
 * `config:backup`; a palavra RESTAURAR digitada, além do clique; a cópia
 * conferida de novo na hora; a recusa de cópia de outra versão do sistema;
 * e uma cópia do banco de agora **antes** de trocar — se foi engano, é por ela
 * que se volta.
 */

/**
 * Uma operação de cópia de cada vez.
 *
 * Duas `pg_dump` ao mesmo tempo dobram a carga no servidor do caixa, e uma
 * restauração no meio de uma cópia apagaria o chão da cópia. A segunda
 * operação não espera: é recusada com uma frase que explica o porquê.
 */
export class TravaDeCopias {
  #ocupada = false;

  get ocupada(): boolean {
    return this.#ocupada;
  }

  async uma<T>(
    acao: () => Promise<Result<T, DomainError>>,
  ): Promise<Result<T, DomainError>> {
    if (this.#ocupada) {
      return err(
        new ErroRegraNegocio(
          "COPIA_EM_ANDAMENTO",
          "Já há uma cópia de segurança em andamento. Espere ela terminar e tente de novo.",
        ),
      );
    }

    this.#ocupada = true;

    try {
      return await acao();
    } finally {
      this.#ocupada = false;
    }
  }
}

export interface EntradaFazerCopia {
  readonly origem: OrigemDaCopia;
  /** Ausente na cópia automática: quem a fez foi o sistema. */
  readonly usuarioId?: Identificador | undefined;
}

export class FazerCopiaDeSeguranca {
  constructor(
    private readonly ferramenta: FerramentaDeBackup,
    private readonly pasta: PastaDeCopias,
    private readonly trava: TravaDeCopias,
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  executar(entrada: EntradaFazerCopia): Promise<Result<CopiaGuardada, DomainError>> {
    return this.trava.uma(() => this.dentroDaTrava(entrada));
  }

  /**
   * A cópia, para quem já segura a trava — a restauração, que faz a cópia de
   * antes sem soltar a trava no meio do caminho.
   *
   * A cópia que não restaura também é guardada, marcada assim: é a prova do
   * problema para o suporte, e a tela mostra que a última tentativa falhou.
   */
  async dentroDaTrava(
    entrada: EntradaFazerCopia,
  ): Promise<Result<CopiaGuardada, DomainError>> {
    const execucao: ExecucaoDeBackup = {
      id: this.geradorId.proximo(),
      operacao: "BACKUP",
      origem: entrada.origem,
      situacao: "EM_ANDAMENTO",
      // A cópia é "a das 14h" pelo começo: é desse instante a fotografia que o
      // `pg_dump` tira do banco, e não do fim da conferência.
      iniciadaEm: this.relogio.agora(),
      usuarioId: entrada.usuarioId,
    };

    const configuracao = await this.#comecar(execucao);

    let copia: CopiaGuardada;

    try {
      const gerado = await this.ferramenta.gerar();

      if (gerado.isErr()) {
        await this.#registrar(falhou(execucao, this.relogio.agora(), gerado.error));
        return err(gerado.error);
      }

      const prova = await this.ferramenta.provar(gerado.value.caminho);
      copia = await this.pasta.guardar(gerado.value, {
        origem: entrada.origem,
        criadaEm: execucao.iniciadaEm,
        prova,
      });
    } catch (causa) {
      const erro = new ErroInfraestrutura(
        "BACKUP_FALHOU",
        "A cópia de segurança não pôde ser gravada na pasta. Confira se há espaço no disco e chame o suporte.",
        { causa: causa instanceof Error ? causa.message : String(causa) },
      );
      await this.#registrar(falhou(execucao, this.relogio.agora(), erro));
      return err(erro);
    }

    // A cópia de antes de restaurar não aplica a retenção: feita na mesma hora
    // da cópia escolhida, ela a empurraria para fora da pasta — e a
    // restauração ficaria sem o arquivo que ia restaurar. A próxima cópia
    // comum aplica.
    if (entrada.origem !== "ANTES_DE_RESTAURAR") {
      await this.#aplicarRetencao(configuracao);
    }

    // A cópia já está no disco: se o registro não gravar (o banco caiu depois
    // do dump), a cópia continua valendo e não pode ser jogada fora.
    await this.unitOfWork.transacao(async (repositorios) => {
      await repositorios.backup.registrarExecucao({
        ...execucao,
        situacao: copia.prova.restaurou ? "CONCLUIDO" : "FALHOU",
        concluidaEm: this.relogio.agora(),
        arquivo: copia.nome,
        tamanhoBytes: copia.tamanhoBytes,
        sha256: copia.sha256,
        erro: copia.prova.restaurou
          ? undefined
          : `A cópia foi feita, mas não restaurou na conferência: ${copia.prova.motivo}`,
      });

      await auditar(repositorios, this.geradorId, {
        ocorridoEm: copia.criadaEm,
        acao: "BACKUP_EXECUTADO",
        usuarioId: entrada.usuarioId,
        descricao: descreverCopia(copia),
        entidade: "copia_de_seguranca",
        dados: {
          arquivo: copia.nome,
          origem: copia.origem,
          tamanhoBytes: copia.tamanhoBytes,
          sha256: copia.sha256,
          restaurou: copia.prova.restaurou,
        },
      });

      return ok(undefined);
    });

    return ok(copia);
  }

  /**
   * Marca a tentativa como começada e lê a retenção da loja.
   *
   * Com o banco fora, segue com a de fábrica: o `pg_dump` vai dizer o que
   * aconteceu, e a cópia não pode depender do registro dela.
   */
  async #comecar(execucao: ExecucaoDeBackup): Promise<ConfiguracaoDeBackup> {
    const lida = await this.unitOfWork.transacao(async (repositorios) => {
      await repositorios.backup.registrarExecucao(execucao);
      return ok(await repositorios.backup.configuracao());
    });

    return (lida.isOk() ? lida.value : undefined) ?? CONFIGURACAO_DE_BACKUP_PADRAO;
  }

  /**
   * Tira da pasta o que a retenção manda. A cópia nova já está guardada: se a
   * pasta não listar agora, as velhas saem depois da próxima.
   */
  async #aplicarRetencao(configuracao: ConfiguracaoDeBackup): Promise<void> {
    try {
      for (const nome of copiasParaApagar(
        await this.pasta.listar(),
        politicaDe(configuracao),
      )) {
        await this.pasta.apagar(nome);
      }
    } catch {
      // A cópia boa não vira falha por causa das velhas.
    }
  }

  async #registrar(execucao: ExecucaoDeBackup): Promise<void> {
    await this.unitOfWork.transacao(async (repositorios) => {
      await repositorios.backup.registrarExecucao(execucao);
      return ok(undefined);
    });
  }
}

function falhou(
  execucao: ExecucaoDeBackup,
  concluidaEm: Date,
  erro: DomainError,
): ExecucaoDeBackup {
  return { ...execucao, situacao: "FALHOU", concluidaEm, erro: textoDoErro(erro) };
}

export interface ConferenciaDaCopia {
  readonly copia: CopiaGuardada;
  /** A prova feita agora, e não a de quando a cópia foi guardada. */
  readonly prova: ProvaDaCopia;
  readonly atual: ResumoDoBanco;
  /** Mesma versão do sistema: as mesmas migrações, na mesma ordem. */
  readonly compativel: boolean;
}

export class ConferirCopiaDeSeguranca {
  constructor(
    private readonly ferramenta: FerramentaDeBackup,
    private readonly pasta: PastaDeCopias,
    private readonly trava: TravaDeCopias,
  ) {}

  /**
   * Restaura a cópia numa base à parte e mostra o que há nela, lado a lado com
   * o banco de agora — sem trocar nada. É o "olhar antes de restaurar".
   */
  async executar(nome: string): Promise<Result<ConferenciaDaCopia, DomainError>> {
    const conferida = await this.trava.uma(() => this.dentroDaTrava(nome));

    return conferida.isErr() ? err(conferida.error) : ok(conferida.value.conferencia);
  }

  async dentroDaTrava(
    nome: string,
  ): Promise<
    Result<
      { readonly conferencia: ConferenciaDaCopia; readonly caminho: string },
      DomainError
    >
  > {
    const copia = (await this.pasta.listar()).find((guardada) => guardada.nome === nome);
    const caminho = await this.pasta.caminhoDe(nome);

    if (copia === undefined || caminho === undefined) {
      return err(
        new ErroNaoEncontrado(
          "COPIA_NAO_ENCONTRADA",
          "Essa cópia de segurança não está mais na pasta. Atualize a lista.",
        ),
      );
    }

    const prova = await this.ferramenta.provar(caminho);
    const atual = await this.ferramenta.resumoAtual();

    return ok({
      conferencia: {
        copia,
        prova,
        atual,
        compativel:
          prova.restaurou && mesmasMigracoes(prova.resumo.migracoes, atual.migracoes),
      },
      caminho,
    });
  }
}

/** A palavra que quem restaura digita — o clique sozinho não basta. */
export const PALAVRA_DE_CONFIRMACAO = "RESTAURAR";

export interface EntradaRestaurarCopia {
  readonly nome: string;
  readonly confirmacao: string;
  readonly usuarioId: Identificador;
  /**
   * "Ana Gerente (matrícula 1)", para a auditoria.
   *
   * Vai no texto porque a cópia restaurada pode ser de antes de essa pessoa
   * existir no cadastro — e o registro da restauração não pode ficar sem
   * dizer quem a fez.
   */
  readonly quem: string;
  /**
   * Restaurar mesmo com caixas abertos.
   *
   * A saída para o desastre em que o caixa não tem como ser fechado — a
   * estação queimou junto. Sem ela, a restauração espera os caixas fecharem.
   */
  readonly comCaixasAbertos?: boolean | undefined;
}

export interface SaidaRestaurarCopia {
  readonly restaurada: CopiaGuardada;
  /** O banco como estava antes — por onde se volta, se foi engano. */
  readonly copiaDeAntes: CopiaGuardada;
}

export class RestaurarCopiaDeSeguranca {
  constructor(
    private readonly conferir: ConferirCopiaDeSeguranca,
    private readonly fazer: FazerCopiaDeSeguranca,
    private readonly ferramenta: FerramentaDeBackup,
    private readonly manutencao: Manutencao,
    private readonly trava: TravaDeCopias,
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async executar(
    entrada: EntradaRestaurarCopia,
  ): Promise<Result<SaidaRestaurarCopia, DomainError>> {
    if (entrada.confirmacao.trim().toUpperCase() !== PALAVRA_DE_CONFIRMACAO) {
      return err(
        new ErroValidacao(
          "CONFIRMACAO_INCORRETA",
          `Para restaurar, digite ${PALAVRA_DE_CONFIRMACAO} no campo de confirmação.`,
        ),
      );
    }

    return this.trava.uma(async () => {
      const execucao: ExecucaoDeBackup = {
        id: this.geradorId.proximo(),
        operacao: "RESTAURACAO",
        origem: "MANUAL",
        situacao: "EM_ANDAMENTO",
        iniciadaEm: this.relogio.agora(),
        arquivo: entrada.nome,
        usuarioId: entrada.usuarioId,
      };

      await this.#registrar(execucao);

      const restaurada = await this.#restaurar(entrada, execucao);

      // A recusa fica no banco de agora, que continua sendo o da loja.
      if (restaurada.isErr()) {
        await this.#registrar(falhou(execucao, this.relogio.agora(), restaurada.error));
      }

      return restaurada;
    });
  }

  async #restaurar(
    entrada: EntradaRestaurarCopia,
    execucao: ExecucaoDeBackup,
  ): Promise<Result<SaidaRestaurarCopia, DomainError>> {
    const conferida = await this.conferir.dentroDaTrava(entrada.nome);
    if (conferida.isErr()) return err(conferida.error);

    const { conferencia, caminho } = conferida.value;

    if (!conferencia.prova.restaurou) {
      return err(
        new ErroRegraNegocio(
          "COPIA_NAO_RESTAURA",
          `Esta cópia não restaurou na conferência (${conferencia.prova.motivo}). Escolha outra.`,
        ),
      );
    }

    if (!conferencia.compativel) {
      return err(
        new ErroRegraNegocio(
          "COPIA_DE_OUTRA_VERSAO",
          "Esta cópia é de outra versão do sistema e não pode ser restaurada por aqui. Chame o suporte.",
        ),
      );
    }

    // A venda que uma estação guarda durante a troca entra depois pelo caixa
    // aberto dela. Se esse caixa foi aberto depois da cópia, ele some com a
    // restauração, a venda é recusada — e a estação a tira da fila.
    const abertos = conferencia.atual.caixasAbertos;
    if (abertos > 0 && entrada.comCaixasAbertos !== true) {
      return err(
        new ErroRegraNegocio(
          "CAIXAS_ABERTOS",
          `${abertos === 1 ? "Há 1 caixa aberto" : `Há ${String(abertos)} caixas abertos`} agora. Feche os caixas antes de restaurar: a venda feita num caixa aberto depois da cópia não teria mais onde entrar.`,
          { caixasAbertos: abertos },
        ),
      );
    }

    const antes = await this.fazer.dentroDaTrava({
      origem: "ANTES_DE_RESTAURAR",
      usuarioId: entrada.usuarioId,
    });
    if (antes.isErr()) return err(antes.error);

    if (!antes.value.prova.restaurou) {
      return err(
        new ErroRegraNegocio(
          "COPIA_DE_ANTES_FALHOU",
          "A cópia do banco atual, feita antes de restaurar, não passou na conferência. Nada foi trocado. Chame o suporte.",
        ),
      );
    }

    const restaurado = await this.manutencao.durante(() =>
      this.ferramenta.restaurar(caminho),
    );
    if (restaurado.isErr()) return err(restaurado.error);

    await this.#registrarNoBancoRestaurado(
      entrada,
      execucao,
      conferencia.copia,
      antes.value,
    );

    return ok({ restaurada: conferencia.copia, copiaDeAntes: antes.value });
  }

  async #registrar(execucao: ExecucaoDeBackup): Promise<void> {
    await this.unitOfWork.transacao(async (repositorios) => {
      await repositorios.backup.registrarExecucao(execucao);
      return ok(undefined);
    });
  }

  /**
   * Grava a restauração no banco restaurado — o que passa a valer. O registro
   * de "em andamento" ficou no banco que saiu.
   *
   * Primeiro com o usuário; se o cadastro dele não existir na cópia, sem ele,
   * com o nome no texto. Restauração sem registro não pode acontecer.
   */
  async #registrarNoBancoRestaurado(
    entrada: EntradaRestaurarCopia,
    execucao: ExecucaoDeBackup,
    restaurada: CopiaGuardada,
    antes: CopiaGuardada,
  ): Promise<void> {
    const agora = this.relogio.agora();

    const gravar = (usuarioId: Identificador | undefined) =>
      this.unitOfWork.transacao(async (repositorios) => {
        await repositorios.backup.registrarExecucao({
          ...execucao,
          situacao: "CONCLUIDO",
          concluidaEm: agora,
          tamanhoBytes: restaurada.tamanhoBytes,
          sha256: restaurada.sha256,
          usuarioId,
        });

        await auditar(repositorios, this.geradorId, {
          ocorridoEm: agora,
          acao: "BACKUP_RESTAURADO",
          usuarioId,
          descricao: `Banco restaurado da cópia de ${dataHora(restaurada.criadaEm)} por ${entrada.quem}. O banco anterior ficou na cópia ${antes.nome}.`,
          entidade: "copia_de_seguranca",
          dados: { arquivo: restaurada.nome, copiaDeAntes: antes.nome },
        });

        return ok(undefined);
      });

    if ((await gravar(entrada.usuarioId)).isOk()) return;

    await gravar(undefined);
  }
}

function mesmasMigracoes(copia: readonly string[], atual: readonly string[]): boolean {
  return (
    copia.length === atual.length &&
    copia.every((nome, posicao) => nome === atual[posicao])
  );
}

const ORIGENS: Readonly<Record<OrigemDaCopia, string>> = {
  AUTOMATICA: "automática",
  MANUAL: "feita à mão",
  FECHAMENTO_DE_CAIXA: "do fechamento de caixa",
  ANTES_DE_RESTAURAR: "de antes de uma restauração",
};

/** "Cópia de segurança automática: 12,3 MB, conferida (1.234 vendas)." */
export function descreverCopia(copia: CopiaGuardada): string {
  const conferida = copia.prova.restaurou
    ? `conferida (${quantas(copia.prova.resumo.vendas, "venda", "vendas")})`
    : `NÃO restaurou na conferência: ${copia.prova.motivo}`;

  return `Cópia de segurança ${ORIGENS[copia.origem]}: ${formatarTamanho(copia.tamanhoBytes)}, ${conferida}.`;
}

/** `850 KB`, `12,3 MB`. */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function quantas(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}

/**
 * "17/10/2026, 14:00" — no relógio da loja.
 *
 * O servidor roda na loja, no fuso dela: o horário que ele escreve é o que o
 * dono vê na parede.
 */
function dataHora(instante: Date): string {
  return instante.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
