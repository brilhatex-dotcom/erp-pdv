import { Botao } from "@erp/ui";
import type { ReactNode } from "react";

import { Modal } from "./Modal.js";

/**
 * Confirmação de uma ação que desfaz trabalho — e só dessas.
 *
 * O balcão confirma pouco de propósito: janela de "tem certeza?" em toda tecla
 * ensina o operador a apertar Enter sem ler, e aí a confirmação que importa
 * passa batida. Esta aparece para tirar item e desistir da venda offline, onde
 * o engano custa rebipar ou repesar.
 *
 * O foco abre no botão de confirmar: Enter confirma, Esc volta.
 */
export function ModalConfirmar(props: {
  readonly titulo: string;
  readonly children: ReactNode;
  readonly rotuloConfirmar: string;
  readonly ocupado: boolean;
  readonly rotuloOcupado: string;
  readonly aoConfirmar: () => void;
  readonly aoFechar: () => void;
}): ReactNode {
  return (
    <Modal titulo={props.titulo} aoFechar={props.aoFechar}>
      <div className="flex flex-col gap-2 text-tinta">{props.children}</div>
      <div className="flex gap-3">
        {/* Sempre no tom de perigo: só se confirma o que desfaz trabalho. */}
        <Botao
          tom="perigo"
          tamanho="grande"
          ocupado={props.ocupado}
          rotuloOcupado={props.rotuloOcupado}
          onClick={props.aoConfirmar}
        >
          {props.rotuloConfirmar} (Enter)
        </Botao>
        <Botao tom="discreto" tamanho="grande" onClick={props.aoFechar}>
          Voltar (Esc)
        </Botao>
      </div>
    </Modal>
  );
}
