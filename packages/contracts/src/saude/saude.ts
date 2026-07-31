import { z } from "zod";

import { zDataHora } from "../comuns/escalares.js";

/**
 * Saúde e prontidão do servidor.
 *
 * São dois contratos, não um, porque respondem perguntas diferentes e quem
 * pergunta é diferente:
 *
 * - **`/saude`** — "o processo está vivo?" Não toca o banco. É o que o serviço
 *   do Windows consulta para decidir reiniciar; se dependesse do banco, uma
 *   indisponibilidade momentânea do PostgreSQL derrubaria a aplicação junto,
 *   transformando um problema que se resolve sozinho em loja parada.
 * - **`/pronto`** — "consegue atender?" Verifica as dependências. É o que o
 *   instalador consulta ao final e o que o PDV usa para decidir entrar em
 *   contingência (ARQUITETURA.md §12.1) e o atualizador para verificar saúde
 *   pós-atualização (§13.6).
 */

export const zRespostaSaude = z.object({
  status: z.literal("ok"),
  /** Versão instalada. É a primeira pergunta de qualquer atendimento remoto. */
  versao: z.string().min(1),
  /**
   * Hora do servidor.
   *
   * Exposta de propósito: relógio errado na máquina da loja é causa real de
   * defeito fiscal, e comparar com a hora da estação detecta isso antes de a
   * nota ser rejeitada (ARQUITETURA.md §11.5).
   */
  agora: zDataHora,
  /** Quanto tempo o processo está no ar, em segundos. */
  tempoNoArSegundos: z.number().nonnegative(),
});

export type RespostaSaude = z.infer<typeof zRespostaSaude>;

export const zVerificacao = z.object({
  ok: z.boolean(),
  /** Tempo da verificação. Latência crescente antecede a falha. */
  latenciaMs: z.number().nonnegative(),
});

export type Verificacao = z.infer<typeof zVerificacao>;

export const zRespostaProntidao = z.object({
  pronto: z.boolean(),
  verificacoes: z.object({
    banco: zVerificacao,
  }),
});

export type RespostaProntidao = z.infer<typeof zRespostaProntidao>;
