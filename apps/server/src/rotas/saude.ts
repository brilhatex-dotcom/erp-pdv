import type { FastifyInstance } from "fastify";

import type { Container } from "../composicao/container.js";

/**
 * Verificação de saúde.
 *
 * Duas rotas com papéis distintos, e a diferença importa para o instalador:
 *
 * - `/saude` responde se o **processo** está de pé. Barata, sem tocar no banco.
 * - `/saude/pronto` responde se ele consegue **atender**, o que inclui o banco.
 *
 * Confundir as duas é o que faz um supervisor de processo reiniciar o servidor
 * em loop porque o Postgres demorou a subir — derrubando o PDV junto.
 */
export function rotasDeSaude(servidor: FastifyInstance, container: Container): void {
  servidor.get("/saude", async (_requisicao, resposta) =>
    resposta.send({ estado: "ok", em: container.relogio.agora().toISOString() }),
  );

  servidor.get("/saude/pronto", async (_requisicao, resposta) => {
    try {
      await container.prisma.$queryRaw`SELECT 1`;
      return await resposta.send({ estado: "pronto", banco: "ok" });
    } catch {
      // 503, não 500: é indisponibilidade temporária, e o cliente deve repetir.
      return await resposta.status(503).send({ estado: "indisponivel", banco: "falha" });
    }
  });
}
