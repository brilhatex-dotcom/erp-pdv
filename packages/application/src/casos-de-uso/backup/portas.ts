import type { DomainError, Result } from "@erp/domain";

import type { OrigemDaCopia } from "../../portas/repositorios/RepositoriosBackup.js";

/**
 * As portas da cópia de segurança.
 *
 * O caso de uso decide **quando** copiar, **quanto** guardar e **o que** conta
 * como cópia boa; quem sabe falar com o PostgreSQL e com o disco é a
 * infraestrutura. É o que deixa a regra testável sem banco — e a troca de
 * `pg_dump` por outra ferramenta, um dia, sem mexer em regra nenhuma.
 */

/** O que dá para saber de um banco sem abri-lo tabela por tabela. */
export interface ResumoDoBanco {
  readonly vendas: number;
  readonly produtos: number;
  readonly clientes: number;
  readonly primeiraVenda?: Date | undefined;
  readonly ultimaVenda?: Date | undefined;
  /**
   * Caixas abertos. No banco de agora, é o aviso antes de restaurar: o caixa
   * aberto depois da cópia some junto com o resto.
   */
  readonly caixasAbertos: number;
  /** As migrações aplicadas, em ordem: a versão do banco. */
  readonly migracoes: readonly string[];
}

/**
 * A prova de que a cópia restaura.
 *
 * Só a restauração de verdade prova: um arquivo que existe e tem o tamanho
 * certo pode estar truncado, e só se descobre no dia em que ele é preciso.
 */
export type ProvaDaCopia =
  | { readonly restaurou: true; readonly resumo: ResumoDoBanco }
  | { readonly restaurou: false; readonly motivo: string };

export interface CopiaGuardada {
  readonly nome: string;
  readonly criadaEm: Date;
  readonly origem: OrigemDaCopia;
  readonly tamanhoBytes: number;
  /** Do arquivo, em hexadecimal: o que mostra que ele não mudou desde então. */
  readonly sha256: string;
  readonly prova: ProvaDaCopia;
}

/** O arquivo recém-gerado, ainda fora da pasta das cópias. */
export interface ArquivoGerado {
  readonly caminho: string;
  readonly tamanhoBytes: number;
  readonly sha256: string;
}

/** O banco, visto pela cópia de segurança. */
export interface FerramentaDeBackup {
  /** Gera o arquivo da cópia, consistente, sem parar a loja. */
  gerar(): Promise<Result<ArquivoGerado, DomainError>>;
  /**
   * Restaura numa base descartável, resume, e descarta a base.
   *
   * **Não lança**: a cópia que não restaura é uma resposta, e não uma falha —
   * o motivo vai na prova.
   */
  provar(caminho: string): Promise<ProvaDaCopia>;
  /** O resumo do banco em uso — para comparar com o da cópia. */
  resumoAtual(): Promise<ResumoDoBanco>;
  /** Troca o banco em uso pelo da cópia. Tudo ou nada. */
  restaurar(caminho: string): Promise<Result<void, DomainError>>;
}

/** Onde as cópias ficam guardadas. */
export interface PastaDeCopias {
  listar(): Promise<readonly CopiaGuardada[]>;
  guardar(
    gerado: ArquivoGerado,
    dados: {
      readonly origem: OrigemDaCopia;
      readonly criadaEm: Date;
      readonly prova: ProvaDaCopia;
    },
  ): Promise<CopiaGuardada>;
  /** O arquivo da cópia; `undefined` quando não há cópia com esse nome. */
  caminhoDe(nome: string): Promise<string | undefined>;
  /**
   * Tira a cópia da pasta. **Não lança**: o arquivo que o antivírus segura
   * agora sai na próxima cópia, e a cópia nova, que já está boa, não pode ser
   * dada como falha por causa da velha.
   */
  apagar(nome: string): Promise<void>;
}

/**
 * O servidor fechado para a loja enquanto o banco é trocado.
 *
 * Durante a ação, quem chamar a API recebe "em manutenção" — e o caixa, que
 * trata isso como servidor fora do ar, continua vendendo pela fila da estação.
 */
export interface Manutencao {
  durante<T>(acao: () => Promise<T>): Promise<T>;
}
