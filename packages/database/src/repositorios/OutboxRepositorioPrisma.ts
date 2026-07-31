import type { OutboxRepository } from "@erp/application";
import type { DomainEvent } from "@erp/domain";

import type { Prisma, PrismaClient } from "../../gerado/index.js";
import { serializarEvento } from "../mapeadores/eventoMapeador.js";

type ClientePrisma = PrismaClient | Prisma.TransactionClient;

/**
 * Fila de eventos a entregar (ADR-0006).
 *
 * Gravada na **mesma transação** do dado que a originou. É isso que impede os
 * dois piores defeitos do fluxo de venda: a venda gravar e o evento sumir — o
 * cliente leva a mercadoria e a nota nunca é emitida — ou o inverso, nota
 * emitida para uma venda que a transação reverteu, que só se resolve com
 * carta de correção.
 */
export class OutboxRepositorioPrisma implements OutboxRepository {
  constructor(private readonly prisma: ClientePrisma) {}

  async enfileirar(eventos: readonly DomainEvent[]): Promise<void> {
    if (eventos.length === 0) return;

    await this.prisma.eventoOutbox.createMany({
      data: eventos.map((evento) => ({
        // O evento não tem identidade própria: quem a tem é a linha da fila.
        id: crypto.randomUUID(),
        tipo: evento.tipo,
        agregadoId: evento.agregadoId.valor,
        payload: serializarEvento(evento),
        ocorridoEm: evento.ocorridoEm,
      })),
    });
  }
}
