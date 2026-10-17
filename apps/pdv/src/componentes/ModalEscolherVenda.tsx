import { Botao } from "@erp/ui";
import type { ReactNode } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { VendaRecente } from "../api/tipos.js";
import { EscolherVenda } from "./EscolherVenda.js";
import { Modal } from "./Modal.js";

/**
 * Escolher uma venda já feita para fazer algo com ela — a segunda via, o
 * cancelamento depois de concluída.
 *
 * A segunda via sai marcada como **segunda via** no alto do papel, e sem abrir
 * a gaveta: é papel, não dinheiro. Venda cancelada também reimprime — e sai
 * marcada como cancelada, que é o que o cliente leva quando pede o estorno.
 */
export function ModalEscolherVenda(props: {
  readonly titulo: string;
  readonly rotuloAcao: string;
  readonly api: ApiDoBalcao;
  readonly estacaoId: string;
  readonly ocupado: boolean;
  readonly serve?: (venda: VendaRecente) => string | undefined;
  readonly aoEscolher: (venda: VendaRecente) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  return (
    <Modal titulo={props.titulo} aoFechar={props.aoFechar} largura="larga">
      <EscolherVenda
        api={props.api}
        estacaoId={props.estacaoId}
        rotuloAcao={props.rotuloAcao}
        ocupado={props.ocupado}
        {...(props.serve === undefined ? {} : { serve: props.serve })}
        aoEscolher={props.aoEscolher}
      />
      <div>
        <Botao tom="discreto" onClick={props.aoFechar}>
          Voltar (Esc)
        </Botao>
      </div>
    </Modal>
  );
}
