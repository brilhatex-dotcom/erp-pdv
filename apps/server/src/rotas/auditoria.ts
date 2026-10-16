import { registrosDeAuditoria } from "@erp/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { recusar } from "../http/entrada.js";

/**
 * O que foi feito, por quem e com a liberação de quem.
 *
 * Exige `auditoria:consultar`, do gerente: a lista mostra os descontos e os
 * cancelamentos de cada operador, e quem pode lê-la pode cobrar por eles.
 */

const consulta = z.object({
  de: z.iso.date().optional(),
  ate: z.iso.date().optional(),
  acao: z
    .string()
    .regex(/^[A-Z_]{3,40}$/)
    .optional(),
  usuarioId: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

export function rotasDeAuditoria(servidor: FastifyInstance, container: Container): void {
  servidor.get(
    "/api/auditoria",
    {
      preHandler: [
        exigirAutenticacao(container),
        exigirPermissao(container, "auditoria:consultar"),
      ],
    },
    async (requisicao, resposta) => {
      const entrada = consulta.safeParse(requisicao.query);
      if (!entrada.success) return recusar(resposta, "Filtro inválido.");

      // O padrão é **hoje**: ninguém abre a auditoria querendo o ano inteiro,
      // e a consulta sem filtro numa loja com dois anos de uso seria lenta.
      const hoje = container.relogio.agora().toISOString().slice(0, 10);
      const de = new Date(`${entrada.data.de ?? hoje}T00:00:00.000Z`);
      const ate = new Date(
        `${entrada.data.ate ?? entrada.data.de ?? hoje}T00:00:00.000Z`,
      );
      // Fim exclusivo e no dia seguinte: `ate=2026-08-01` inclui as 23h do dia.
      ate.setUTCDate(ate.getUTCDate() + 1);

      const registros = await registrosDeAuditoria(container.prisma, {
        de,
        ate,
        acao: entrada.data.acao,
        usuarioId: entrada.data.usuarioId,
        limite: entrada.data.limite,
      });

      return resposta.send({ registros });
    },
  );
}
