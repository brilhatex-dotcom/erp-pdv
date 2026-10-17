import { formatarDinheiro } from "@erp/ui";
import type { ReactNode } from "react";

import type { VendaNoFio } from "../api/tipos.js";

/**
 * Subtotal, descontos, total, pago, falta e troco — sempre na tela.
 *
 * O total é o maior número da tela porque é o que o cliente lê de longe, e a
 * falta ganha cor quando há o que receber: é a pergunta que o operador faz a
 * cada pagamento ("quanto falta?"). Desconto só aparece quando existe — uma
 * linha "Desconto R$ 0,00" em toda venda vira ruído e esconde a que importa.
 */
export function PainelTotais({
  venda,
}: {
  readonly venda: VendaNoFio | undefined;
}): ReactNode {
  const subtotal = venda?.subtotal ?? "0";
  const desconto = venda?.descontoTotal ?? "0";
  const pago = venda?.totalPago ?? "0";
  const falta = venda?.faltaPagar ?? "0";
  const troco = venda?.troco ?? "0";

  return (
    <section
      aria-label="Totais da venda"
      className="flex flex-col gap-2 rounded-lg border border-borda bg-papel p-4"
    >
      <Linha rotulo="Subtotal" valor={subtotal} />
      {desconto !== "0" && <Linha rotulo="Descontos" valor={`-${desconto}`} />}

      <div className="flex items-baseline justify-between border-t border-borda pt-2">
        <span className="text-tinta-suave">Total</span>
        {/* `aria-live`: o total muda a cada bipada sem que o foco saia do campo
            de código, e quem usa leitor de tela precisa ouvir a mudança. */}
        <strong
          aria-label="Total da venda"
          aria-live="polite"
          className="font-numero text-total font-semibold leading-none text-tinta"
        >
          {formatarDinheiro(venda?.total ?? "0")}
        </strong>
      </div>

      {pago !== "0" && (
        <>
          <Linha rotulo="Pago" valor={pago} />
          <div
            className={`flex items-baseline justify-between rounded-md px-2 py-1 ${
              falta === "0" ? "" : "bg-atencao-suave"
            }`}
          >
            <span className="text-tinta">Falta</span>
            <strong aria-label="Falta pagar" className="font-numero text-xl text-tinta">
              {formatarDinheiro(falta)}
            </strong>
          </div>
        </>
      )}

      {troco !== "0" && (
        <div className="flex items-baseline justify-between rounded-md bg-ok-suave px-2 py-1">
          <span className="text-tinta">Troco</span>
          <strong aria-label="Troco" className="font-numero text-2xl text-tinta">
            {formatarDinheiro(troco)}
          </strong>
        </div>
      )}
    </section>
  );
}

function Linha(props: { readonly rotulo: string; readonly valor: string }): ReactNode {
  const negativo = props.valor.startsWith("-");
  const valor = negativo ? props.valor.slice(1) : props.valor;

  return (
    <div className="flex items-baseline justify-between text-tinta-suave">
      <span>{props.rotulo}</span>
      <span className="font-numero">
        {negativo ? "- " : ""}
        {formatarDinheiro(valor)}
      </span>
    </div>
  );
}
