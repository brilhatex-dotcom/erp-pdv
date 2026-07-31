import type { DomainError, Result } from "@erp/domain";

import type { ErroInfraestrutura } from "../../erros/ErroInfraestrutura.js";
import type { Repositorios } from "../repositorios/Repositorios.js";

/**
 * Executa um trabalho dentro de **uma transação**.
 *
 * O caso de uso recebe os repositórios já ligados à transação e devolve um
 * `Result`. Devolver erro **desfaz tudo** — inclusive a gravação na outbox.
 *
 * É isso que garante a atomicidade que a venda exige: gravar a venda, baixar o
 * estoque, creditar o caixa e enfileirar o evento fiscal acontecem juntos, ou
 * não acontecem. Meio caminho aqui significa estoque baixado de venda que não
 * existe, ou nota fiscal de venda revertida.
 */
export interface UnitOfWork {
  transacao<T, E extends DomainError>(
    trabalho: (repositorios: Repositorios) => Promise<Result<T, E>>,
  ): Promise<Result<T, E | ErroInfraestrutura>>;
}
