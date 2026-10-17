import { mensagemDe } from "@erp/cliente-api";
import { Botao, CampoTexto, formatarDinheiro, formatarQuantidade } from "@erp/ui";
import { type ReactNode, useEffect, useState } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { ProdutoDoBalcao } from "../api/tipos.js";
import { Modal } from "./Modal.js";

/**
 * Procurar produto pelo nome — para o que não tem código de barras.
 *
 * Setas escolhem, Enter lança, Esc volta. A busca vai ao servidor a cada
 * pausa na digitação, e não a cada tecla: o servidor da loja atende os outros
 * caixas também.
 */

/** Pausa na digitação antes de buscar. */
const ESPERA_MS = 250;

export function ModalProcurar(props: {
  readonly api: ApiDoBalcao;
  readonly termoInicial: string;
  readonly aoEscolher: (produto: ProdutoDoBalcao) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const { api } = props;
  const [termo, setTermo] = useState(props.termoInicial);
  const [achados, setAchados] = useState<readonly ProdutoDoBalcao[] | undefined>(
    undefined,
  );
  const [indice, setIndice] = useState(0);
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
        .buscarProdutos({ termo: limpo })
        .then((produtos) => {
          if (!vivo) return;
          setAchados(produtos);
          setIndice(0);
          setErro(undefined);
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

  const escolhido = achados?.[indice];

  return (
    <Modal titulo="Procurar produto" aoFechar={props.aoFechar} largura="larga">
      <CampoTexto
        rotulo="Nome ou código"
        autoComplete="off"
        value={termo}
        onChange={(evento) => {
          setTermo(evento.target.value);
        }}
        onKeyDown={(evento) => {
          if (achados === undefined || achados.length === 0) return;

          if (evento.key === "ArrowDown") {
            evento.preventDefault();
            setIndice((atual) => Math.min(atual + 1, achados.length - 1));
          } else if (evento.key === "ArrowUp") {
            evento.preventDefault();
            setIndice((atual) => Math.max(atual - 1, 0));
          } else if (evento.key === "Enter" && escolhido !== undefined) {
            evento.preventDefault();
            props.aoEscolher(escolhido);
          }
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
          Nenhum produto com esse nome. Confira a escrita ou procure por outra palavra.
        </p>
      ) : (
        <ul
          aria-label="Produtos encontrados"
          className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto"
        >
          {achados.map((produto, posicao) => (
            <li key={produto.id}>
              <button
                type="button"
                aria-current={posicao === indice || undefined}
                className={`grid w-full grid-cols-[1fr_auto] items-baseline gap-2 rounded-md border px-3 py-2 text-left ${
                  posicao === indice ? "border-acao bg-acao-suave" : "border-borda"
                }`}
                onClick={() => {
                  props.aoEscolher(produto);
                }}
              >
                <span className="text-tinta">
                  {produto.descricaoCompleta}
                  <span className="block text-sm text-tinta-suave">
                    Código {produto.sku}
                    {produto.saldo !== undefined &&
                      ` · Estoque: ${formatarQuantidade(produto.saldo)} ${produto.unidade.toLowerCase()}`}
                  </span>
                </span>
                <strong className="font-numero text-tinta">
                  {formatarDinheiro(produto.precoVenda)}
                  {produto.tipo === "PESAVEL" ? "/kg" : ""}
                </strong>
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
