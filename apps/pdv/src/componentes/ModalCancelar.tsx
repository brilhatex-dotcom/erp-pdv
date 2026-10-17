import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useState } from "react";

import { Modal } from "./Modal.js";

/**
 * Cancelar a venda — com motivo, sempre.
 *
 * É a única confirmação do balcão que não é só "tem certeza?": o motivo vai
 * para a auditoria com o nome de quem pediu e de quem liberou, e é o que o
 * dono lê quando a gaveta não bate. Motivos prontos para os casos comuns,
 * porque escrever com a fila parada vira "asdf".
 */

const MOTIVOS = [
  "Cliente desistiu da compra",
  "Item registrado errado",
  "Cliente sem dinheiro suficiente",
  "Venda duplicada",
] as const;

export function ModalCancelar(props: {
  readonly numero: number | undefined;
  readonly total: string;
  readonly concluida: boolean;
  readonly ocupado: boolean;
  readonly aoConfirmar: (motivo: string) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);

  function confirmar(texto: string): void {
    if (texto.trim().length < 3) {
      setErro("Escreva o motivo do cancelamento.");
      return;
    }

    props.aoConfirmar(texto.trim());
  }

  return (
    <Modal
      titulo={
        props.numero === undefined || props.numero === 0
          ? "Cancelar venda"
          : `Cancelar a venda ${String(props.numero)}`
      }
      aoFechar={props.aoFechar}
    >
      <p className="text-tinta">
        {props.concluida
          ? `A venda já foi paga (${formatarDinheiro(props.total)}). Cancelar devolve o estoque e tira o valor do caixa — e você devolve o dinheiro ao cliente.`
          : `A venda de ${formatarDinheiro(props.total)} será descartada.`}
      </p>

      <div role="group" aria-label="Motivos comuns" className="flex flex-col gap-2">
        {MOTIVOS.map((texto) => (
          <Botao
            key={texto}
            tom="secundario"
            disabled={props.ocupado}
            onClick={() => {
              confirmar(texto);
            }}
          >
            {texto}
          </Botao>
        ))}
      </div>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          confirmar(motivo);
        }}
      >
        <CampoTexto
          rotulo="Outro motivo"
          autoComplete="off"
          maxLength={200}
          value={motivo}
          {...(erro === undefined ? {} : { erro })}
          onChange={(evento) => {
            setErro(undefined);
            setMotivo(evento.target.value);
          }}
        />
        <div className="flex gap-3">
          <Botao
            type="submit"
            tom="perigo"
            ocupado={props.ocupado}
            rotuloOcupado="Cancelando…"
          >
            Cancelar a venda
          </Botao>
          <Botao tom="discreto" onClick={props.aoFechar}>
            Voltar (Esc)
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
