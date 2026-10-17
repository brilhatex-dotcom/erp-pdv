import type { DomainError } from "@erp/domain";

import type { ConfiguracaoDeBackup } from "../../portas/repositorios/RepositoriosBackup.js";
import { type PoliticaDeRetencao, RETENCAO_PADRAO } from "./retencao.js";

/**
 * A agenda de fábrica: de hora em hora, uma cópia a cada fechamento de caixa e
 * as 24 últimas guardadas (ARQUITETURA.md §10.3).
 *
 * Vale desde o primeiro minuto da instalação, sem ninguém abrir a tela: a loja
 * que nunca configurou nada precisa estar tão protegida quanto a que
 * configurou.
 */
export const CONFIGURACAO_DE_BACKUP_PADRAO: ConfiguracaoDeBackup = {
  intervaloHoras: 1,
  aoFecharCaixa: true,
  copiasRecentes: RETENCAO_PADRAO.horarias,
};

/**
 * Os intervalos que a tela oferece.
 *
 * Mais de 24 horas não entra: a loja que perde o banco perderia mais de um dia
 * de vendas, e não há economia de disco que pague isso — a retenção já cuida do
 * espaço. "Desligada" também não: cópia desligada só é descoberta no dia em que
 * o disco queima.
 */
export const INTERVALOS_DE_BACKUP: readonly number[] = [1, 2, 4, 6, 12, 24];

/** A retenção da loja: a de fábrica, com as recentes que o suporte ajustou. */
export function politicaDe(configuracao: ConfiguracaoDeBackup): PoliticaDeRetencao {
  return { ...RETENCAO_PADRAO, horarias: configuracao.copiasRecentes };
}

/** Tamanho da coluna do registro de tentativas. */
const TAMANHO_MAXIMO_DO_ERRO = 500;

/**
 * A frase gravada na tentativa que falhou.
 *
 * Com o detalhe técnico no fim, marcado como do suporte: é a linha que o dono
 * lê ao telefone e que poupa uma ida à loja.
 */
export function textoDoErro(erro: DomainError): string {
  const causa = erro.detalhes?.["causa"];
  const texto =
    typeof causa === "string" && causa !== ""
      ? `${erro.mensagem} Detalhe para o suporte: ${causa}`
      : erro.mensagem;

  return texto.length > TAMANHO_MAXIMO_DO_ERRO
    ? `${texto.slice(0, TAMANHO_MAXIMO_DO_ERRO - 1)}…`
    : texto;
}
