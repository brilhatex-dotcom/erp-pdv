import {
  type DomainError,
  err,
  ErroRegraNegocio,
  Identificador,
  ok,
  type Result,
} from "@erp/domain";

import {
  AgendaDeCopias,
  ConsultarCopiasDeSeguranca,
} from "../casos-de-uso/backup/AgendaDeCopias.js";
import {
  ConferirCopiaDeSeguranca,
  FazerCopiaDeSeguranca,
  RestaurarCopiaDeSeguranca,
  TravaDeCopias,
} from "../casos-de-uso/backup/CopiasDeSeguranca.js";
import type {
  ArquivoGerado,
  CopiaGuardada,
  FerramentaDeBackup,
  Manutencao,
  PastaDeCopias,
  ProvaDaCopia,
  ResumoDoBanco,
} from "../casos-de-uso/backup/portas.js";
import type { OrigemDaCopia } from "../portas/repositorios/RepositoriosBackup.js";
import { montarAmbiente } from "./dubles.js";

/**
 * O banco e o disco de mentira das cópias de segurança.
 *
 * A ferramenta falsa não copia nada: devolve o arquivo "gerado" e a prova que
 * o teste mandar. É o que deixa a regra — retenção, recusas, registro de cada
 * tentativa — ser verificada sem `pg_dump`, e sem esperar uma hora pela agenda.
 */

export const ANA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e5c0001").unwrap();

export const RESUMO: ResumoDoBanco = {
  vendas: 1234,
  produtos: 300,
  clientes: 40,
  primeiraVenda: new Date("2026-08-01T10:00:00.000Z"),
  ultimaVenda: new Date("2026-10-17T11:00:00.000Z"),
  caixasAbertos: 0,
  migracoes: ["20260801_inicial", "20261016_balcao"],
};

export class FerramentaFalsa implements FerramentaDeBackup {
  geradas = 0;
  restauradas: string[] = [];
  /** O erro devolvido pelo `gerar`; ausente, gera normalmente. */
  erroAoGerar: DomainError | undefined;
  /** A prova de cada arquivo, pelo caminho; ausente, restaura com o resumo padrão. */
  provas = new Map<string, ProvaDaCopia>();
  provaPadrao: ProvaDaCopia = { restaurou: true, resumo: RESUMO };
  atual: ResumoDoBanco = RESUMO;
  resultadoDaRestauracao: Result<void, DomainError> = ok(undefined);

  /** Atalho dos testes: o `gerar` passa a falhar com o banco fora. */
  falharAoGerar(): void {
    this.erroAoGerar = new ErroRegraNegocio("BACKUP_FALHOU", "O banco não respondeu.");
  }

  gerar(): Promise<Result<ArquivoGerado, DomainError>> {
    if (this.erroAoGerar !== undefined) return Promise.resolve(err(this.erroAoGerar));

    this.geradas += 1;
    return Promise.resolve(
      ok({
        caminho: `/tmp/gerado-${String(this.geradas)}`,
        tamanhoBytes: 12_900_000,
        sha256: "f".repeat(64),
      }),
    );
  }

  provar(caminho: string): Promise<ProvaDaCopia> {
    return Promise.resolve(this.provas.get(caminho) ?? this.provaPadrao);
  }

  resumoAtual(): Promise<ResumoDoBanco> {
    return Promise.resolve(this.atual);
  }

  restaurar(caminho: string): Promise<Result<void, DomainError>> {
    this.restauradas.push(caminho);
    return Promise.resolve(this.resultadoDaRestauracao);
  }
}

export class PastaFalsa implements PastaDeCopias {
  readonly copias = new Map<string, CopiaGuardada>();
  readonly apagadas: string[] = [];

  listar(): Promise<readonly CopiaGuardada[]> {
    return Promise.resolve([...this.copias.values()]);
  }

  guardar(
    gerado: ArquivoGerado,
    dados: {
      readonly origem: OrigemDaCopia;
      readonly criadaEm: Date;
      readonly prova: ProvaDaCopia;
    },
  ): Promise<CopiaGuardada> {
    const copia: CopiaGuardada = {
      nome: `erp-${dados.criadaEm.toISOString()}-${dados.origem.toLowerCase()}.dump`,
      criadaEm: dados.criadaEm,
      origem: dados.origem,
      tamanhoBytes: gerado.tamanhoBytes,
      sha256: gerado.sha256,
      prova: dados.prova,
    };
    this.copias.set(copia.nome, copia);
    return Promise.resolve(copia);
  }

  caminhoDe(nome: string): Promise<string | undefined> {
    return Promise.resolve(this.copias.has(nome) ? `/copias/${nome}` : undefined);
  }

  apagar(nome: string): Promise<void> {
    this.copias.delete(nome);
    this.apagadas.push(nome);
    return Promise.resolve();
  }
}

export class ManutencaoFalsa implements Manutencao {
  ativa = false;
  vezes = 0;

  async durante<T>(acao: () => Promise<T>): Promise<T> {
    this.vezes += 1;
    this.ativa = true;
    try {
      return await acao();
    } finally {
      this.ativa = false;
    }
  }
}

/** Uma promessa que o teste solta quando quiser — a cópia "lenta". */
export function segurar(): {
  readonly presa: Promise<void>;
  readonly soltar: () => void;
} {
  let soltar: () => void = () => undefined;
  const presa = new Promise<void>((resolver) => {
    soltar = resolver;
  });

  return { presa, soltar };
}

/** Os casos de uso das cópias, montados sobre os dublês. */
export function montarCopias(instante = new Date("2026-10-17T13:00:00.000Z")) {
  const ambiente = montarAmbiente(instante);
  const ferramenta = new FerramentaFalsa();
  const pasta = new PastaFalsa();
  const manutencao = new ManutencaoFalsa();
  const trava = new TravaDeCopias();

  const fazer = new FazerCopiaDeSeguranca(
    ferramenta,
    pasta,
    trava,
    ambiente.unitOfWork,
    ambiente.geradorId,
    ambiente.relogio,
  );
  const conferir = new ConferirCopiaDeSeguranca(ferramenta, pasta, trava);
  const restaurar = new RestaurarCopiaDeSeguranca(
    conferir,
    fazer,
    ferramenta,
    manutencao,
    trava,
    ambiente.unitOfWork,
    ambiente.geradorId,
    ambiente.relogio,
  );
  const agenda = new AgendaDeCopias(
    fazer,
    pasta,
    trava,
    ambiente.unitOfWork,
    ambiente.relogio,
  );
  const consultar = new ConsultarCopiasDeSeguranca(pasta, trava, ambiente.unitOfWork);

  return {
    ambiente,
    ferramenta,
    pasta,
    manutencao,
    trava,
    fazer,
    conferir,
    restaurar,
    agenda,
    consultar,
  };
}
