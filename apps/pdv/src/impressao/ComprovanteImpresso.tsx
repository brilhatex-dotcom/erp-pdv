import { formatarDinheiro, formatarQuantidade } from "@erp/ui";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

import { enderecoDaImagem } from "../api/servidor.js";
import { PREFIXO_DO_TREINO } from "../modo.js";
import type { Comprovante } from "../api/tipos.js";
import { descreverPagamento } from "../formas.js";
import { avisosDoComprovante } from "./comprovante.js";

/**
 * O comprovante pela impressão do navegador — para a estação sem Agente Local.
 *
 * Renderizado fora da árvore da tela (portal no `body`) e mostrado **só na
 * impressão**: o estilo `@media print` esconde o resto da página. A largura é
 * a do papel configurado, 58 ou 80 mm, e o texto é o mesmo do cupom térmico.
 *
 * Chama `window.print()` ao montar e avisa quando terminou, para a tela tirá-lo
 * do caminho.
 */
export function ComprovanteImpresso(props: {
  readonly comprovante: Comprovante;
  readonly segundaVia: boolean;
  readonly aoTerminar: () => void;
}): ReactNode {
  const { comprovante, segundaVia, aoTerminar } = props;
  const { venda, loja } = comprovante;
  // O comprovante sabe de onde veio: o logotipo do treino mora no banco do treino.
  const prefixo = comprovante.treinamento ? PREFIXO_DO_TREINO : "";

  useEffect(() => {
    // Depois de pintar: imprimir antes faria o navegador mandar a página vazia.
    const sinal = setTimeout(() => {
      window.print();
      aoTerminar();
    }, 0);

    return (): void => {
      clearTimeout(sinal);
    };
  }, [aoTerminar]);

  const avisos = avisosDoComprovante(comprovante, segundaVia);

  return createPortal(
    <section
      aria-label="Comprovante para impressão"
      className="area-impressao font-numero text-[11px] leading-snug text-black"
      style={{ width: comprovante.larguraCupom === 58 ? "56mm" : "76mm" }}
    >
      <header className="text-center">
        {comprovante.logoId !== undefined && (
          <img
            src={enderecoDaImagem(comprovante.logoId, prefixo)}
            alt=""
            className="mx-auto mb-1 max-h-16"
          />
        )}
        <strong className="block">{loja?.nome ?? "COMPROVANTE DE VENDA"}</strong>
        {loja !== undefined && (
          <>
            <span className="block">CNPJ {loja.cnpj}</span>
            <span className="block">{loja.endereco}</span>
            {loja.telefone !== undefined && (
              <span className="block">{loja.telefone}</span>
            )}
          </>
        )}
        {avisos.map((aviso) => (
          <strong key={aviso} className="block">
            *** {aviso} ***
          </strong>
        ))}
      </header>

      <hr className="my-1 border-dashed border-black" />
      <p>
        Venda {venda.numero} ·{" "}
        {new Date(venda.finalizadaEm ?? comprovante.emitidoEm).toLocaleString("pt-BR")}
      </p>
      <p>Operador: {comprovante.operadorNome}</p>
      {comprovante.clienteNome !== undefined && <p>Cliente: {comprovante.clienteNome}</p>}
      <hr className="my-1 border-dashed border-black" />

      <ol>
        {venda.itens.map((item) => (
          <li key={item.numero}>
            <span className="block">
              {String(item.numero).padStart(3, "0")} {item.descricao}
            </span>
            <span className="flex justify-between">
              <span>
                {formatarQuantidade(item.quantidade.milesimos)}{" "}
                {item.quantidade.unidade.toLowerCase()} ×{" "}
                {formatarDinheiro(item.precoUnitario)}
              </span>
              <span>{formatarDinheiro(item.total)}</span>
            </span>
          </li>
        ))}
      </ol>

      <hr className="my-1 border-dashed border-black" />
      {venda.descontoTotal !== "0" && (
        <>
          <p className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatarDinheiro(venda.subtotal)}</span>
          </p>
          <p className="flex justify-between">
            <span>Desconto</span>
            <span>-{formatarDinheiro(venda.descontoTotal)}</span>
          </p>
        </>
      )}
      <p className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatarDinheiro(venda.total)}</span>
      </p>
      {venda.pagamentos.map((pagamento) => (
        <p key={pagamento.indice} className="flex justify-between">
          <span>{descreverPagamento(pagamento.forma, pagamento.confirmacao)}</span>
          <span>{formatarDinheiro(pagamento.valor)}</span>
        </p>
      ))}
      {venda.troco !== "0" && (
        <p className="flex justify-between text-sm font-bold">
          <span>TROCO</span>
          <span>{formatarDinheiro(venda.troco)}</span>
        </p>
      )}

      <footer className="mt-2 text-center">
        <strong className="block">*** SEM VALOR FISCAL ***</strong>
        <span className="block">{comprovante.aviso}</span>
      </footer>
    </section>,
    document.body,
  );
}
