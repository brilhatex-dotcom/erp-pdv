import { formatarDinheiro } from "@erp/ui";
import type { ReactNode } from "react";

import { enderecoDaImagem } from "../api/servidor.js";
import type { CategoriaDoBalcao, ProdutoDoBalcao } from "../api/tipos.js";

/**
 * Botões dos produtos sem código de barras — o pão, o sonho, a banana.
 *
 * Nome **e** foto (ou ícone): a foto é o que a pessoa nova acha primeiro, e o
 * nome é o que confirma. O preço vai no botão porque é a pergunta que o
 * cliente faz em seguida. Pesáveis mostram o preço por quilo, e ao tocar abrem
 * o campo de peso.
 */
export function BotoesRapidos(props: {
  readonly categorias: readonly CategoriaDoBalcao[];
  readonly categoriaAtiva: string | undefined;
  readonly produtos: readonly ProdutoDoBalcao[];
  readonly carregando: boolean;
  readonly aoEscolherCategoria: (categoriaId: string | undefined) => void;
  readonly aoEscolherProduto: (produto: ProdutoDoBalcao) => void;
}): ReactNode {
  return (
    <section aria-label="Produtos rápidos" className="flex flex-col gap-3">
      {props.categorias.length > 0 && (
        <div role="group" aria-label="Categorias" className="flex flex-wrap gap-2">
          <Chip
            ativo={props.categoriaAtiva === undefined}
            aoEscolher={() => {
              props.aoEscolherCategoria(undefined);
            }}
          >
            Mais vendidos
          </Chip>
          {props.categorias.map((categoria) => (
            <Chip
              key={categoria.id}
              ativo={props.categoriaAtiva === categoria.id}
              aoEscolher={() => {
                props.aoEscolherCategoria(categoria.id);
              }}
            >
              {categoria.icone !== undefined && (
                <span aria-hidden="true" className="mr-1">
                  {categoria.icone}
                </span>
              )}
              {categoria.nome}
            </Chip>
          ))}
        </div>
      )}

      {props.carregando ? (
        <p className="text-sm text-tinta-suave">Carregando produtos…</p>
      ) : props.produtos.length === 0 ? (
        <p className="rounded-md border border-dashed border-borda p-4 text-center text-sm text-tinta-suave">
          {props.categoriaAtiva === undefined
            ? "Os produtos mais vendidos aparecem aqui depois das primeiras vendas."
            : "Nenhum produto nesta categoria."}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
          {props.produtos.map((produto) => (
            <li key={produto.id}>
              <button
                type="button"
                className="flex h-full min-h-24 w-full flex-col items-center justify-between gap-1 rounded-lg border border-borda bg-papel p-2 text-center hover:bg-acao-suave"
                onClick={() => {
                  props.aoEscolherProduto(produto);
                }}
              >
                {produto.imagemId === undefined ? (
                  <span aria-hidden="true" className="text-2xl text-tinta-suave">
                    {produto.tipo === "PESAVEL" ? "⚖" : "▢"}
                  </span>
                ) : (
                  <img
                    src={enderecoDaImagem(produto.imagemId)}
                    alt=""
                    className="h-12 w-12 rounded object-cover"
                  />
                )}
                <span className="text-sm font-medium leading-tight text-tinta">
                  {produto.descricao}
                </span>
                <span className="font-numero text-sm text-tinta-suave">
                  {formatarDinheiro(produto.precoVenda)}
                  {produto.tipo === "PESAVEL" ? "/kg" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Chip(props: {
  readonly ativo: boolean;
  readonly aoEscolher: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={props.ativo}
      onClick={props.aoEscolher}
      className={`min-h-alvo rounded-full border px-4 text-sm font-medium ${
        props.ativo
          ? "border-acao bg-acao text-papel"
          : "border-borda bg-papel text-tinta hover:bg-acao-suave"
      }`}
    >
      {props.children}
    </button>
  );
}
