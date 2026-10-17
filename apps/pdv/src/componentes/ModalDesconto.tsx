import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useState } from "react";

import type { ItemNoFio } from "../api/tipos.js";
import { CampoDinheiro } from "./CampoDinheiro.js";
import { Modal } from "./Modal.js";

/**
 * Desconto no item selecionado ou na venda inteira.
 *
 * Em reais **ou** em percentual — o balcão pensa dos dois jeitos ("dez por
 * cento", "deixa por vinte"), e converter de cabeça é onde o operador erra.
 * A tela mostra o limite dele antes de digitar: saber que passou de 5% evita
 * a surpresa do pedido de liberação. Quem confere o limite é o servidor.
 */

export interface PedidoDeDesconto {
  readonly numeroItem?: number | undefined;
  readonly valor?: string | undefined;
  readonly percentualBps?: number | undefined;
}

/** `"10"` → 1000; `"2,5"` → 250. */
function pontosBase(texto: string): number | undefined {
  const limpo = texto.trim().replace(".", ",");
  if (!/^\d{1,3}(,\d{1,2})?$/.test(limpo)) return undefined;

  const [inteiro = "0", fracao = ""] = limpo.split(",");
  const bps = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));

  return bps <= 10_000 ? bps : undefined;
}

/** `1050` → "10,5%". */
export function formatarPercentual(bps: number): string {
  const inteiro = Math.trunc(bps / 100);
  const fracao = bps % 100;

  return fracao === 0
    ? `${String(inteiro)}%`
    : `${String(inteiro)},${String(fracao).padStart(2, "0").replace(/0$/, "")}%`;
}

export function ModalDesconto(props: {
  readonly item: ItemNoFio | undefined;
  readonly totalDaVenda: string;
  readonly limiteItemBps: number | undefined;
  readonly limiteVendaBps: number | undefined;
  readonly ocupado: boolean;
  readonly aoConfirmar: (pedido: PedidoDeDesconto) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const [alvo, setAlvo] = useState<"ITEM" | "VENDA">(
    props.item === undefined ? "VENDA" : "ITEM",
  );
  const [modo, setModo] = useState<"PERCENTUAL" | "VALOR">("PERCENTUAL");
  const [percentual, setPercentual] = useState("");
  const [valor, setValor] = useState("0");
  const [erro, setErro] = useState<string | undefined>(undefined);

  const limite = alvo === "ITEM" ? props.limiteItemBps : props.limiteVendaBps;
  const base = alvo === "ITEM" ? (props.item?.totalBruto ?? "0") : props.totalDaVenda;

  function confirmar(): void {
    const numeroItem = alvo === "ITEM" ? props.item?.numero : undefined;

    if (modo === "PERCENTUAL") {
      const bps = pontosBase(percentual);
      if (bps === undefined) {
        setErro("Digite o percentual. Exemplo: 10, ou 2,5.");
        return;
      }
      props.aoConfirmar({ numeroItem, percentualBps: bps });
      return;
    }

    props.aoConfirmar({ numeroItem, valor });
  }

  return (
    <Modal titulo="Desconto" aoFechar={props.aoFechar}>
      <div role="group" aria-label="Onde aplicar" className="flex gap-2">
        <Botao
          tom={alvo === "ITEM" ? "primario" : "secundario"}
          aria-pressed={alvo === "ITEM"}
          disabled={props.item === undefined}
          onClick={() => {
            setAlvo("ITEM");
          }}
        >
          No item {props.item === undefined ? "" : `· ${props.item.descricao}`}
        </Botao>
        <Botao
          tom={alvo === "VENDA" ? "primario" : "secundario"}
          aria-pressed={alvo === "VENDA"}
          onClick={() => {
            setAlvo("VENDA");
          }}
        >
          Na venda inteira
        </Botao>
      </div>

      <p className="text-sm text-tinta-suave">
        Sobre {formatarDinheiro(base)}.{" "}
        {limite === undefined
          ? "Você pode dar qualquer desconto."
          : `Seu limite é ${formatarPercentual(limite)}. Acima disso, o supervisor libera.`}
      </p>

      <div role="group" aria-label="Como informar" className="flex gap-2">
        <Botao
          tom={modo === "PERCENTUAL" ? "primario" : "secundario"}
          aria-pressed={modo === "PERCENTUAL"}
          onClick={() => {
            setModo("PERCENTUAL");
          }}
        >
          Em %
        </Botao>
        <Botao
          tom={modo === "VALOR" ? "primario" : "secundario"}
          aria-pressed={modo === "VALOR"}
          onClick={() => {
            setModo("VALOR");
          }}
        >
          Em R$
        </Botao>
      </div>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          confirmar();
        }}
      >
        {modo === "PERCENTUAL" ? (
          <CampoTexto
            rotulo="Percentual de desconto"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={percentual}
            {...(erro === undefined ? {} : { erro })}
            onChange={(evento) => {
              setErro(undefined);
              setPercentual(evento.target.value.replace(/[^\d,.]/g, ""));
            }}
          />
        ) : (
          <CampoDinheiro
            rotulo="Valor do desconto"
            valor={valor}
            autoFocus
            aoMudar={setValor}
            ajuda="Zero tira o desconto."
          />
        )}
        <div className="flex gap-3">
          <Botao type="submit" ocupado={props.ocupado} rotuloOcupado="Aplicando…">
            Aplicar (Enter)
          </Botao>
          <Botao tom="discreto" onClick={props.aoFechar}>
            Voltar (Esc)
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
