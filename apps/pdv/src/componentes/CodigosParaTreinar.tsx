import type { ReactNode } from "react";

import type { ExemploDeCodigo } from "../api/tipos.js";

/** Os códigos que valem como a bipada, para treinar sem leitor e sem mercadoria. */
export function CodigosParaTreinar(props: {
  readonly exemplos: readonly ExemploDeCodigo[];
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-semibold text-tinta">Sem leitor? Digite no campo do caixa:</p>
      <ul className="flex flex-col gap-1">
        {props.exemplos.map((exemplo) => (
          <li key={exemplo.codigo} className="flex flex-wrap gap-x-3">
            <span className="font-numero text-tinta">{exemplo.codigo}</span>
            <span className="text-tinta-suave">{exemplo.descricao}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
