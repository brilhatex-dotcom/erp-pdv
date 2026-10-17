import { Dinheiro } from "@erp/domain";

import type { QuantidadeNoFio } from "./api/tipos.js";
import { milesimosDoTexto } from "./leitura.js";

/**
 * Peso digitado à mão, em gramas ou em quilos.
 *
 * Balança de balcão simples mostra "350 g"; a de prato, "0,350 kg". O
 * operador escolhe a unidade que está lendo, e a conversão para o quilo do
 * preço é do **servidor** — a conta que decide quanto o cliente paga não pode
 * depender do navegador.
 */

export type UnidadeDePeso = "G" | "KG";

/** `350` g → 350 000 milésimos de grama; `0,350` kg → 350 milésimos de quilo. */
export function pesoNoFio(
  texto: string,
  unidade: UnidadeDePeso,
): QuantidadeNoFio | undefined {
  if (unidade === "G") {
    const gramas = texto.trim();
    if (!/^\d{1,6}$/.test(gramas) || BigInt(gramas) === 0n) return undefined;

    return { milesimos: (BigInt(gramas) * 1000n).toString(), unidade: "G" };
  }

  const milesimos = milesimosDoTexto(texto);

  return milesimos === undefined ? undefined : { milesimos, unidade: "KG" };
}

/**
 * Quanto o peso vai custar — **só para mostrar** antes de confirmar.
 *
 * Usa a mesma aritmética do domínio (`Dinheiro.escalar`, meio-para-cima), e
 * por isso o número da prévia é o mesmo que o servidor vai cobrar. Quem
 * cobra continua sendo o servidor: a prévia não vai para lugar nenhum.
 */
export function previaDoPeso(
  precoPorQuiloCentavos: string,
  peso: QuantidadeNoFio,
): string {
  const milesimosDeQuilo =
    peso.unidade === "G" ? BigInt(peso.milesimos) / 1000n : BigInt(peso.milesimos);

  return Dinheiro.deCentavos(BigInt(precoPorQuiloCentavos))
    .unwrap()
    .escalar(milesimosDeQuilo, 1000n)
    .centavos.toString();
}
