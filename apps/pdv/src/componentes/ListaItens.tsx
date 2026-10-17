import { formatarDinheiro, formatarQuantidade } from "@erp/ui";
import { type ReactNode, useEffect, useRef } from "react";

import type { ItemNoFio } from "../api/tipos.js";

/**
 * Os itens da venda, o mais recente no alto.
 *
 * Ordem invertida porque é no alto que o operador olha para conferir que
 * registrou o produto certo. O item **selecionado** — por padrão, o último
 * lido — é o alvo de F3 (quantidade), F4 (desconto) e F8 (tirar). Setas para
 * cima e para baixo trocam a seleção sem tirar o foco do campo de código.
 */
export function ListaItens(props: {
  readonly itens: readonly ItemNoFio[];
  readonly selecionado: number | undefined;
  /** O item que a última leitura criou ou engordou. */
  readonly destaque: { readonly numero: number; readonly somado: boolean } | undefined;
  readonly aoSelecionar: (numero: number) => void;
}): ReactNode {
  const linhaSelecionada = useRef<HTMLLIElement>(null);

  useEffect(() => {
    linhaSelecionada.current?.scrollIntoView({ block: "nearest" });
  }, [props.selecionado]);

  if (props.itens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-borda p-6 text-center text-tinta-suave">
        Bipe o primeiro produto, ou digite o nome e aperte Enter.
      </p>
    );
  }

  return (
    <ol aria-label="Itens da venda" className="flex flex-col gap-1 overflow-y-auto">
      {[...props.itens].reverse().map((item) => {
        const selecionado = item.numero === props.selecionado;
        const destacado = item.numero === props.destaque?.numero;
        const comDesconto = item.desconto !== "0" || item.descontoRateado !== "0";

        return (
          <li
            key={item.numero}
            ref={selecionado ? linhaSelecionada : undefined}
            aria-current={selecionado || undefined}
            className={`grid cursor-pointer grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-3 rounded-md border px-3 py-2 ${
              selecionado ? "border-acao bg-acao-suave" : "border-borda bg-papel"
            }`}
            onClick={() => {
              props.aoSelecionar(item.numero);
            }}
          >
            <span className="font-numero text-sm text-tinta-suave">{item.numero}</span>
            <span className="text-tinta">
              {item.descricao}
              {destacado && props.destaque.somado && (
                <span className="ml-2 rounded bg-ok-suave px-1.5 text-xs text-tinta">
                  somado
                </span>
              )}
              <span className="block font-numero text-sm text-tinta-suave">
                {formatarQuantidade(item.quantidade.milesimos)}{" "}
                {item.quantidade.unidade.toLowerCase()} ×{" "}
                {formatarDinheiro(item.precoUnitario)}
                {comDesconto && " · com desconto"}
              </span>
            </span>
            <strong className="font-numero text-lg text-tinta">
              {formatarDinheiro(item.total)}
            </strong>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A última leitura, em letra grande.
 *
 * É a confirmação do bipe: o operador olha para cima, lê o nome e o valor, e
 * segue. Quando a leitura somou a um item que já estava na venda, a frase diz
 * isso — "2 un" sozinho não conta se foi o segundo bipe ou um engano.
 */
export function UltimaLeitura(props: {
  readonly item: ItemNoFio | undefined;
  readonly somado: boolean;
}): ReactNode {
  if (props.item === undefined) return null;

  const { item } = props;

  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-baseline justify-between gap-4 rounded-lg border border-acao bg-acao-suave px-4 py-3"
    >
      <span className="text-xl font-semibold text-tinta">
        {item.descricao}
        <span className="ml-3 font-numero text-base font-normal text-tinta-suave">
          {formatarQuantidade(item.quantidade.milesimos)}{" "}
          {item.quantidade.unidade.toLowerCase()} × {formatarDinheiro(item.precoUnitario)}
          {props.somado && " (somado ao que já estava)"}
        </span>
      </span>
      <strong className="font-numero text-2xl text-tinta">
        {formatarDinheiro(item.total)}
      </strong>
    </p>
  );
}
