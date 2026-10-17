import { BYTES_ALEATORIOS_UUID_V7, montarUuidV7 } from "@erp/domain";

/**
 * Identificador novo, sorteado na estação — UUIDv7, como todo identificador do
 * sistema (ADR-0008).
 *
 * É a chave que torna o pagamento **idempotente**: a resposta que se perdeu no
 * caminho faz o operador apertar Enter de novo, e a segunda tentativa leva a
 * mesma chave. O servidor reconhece e devolve o pagamento que já tinha — em
 * vez de cobrar o cliente duas vezes.
 */
export function novoIdentificador(): string {
  const aleatorios = crypto.getRandomValues(new Uint8Array(BYTES_ALEATORIOS_UUID_V7));

  return montarUuidV7(Date.now(), aleatorios).unwrap().valor;
}
