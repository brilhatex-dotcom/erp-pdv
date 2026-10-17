import type { AgendaDeCopias } from "@erp/application";
import type { FastifyInstance } from "fastify";

import type { ManutencaoDoServidor } from "../composicao/manutencao.js";

/**
 * Enquanto o banco é trocado por uma cópia, a API responde 503.
 *
 * Só a API: as telas continuam sendo servidas, para a retaguarda que pediu a
 * restauração não virar página em branco. E 503, e não erro de regra: o caixa
 * trata como servidor fora do ar e passa a vender pela fila da estação.
 */
export function recusarDuranteManutencao(
  servidor: FastifyInstance,
  manutencao: ManutencaoDoServidor,
): void {
  servidor.addHook("onRequest", async (requisicao, resposta) => {
    if (!manutencao.ativa || !requisicao.url.startsWith("/api/")) return;

    await resposta
      .status(503)
      .header("retry-after", "60")
      .send({
        erro: {
          codigo: "EM_MANUTENCAO",
          mensagem:
            "O sistema está voltando de uma cópia de segurança e volta em alguns minutos. O caixa continua vendendo enquanto isso.",
        },
      });

    return resposta;
  });
}

const UM_MINUTO_MS = 60_000;

/**
 * A batida do relógio da agenda das cópias, a cada minuto.
 *
 * Quem decide se é hora de copiar é a agenda; aqui só se bate. O relógio não
 * segura o processo de pé — quem decide quando o servidor para é o serviço do
 * Windows —, e para junto com o servidor.
 */
export function baterAgendaDeCopias(
  servidor: FastifyInstance,
  agenda: Pick<AgendaDeCopias, "verificar">,
  intervaloMs = UM_MINUTO_MS,
): void {
  let relogio: NodeJS.Timeout | undefined;

  servidor.addHook("onReady", () => {
    relogio = setInterval(() => {
      void agenda.verificar();
    }, intervaloMs);
    relogio.unref();

    return Promise.resolve();
  });

  servidor.addHook("onClose", () => {
    clearInterval(relogio);

    return Promise.resolve();
  });
}
