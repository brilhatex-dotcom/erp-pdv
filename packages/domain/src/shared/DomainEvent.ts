import type { Identificador } from "./Identificador.js";

/**
 * Fato de negócio que já aconteceu.
 *
 * Nome sempre no **passado** (`VendaFinalizada`, não `FinalizarVenda`): evento
 * não é pedido, é registro. Quem reage a ele não pode recusá-lo.
 *
 * É o mecanismo que mantém os contextos desacoplados: `FinalizarVenda` não
 * conhece emissão fiscal nem financeiro — publica `VendaFinalizada`, e quem
 * precisa reage. Sem isso, cada funcionalidade nova acabaria dentro do caso de
 * uso da venda, que é justamente o caminho mais crítico do sistema.
 *
 * `ocorridoEm` é **recebido**, nunca lido do relógio aqui: o domínio não conhece
 * infraestrutura, e tempo injetado é o que torna o teste determinístico.
 */
export interface DomainEvent {
  /** Identifica o tipo do fato. Usado no roteamento e na tabela de outbox. */
  readonly tipo: string;

  /** Agregado que produziu o fato. */
  readonly agregadoId: Identificador;

  /** Quando aconteceu, segundo o relógio injetado. */
  readonly ocorridoEm: Date;
}
