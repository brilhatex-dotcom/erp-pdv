import { Botao, CampoTexto } from "@erp/ui";
import { type ReactNode, useState } from "react";

import type { ItemNoFio, QuantidadeNoFio } from "../api/tipos.js";
import { milesimosDoTexto } from "../leitura.js";
import { Modal } from "./Modal.js";

/**
 * Nova quantidade do item selecionado.
 *
 * Na unidade do item — "3" para três pães, "0,5" para meio quilo. Diminuir
 * pode pedir o supervisor, se a loja quiser assim; quem decide é o servidor.
 */
export function ModalQuantidade(props: {
  readonly item: ItemNoFio;
  readonly ocupado: boolean;
  readonly aoConfirmar: (quantidade: QuantidadeNoFio) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const unidade = props.item.quantidade.unidade;
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);

  return (
    <Modal titulo={`Quantidade de ${props.item.descricao}`} aoFechar={props.aoFechar}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          const milesimos = milesimosDoTexto(texto);

          if (milesimos === undefined) {
            setErro("Digite a quantidade. Exemplo: 3, ou 0,5 para meio quilo.");
            return;
          }

          props.aoConfirmar({ milesimos, unidade });
        }}
      >
        <CampoTexto
          rotulo={`Nova quantidade (${unidade.toLowerCase()})`}
          inputMode="decimal"
          autoComplete="off"
          value={texto}
          {...(erro === undefined ? {} : { erro })}
          onChange={(evento) => {
            setErro(undefined);
            setTexto(evento.target.value.replace(/[^\d,.]/g, ""));
          }}
        />
        <div className="flex gap-3">
          <Botao type="submit" ocupado={props.ocupado} rotuloOcupado="Alterando…">
            Alterar (Enter)
          </Botao>
          <Botao tom="discreto" onClick={props.aoFechar}>
            Voltar (Esc)
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
