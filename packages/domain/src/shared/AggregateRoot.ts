import type { DomainEvent } from "./DomainEvent.js";
import { Entity } from "./Entity.js";

/**
 * Raiz de agregado: a única porta de entrada para um conjunto de objetos que
 * mudam juntos e precisam permanecer consistentes.
 *
 * `Venda` é a raiz de seus itens e pagamentos; nada altera um item sem passar
 * pela venda. É isso que garante que o total nunca fique divergente da soma dos
 * itens — a invariante mora num lugar só.
 *
 * A raiz também **acumula os eventos** do que aconteceu com ela. Os eventos não
 * são publicados na hora: ficam guardados até a transação ser confirmada, e só
 * então o Unit of Work os grava na outbox, na mesma transação do dado
 * (ARQUITETURA.md §11.3).
 *
 * Publicar durante a operação criaria o pior defeito possível nesse fluxo: um
 * evento de venda emitido para uma venda que a transação acabou revertendo — ou
 * seja, nota fiscal de venda que não existe.
 */
export abstract class AggregateRoot extends Entity {
  readonly #eventos: DomainEvent[] = [];

  /** Registra um fato ocorrido. Chamado apenas de dentro do agregado. */
  protected registrarEvento(evento: DomainEvent): void {
    this.#eventos.push(evento);
  }

  /** Eventos pendentes, somente leitura. */
  get eventos(): readonly DomainEvent[] {
    return this.#eventos;
  }

  get temEventosPendentes(): boolean {
    return this.#eventos.length > 0;
  }

  /**
   * Entrega os eventos acumulados e esvazia a fila.
   *
   * Devolver e limpar num passo só evita a corrida em que o Unit of Work lê a
   * lista, algo registra um evento novo, e a limpeza descarta o que nunca foi
   * publicado.
   */
  coletarEventos(): DomainEvent[] {
    return this.#eventos.splice(0, this.#eventos.length);
  }
}
