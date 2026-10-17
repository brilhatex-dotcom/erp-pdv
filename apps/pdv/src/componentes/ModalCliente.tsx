import { mensagemDe } from "@erp/cliente-api";
import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useEffect, useState } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { ClienteDoBalcao } from "../api/tipos.js";
import { Modal } from "./Modal.js";

/**
 * Pôr o cliente na venda — opcional, sempre.
 *
 * A venda de balcão é anônima; o cliente entra quando serve a alguma coisa: o
 * fiado, o histórico de compras. Por isso a lista mostra o que decide o
 * fiado — o quanto ainda cabe — e não o extrato de ninguém.
 */

const ESPERA_MS = 250;

export function ModalCliente(props: {
  readonly api: ApiDoBalcao;
  readonly atual: { readonly nome: string } | undefined;
  readonly ocupado: boolean;
  readonly aoEscolher: (cliente: ClienteDoBalcao) => void;
  readonly aoTirar: () => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const { api } = props;
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<readonly ClienteDoBalcao[] | undefined>(
    undefined,
  );
  const [erro, setErro] = useState<string | undefined>(undefined);

  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2) {
      setAchados(undefined);
      return;
    }

    let vivo = true;
    const espera = setTimeout(() => {
      api
        .buscarClientes(limpo)
        .then((clientes) => {
          if (vivo) {
            setAchados(clientes);
            setErro(undefined);
          }
        })
        .catch((causa: unknown) => {
          if (vivo) setErro(mensagemDe(causa));
        });
    }, ESPERA_MS);

    return (): void => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [api, termo]);

  return (
    <Modal titulo="Cliente da venda" aoFechar={props.aoFechar} largura="larga">
      {props.atual !== undefined && (
        <div className="flex items-center justify-between rounded-md border border-borda bg-papel-fundo px-3 py-2">
          <span>
            Na venda: <strong>{props.atual.nome}</strong>
          </span>
          <Botao tom="discreto" onClick={props.aoTirar} disabled={props.ocupado}>
            Tirar cliente
          </Botao>
        </div>
      )}

      <CampoTexto
        rotulo="Nome do cliente"
        autoComplete="off"
        value={termo}
        onChange={(evento) => {
          setTermo(evento.target.value);
        }}
      />

      {erro !== undefined && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}

      {termo.trim().length < 2 ? (
        <p className="text-sm text-tinta-suave">Digite ao menos duas letras do nome.</p>
      ) : achados === undefined ? (
        <p className="text-sm text-tinta-suave">Procurando…</p>
      ) : achados.length === 0 ? (
        <p className="text-sm text-tinta-suave">
          Nenhum cliente com esse nome. O cadastro de cliente novo é feito na retaguarda.
        </p>
      ) : (
        <ul
          aria-label="Clientes encontrados"
          className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto"
        >
          {achados.map((cliente) => (
            <li key={cliente.id}>
              <button
                type="button"
                disabled={props.ocupado}
                className="grid w-full grid-cols-[1fr_auto] items-baseline gap-2 rounded-md border border-borda px-3 py-2 text-left hover:bg-acao-suave"
                onClick={() => {
                  props.aoEscolher(cliente);
                }}
              >
                <span className="text-tinta">
                  {cliente.nome}
                  {cliente.documento !== undefined && (
                    <span className="block text-sm text-tinta-suave">
                      {cliente.documento}
                    </span>
                  )}
                </span>
                <span className="text-right text-sm text-tinta-suave">
                  {cliente.vendeAPrazo ? (
                    <>
                      Fiado disponível
                      <strong className="block font-numero text-tinta">
                        {formatarDinheiro(cliente.disponivel)}
                      </strong>
                    </>
                  ) : (
                    "Sem fiado"
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <Botao tom="discreto" onClick={props.aoFechar}>
          Voltar (Esc)
        </Botao>
      </div>
    </Modal>
  );
}
