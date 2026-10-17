import { mensagemDe } from "@erp/cliente-api";
import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useEffect, useState } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { VendaRecente } from "../api/tipos.js";
import { horaDe } from "./ModalGuardadas.js";

/**
 * Achar uma venda já feita: as últimas deste caixa, ou pelo número do cupom.
 *
 * Serve à segunda via e à devolução. O número é o que o cliente traz impresso
 * no papel; a lista das últimas resolve o "acabei de passar e o papel enroscou"
 * sem digitar nada.
 */
export function EscolherVenda(props: {
  readonly api: ApiDoBalcao;
  readonly estacaoId: string;
  readonly rotuloAcao: string;
  readonly ocupado: boolean;
  /** Ausente: toda venda serve. */
  readonly serve?: (venda: VendaRecente) => string | undefined;
  readonly aoEscolher: (venda: VendaRecente) => void;
}): ReactNode {
  const { api, estacaoId } = props;
  const [numero, setNumero] = useState("");
  const [procurado, setProcurado] = useState<number | undefined>(undefined);
  const [vendas, setVendas] = useState<readonly VendaRecente[] | undefined>(undefined);
  const [erro, setErro] = useState<string | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    setVendas(undefined);

    api
      .recentes(
        procurado === undefined ? { estacaoId, limite: 10 } : { numero: procurado },
      )
      .then((achadas) => {
        if (!vivo) return;
        setVendas(achadas);
        setErro(undefined);
      })
      .catch((causa: unknown) => {
        if (vivo) setErro(mensagemDe(causa));
      });

    return (): void => {
      vivo = false;
    };
  }, [api, estacaoId, procurado]);

  return (
    <div className="flex flex-col gap-3">
      <form
        noValidate
        className="flex items-end gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          const digitado = Number.parseInt(numero, 10);
          setProcurado(Number.isNaN(digitado) || digitado < 1 ? undefined : digitado);
        }}
      >
        <div className="flex-1">
          <CampoTexto
            rotulo="Número da venda"
            numerico
            maxLength={8}
            ajuda="Está no alto do comprovante. Vazio mostra as últimas deste caixa."
            value={numero}
            onChange={(evento) => {
              setNumero(evento.target.value.replace(/\D/g, ""));
            }}
          />
        </div>
        <Botao type="submit" tom="secundario">
          Procurar
        </Botao>
      </form>

      {erro !== undefined && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}

      {vendas === undefined ? (
        erro === undefined && <p className="text-sm text-tinta-suave">Procurando…</p>
      ) : vendas.length === 0 ? (
        <p className="text-sm text-tinta-suave">
          {procurado === undefined
            ? "Nenhuma venda concluída neste caixa ainda."
            : `Não há venda com o número ${String(procurado)}.`}
        </p>
      ) : (
        <ul
          aria-label="Vendas encontradas"
          className="flex max-h-[45vh] flex-col gap-1 overflow-y-auto"
        >
          {vendas.map((venda) => {
            const recusa = props.serve?.(venda);

            return (
              <li
                key={venda.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border border-borda px-3 py-2"
              >
                <span className="text-tinta">
                  Venda {venda.numero}
                  {venda.status === "CANCELADA" && (
                    <span className="ml-2 rounded bg-erro-suave px-1.5 text-xs text-tinta">
                      cancelada
                    </span>
                  )}
                  <span className="block text-sm text-tinta-suave">
                    {horaDe(venda.finalizadaEm ?? venda.abertaEm)} · {venda.operadorNome}
                    {venda.clienteNome !== undefined && ` · ${venda.clienteNome}`}
                  </span>
                </span>
                <strong className="font-numero text-tinta">
                  {formatarDinheiro(venda.total)}
                </strong>
                {recusa === undefined ? (
                  <Botao
                    tom="secundario"
                    disabled={props.ocupado}
                    onClick={() => {
                      props.aoEscolher(venda);
                    }}
                  >
                    {props.rotuloAcao}
                  </Botao>
                ) : (
                  <span className="text-sm text-tinta-suave">{recusa}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
