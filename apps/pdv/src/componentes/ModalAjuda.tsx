import { Botao } from "@erp/ui";
import type { ReactNode } from "react";

import type { ExemploDeCodigo } from "../api/tipos.js";
import { CodigosParaTreinar } from "./CodigosParaTreinar.js";
import { Modal } from "./Modal.js";

/**
 * As teclas do caixa e, na primeira vez, como vender.
 *
 * A orientação inicial cabe numa tela, em quatro passos: quem precisa de mais
 * que isso para a primeira venda encontrou um defeito de tela, não uma lacuna
 * de treinamento. Ela aparece sozinha **uma vez por estação** e depois mora no
 * F1, junto com a lista de teclas.
 */

const CHAVE_VISTA = "erp.pdv.orientacao-vista";

const ATALHOS: readonly (readonly [string, string])[] = [
  ["Enter", "Lança o código digitado. No campo vazio, vai para o pagamento"],
  ["3*código", "Lança três unidades de uma vez"],
  ["F1", "Esta ajuda"],
  ["F2", "Procurar produto pelo nome"],
  ["F3", "Mudar a quantidade do item selecionado"],
  ["F4", "Desconto no item ou na venda"],
  ["F6", "Cliente da venda (para o fiado)"],
  ["F7", "Guardar a venda, ou retomar uma guardada"],
  ["F8", "Tirar o item selecionado"],
  ["F9", "Cancelar a venda"],
  ["F10", "Receber (pagamento)"],
  ["↑ ↓", "Escolher o item da lista"],
  ["Ctrl+P", "Imprimir o comprovante da última venda"],
  ["Esc", "Voltar"],
];

/** A orientação já apareceu nesta estação? */
export function orientacaoJaVista(): boolean {
  try {
    return globalThis.localStorage.getItem(CHAVE_VISTA) === "sim";
  } catch {
    // Navegador sem armazenamento (modo privado restrito): melhor não mostrar
    // a orientação de novo a cada recarga do que travar a tela por isso.
    return true;
  }
}

export function marcarOrientacaoVista(): void {
  try {
    globalThis.localStorage.setItem(CHAVE_VISTA, "sim");
  } catch {
    // Idem: a orientação é conveniência, não pode virar erro de venda.
  }
}

export function ModalAjuda(props: {
  readonly primeiraVez: boolean;
  /** No treino: os códigos que valem como a bipada (ADR-0026). */
  readonly exemplos?: readonly ExemploDeCodigo[] | undefined;
  readonly aoFechar: () => void;
}): ReactNode {
  return (
    <Modal
      titulo={props.primeiraVez ? "Bem-vindo ao caixa" : "Ajuda do caixa"}
      aoFechar={props.aoFechar}
      largura="larga"
    >
      {props.primeiraVez && (
        <ol
          aria-label="Como vender"
          className="flex list-decimal flex-col gap-1 pl-6 text-tinta"
        >
          <li>Bipe o produto, ou digite o código ou o nome e aperte Enter.</li>
          <li>Produto de peso abre o campo do peso: digite o que a balança mostra.</li>
          <li>Acabou? Aperte Enter no campo vazio e escolha a forma de pagamento.</li>
          <li>
            O troco aparece grande na tela. Errou? F8 tira o item, F9 cancela a venda.
          </li>
        </ol>
      )}

      <table className="w-full text-left text-sm">
        <caption className="sr-only">Teclas do caixa</caption>
        <tbody>
          {ATALHOS.map(([tecla, oQue]) => (
            <tr key={tecla} className="border-b border-borda">
              <th scope="row" className="py-1 pr-4 font-numero font-semibold text-tinta">
                {tecla}
              </th>
              <td className="py-1 text-tinta">{oQue}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {props.exemplos !== undefined && <CodigosParaTreinar exemplos={props.exemplos} />}

      <p className="text-sm text-tinta-suave">
        Todos os comandos também estão nos botões da tela. Se a tela travar, aperte F5: a
        venda em andamento volta sozinha.
      </p>

      <div>
        <Botao tamanho="grande" onClick={props.aoFechar}>
          Entendi
        </Botao>
      </div>
    </Modal>
  );
}
