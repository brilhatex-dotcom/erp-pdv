import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useState } from "react";

import type { QuantidadeNoFio } from "../api/tipos.js";
import { pesoNoFio, previaDoPeso, type UnidadeDePeso } from "../peso.js";
import { Modal } from "./Modal.js";

/**
 * O peso do produto pesável — digitado do visor da balança.
 *
 * Mostra o nome, o **preço por quilo** e a conta antes de confirmar: "350 g ×
 * R$ 20,00/kg = R$ 7,00". O operador confere a conta com o cliente olhando,
 * que é como se pega o zero a mais antes de ele virar R$ 70,00.
 *
 * A unidade é escolhida por quem lê a balança: gramas (o visor diz 350) ou
 * quilos (o visor diz 0,350). Tecla G e K trocam sem tirar a mão do teclado.
 */
export function ModalPeso(props: {
  readonly produto: { readonly descricao: string; readonly precoVenda: string };
  readonly ocupado: boolean;
  readonly aoConfirmar: (peso: QuantidadeNoFio) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const [texto, setTexto] = useState("");
  const [unidade, setUnidade] = useState<UnidadeDePeso>("G");
  const [erro, setErro] = useState<string | undefined>(undefined);

  const peso = pesoNoFio(texto, unidade);
  const previa =
    peso === undefined ? undefined : previaDoPeso(props.produto.precoVenda, peso);

  function confirmar(): void {
    if (peso === undefined) {
      setErro(
        unidade === "G"
          ? "Digite o peso em gramas, só números. Exemplo: 350."
          : "Digite o peso em quilos. Exemplo: 0,350.",
      );
      return;
    }

    props.aoConfirmar(peso);
  }

  return (
    <Modal titulo={`Peso de ${props.produto.descricao}`} aoFechar={props.aoFechar}>
      <p className="text-tinta-suave">
        Preço por quilo:{" "}
        <strong className="font-numero text-tinta">
          {formatarDinheiro(props.produto.precoVenda)}/kg
        </strong>
      </p>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          confirmar();
        }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <CampoTexto
              rotulo={unidade === "G" ? "Peso em gramas" : "Peso em quilos"}
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              {...(erro === undefined ? {} : { erro })}
              onChange={(evento) => {
                setErro(undefined);
                setTexto(evento.target.value.replace(/[^\d,.]/g, ""));
              }}
              onKeyDown={(evento) => {
                const tecla = evento.key.toLowerCase();
                if (tecla === "g" || tecla === "k") {
                  evento.preventDefault();
                  setUnidade(tecla === "g" ? "G" : "KG");
                }
              }}
            />
          </div>
          <div role="group" aria-label="Unidade do peso" className="flex gap-1">
            <Botao
              tom={unidade === "G" ? "primario" : "secundario"}
              aria-pressed={unidade === "G"}
              onClick={() => {
                setUnidade("G");
              }}
            >
              g
            </Botao>
            <Botao
              tom={unidade === "KG" ? "primario" : "secundario"}
              aria-pressed={unidade === "KG"}
              onClick={() => {
                setUnidade("KG");
              }}
            >
              kg
            </Botao>
          </div>
        </div>

        <p aria-live="polite" className="min-h-6 text-lg text-tinta">
          {peso !== undefined && previa !== undefined && (
            <>
              {texto} {unidade === "G" ? "g" : "kg"} ×{" "}
              {formatarDinheiro(props.produto.precoVenda)}
              /kg = <strong className="font-numero">{formatarDinheiro(previa)}</strong>
            </>
          )}
        </p>

        <div className="flex gap-3">
          <Botao
            type="submit"
            tamanho="grande"
            ocupado={props.ocupado}
            rotuloOcupado="Lançando…"
          >
            Lançar (Enter)
          </Botao>
          <Botao tom="discreto" tamanho="grande" onClick={props.aoFechar}>
            Voltar (Esc)
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
