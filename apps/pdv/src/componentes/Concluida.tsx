import { Botao, formatarDinheiro } from "@erp/ui";
import type { ReactNode } from "react";

import type { VendaNoFio } from "../api/tipos.js";

/**
 * A venda que acabou de fechar — com o troco em letra de placa.
 *
 * Fica na tela até a próxima bipada, e não some sozinha: é o número que o
 * operador confere na mão enquanto conta as notas, e o cliente confere de
 * longe. A próxima venda começa bipando, sem tecla nenhuma; Enter também serve,
 * para quem gosta de "limpar" a tela antes.
 */

export type EstadoImpressao =
  | { readonly tipo: "NAO_PEDIDA" }
  | { readonly tipo: "IMPRIMINDO" }
  | { readonly tipo: "IMPRESSA" }
  | { readonly tipo: "AVISO"; readonly mensagem: string };

export function Concluida(props: {
  readonly venda: VendaNoFio;
  readonly offline: boolean;
  readonly impressao: EstadoImpressao;
  readonly aoImprimir: () => void;
  readonly aoNovaVenda: () => void;
}): ReactNode {
  const { venda } = props;

  return (
    <section
      aria-label="Venda concluída"
      className="flex flex-col items-center gap-4 rounded-lg border border-ok bg-ok-suave p-6 text-center"
    >
      <p className="text-lg text-tinta">
        {props.offline
          ? "Venda concluída sem conexão — ela vai para o servidor quando a rede voltar"
          : `Venda ${String(venda.numero)} concluída`}{" "}
        · {formatarDinheiro(venda.total)}
      </p>

      {venda.troco === "0" ? (
        <p className="text-3xl font-semibold text-tinta">Sem troco</p>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg text-tinta">Troco</span>
          <strong
            aria-label="Troco a devolver"
            className="font-numero text-7xl font-semibold text-tinta"
          >
            {formatarDinheiro(venda.troco)}
          </strong>
        </div>
      )}

      <Impressao estado={props.impressao} aoImprimir={props.aoImprimir} />

      <div className="flex flex-col items-center gap-2">
        <Botao tamanho="grande" onClick={props.aoNovaVenda}>
          Nova venda (Enter)
        </Botao>
        <p className="text-sm text-tinta-suave">Ou bipe o próximo produto direto.</p>
      </div>
    </section>
  );
}

/**
 * O comprovante, depois da venda gravada.
 *
 * Problema de impressora é **aviso**, nunca erro: a venda aconteceu e o
 * dinheiro entrou. Pintar de vermelho faria o operador refazer a venda — que é
 * como se cobra o cliente duas vezes.
 */
function Impressao(props: {
  readonly estado: EstadoImpressao;
  readonly aoImprimir: () => void;
}): ReactNode {
  switch (props.estado.tipo) {
    case "IMPRIMINDO":
      return (
        <p role="status" className="text-tinta-suave">
          Imprimindo o comprovante…
        </p>
      );

    case "IMPRESSA":
      return (
        <div className="flex items-center gap-3">
          <p role="status" className="text-tinta">
            Comprovante impresso.
          </p>
          <Botao tom="discreto" onClick={props.aoImprimir}>
            Imprimir outra via (Ctrl+P)
          </Botao>
        </div>
      );

    case "AVISO":
      return (
        <div className="flex flex-col items-center gap-2">
          <p
            role="status"
            className="rounded-md border border-atencao bg-atencao-suave px-4 py-2 text-tinta"
          >
            {props.estado.mensagem}
          </p>
          <Botao tom="secundario" onClick={props.aoImprimir}>
            Tentar imprimir de novo (Ctrl+P)
          </Botao>
        </div>
      );

    case "NAO_PEDIDA":
      return (
        <Botao tom="secundario" onClick={props.aoImprimir}>
          Imprimir comprovante (Ctrl+P)
        </Botao>
      );
  }
}
