import type { ConfiguracaoLoja, Devolucao, Identificador } from "@erp/domain";

import type { RegistroAuditoria } from "../../auditoria/tipos.js";

/**
 * Portas do balcão: como a loja vende, o que voltou, e quem fez o quê.
 */

export interface ConfiguracaoLojaRepository {
  /** A configuração da instalação, ou `undefined` antes da primeira gravação. */
  atual(): Promise<ConfiguracaoLoja | undefined>;
  salvar(configuracao: ConfiguracaoLoja): Promise<void>;
}

export interface DevolucaoRepository {
  /**
   * Devoluções de uma venda, da mais antiga para a mais nova.
   *
   * É a pergunta que cada devolução nova faz antes de existir: "quanto deste
   * item já voltou?". Sem ela, o mesmo pão seria devolvido duas vezes.
   */
  porVenda(vendaId: Identificador): Promise<readonly Devolucao[]>;
  salvar(devolucao: Devolucao): Promise<void>;
}

/**
 * Registro de auditoria — só cresce.
 *
 * Não há leitura aqui: quem lê a auditoria é a retaguarda, por consulta, e
 * nenhum caso de uso decide nada a partir dela. Uma porta que só grava é a
 * forma de garantir que ninguém "corrija" um registro pelo caminho.
 */
export interface AuditoriaRepository {
  registrar(registro: RegistroAuditoria): Promise<void>;
}

/** Imagem já conferida, pronta para gravar. */
export interface ImagemParaGravar {
  readonly id: Identificador;
  readonly tipo: "image/png" | "image/jpeg" | "image/webp";
  readonly conteudo: Uint8Array;
  readonly hash: string;
}

export interface ImagemRepository {
  /** A mesma foto enviada de novo devolve a imagem que já existe. */
  porHash(hash: string): Promise<Identificador | undefined>;
  existe(id: Identificador): Promise<boolean>;
  salvar(imagem: ImagemParaGravar): Promise<void>;
}
