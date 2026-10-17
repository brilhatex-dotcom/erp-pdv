import { mensagemDe } from "@erp/cliente-api";
import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useEffect, useState } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { VendaNoFio } from "../api/tipos.js";
import { Modal } from "./Modal.js";

/**
 * Guardar a venda e atender o próximo — e retomar depois.
 *
 * É o "esqueci o leite, já volto" do mercadinho e a comanda da padaria: a fila
 * não espera o cliente que voltou à gôndola. A venda guardada continua aberta
 * no servidor, com itens e preços, e qualquer caixa a retoma.
 *
 * Uma janela só para as duas coisas, na tecla F7: com venda na tela, o campo do
 * nome vem primeiro; sem venda, a lista. O nome é opcional — "Mesa 3", "moça
 * de vermelho" — porque obrigar a escrever com a fila parada vira "aaa".
 */
export function ModalGuardadas(props: {
  readonly api: ApiDoBalcao;
  readonly estacaoId: string;
  readonly atual: VendaNoFio | undefined;
  readonly ocupado: boolean;
  readonly aoGuardar: (rotulo: string) => void;
  readonly aoRetomar: (venda: VendaNoFio) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const { api, estacaoId } = props;
  const [guardadas, setGuardadas] = useState<readonly VendaNoFio[] | undefined>(
    undefined,
  );
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [rotulo, setRotulo] = useState("");

  useEffect(() => {
    let vivo = true;

    api
      .abertas(estacaoId)
      .then((abertas) => {
        if (vivo) setGuardadas(abertas.filter((venda) => venda.suspensao !== undefined));
      })
      .catch((causa: unknown) => {
        if (vivo) setErro(mensagemDe(causa));
      });

    return (): void => {
      vivo = false;
    };
  }, [api, estacaoId]);

  const podeGuardar = props.atual !== undefined && props.atual.itens.length > 0;

  return (
    <Modal titulo="Vendas guardadas" aoFechar={props.aoFechar} largura="larga">
      {podeGuardar && (
        <form
          noValidate
          className="flex flex-col gap-3 rounded-md border border-borda bg-papel-fundo p-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            props.aoGuardar(rotulo.trim());
          }}
        >
          <CampoTexto
            rotulo="Nome para lembrar (opcional)"
            autoComplete="off"
            maxLength={40}
            ajuda="Exemplo: Mesa 3, ou o nome do cliente."
            value={rotulo}
            onChange={(evento) => {
              setRotulo(evento.target.value);
            }}
          />
          <div>
            <Botao type="submit" ocupado={props.ocupado} rotuloOcupado="Guardando…">
              Guardar a venda da tela (Enter)
            </Botao>
          </div>
        </form>
      )}

      {erro !== undefined && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}

      {guardadas === undefined ? (
        erro === undefined && <p className="text-sm text-tinta-suave">Procurando…</p>
      ) : guardadas.length === 0 ? (
        <p className="text-sm text-tinta-suave">Nenhuma venda guardada neste caixa.</p>
      ) : (
        <>
          {podeGuardar && (
            <p className="text-sm text-tinta-suave">
              Para retomar uma destas, guarde ou conclua antes a venda da tela.
            </p>
          )}
          <ul aria-label="Vendas guardadas" className="flex flex-col gap-1">
            {guardadas.map((venda) => (
              <li
                key={venda.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border border-borda px-3 py-2"
              >
                <span className="text-tinta">
                  {venda.suspensao?.rotulo ?? `Venda ${String(venda.numero)}`}
                  <span className="block text-sm text-tinta-suave">
                    {quantosItens(venda.itens.length)} · guardada às{" "}
                    {horaDe(venda.suspensao?.em ?? venda.abertaEm)}
                  </span>
                </span>
                <strong className="font-numero text-tinta">
                  {formatarDinheiro(venda.total)}
                </strong>
                <Botao
                  tom="secundario"
                  disabled={podeGuardar || props.ocupado}
                  onClick={() => {
                    props.aoRetomar(venda);
                  }}
                >
                  Retomar
                </Botao>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex gap-3">
        <Botao tom="discreto" onClick={props.aoFechar}>
          Voltar (Esc)
        </Botao>
      </div>
    </Modal>
  );
}

function quantosItens(quantidade: number): string {
  return quantidade === 1 ? "1 item" : `${String(quantidade)} itens`;
}

/** `"2026-10-17T13:05:00Z"` → `"10:05"`, no fuso da estação. */
export function horaDe(instante: string): string {
  return new Date(instante).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
