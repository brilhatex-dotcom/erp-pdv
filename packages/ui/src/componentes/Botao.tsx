import type { ButtonHTMLAttributes, ReactNode } from "react";

import { juntarClasses } from "../juntarClasses.js";

export type TomBotao = "primario" | "secundario" | "perigo" | "discreto";
export type TamanhoBotao = "normal" | "grande";

export interface PropsBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tom?: TomBotao;
  readonly tamanho?: TamanhoBotao;
  /**
   * Em andamento.
   *
   * Desabilita **e** anuncia. Um botão que só fica cinza durante a gravação
   * deixa o operador clicando de novo — e no PDV isso é venda duplicada.
   */
  readonly ocupado?: boolean;
  /** Texto lido enquanto ocupado. Padrão: "Aguarde". */
  readonly rotuloOcupado?: string;
  readonly children: ReactNode;
}

const TONS: Record<TomBotao, string> = {
  primario: "bg-acao text-papel hover:bg-acao-forte border-transparent",
  secundario: "bg-papel text-tinta hover:bg-papel-fundo border-borda",
  perigo: "bg-erro text-papel hover:brightness-90 border-transparent",
  discreto: "bg-transparent text-acao hover:bg-acao-suave border-transparent",
};

const TAMANHOS: Record<TamanhoBotao, string> = {
  // `min-h-alvo` garante os 44px do WCAG 2.5.5 mesmo quando o texto é curto.
  normal: "min-h-alvo px-4 text-base",
  grande: "min-h-14 px-6 text-lg",
};

/**
 * Botão.
 *
 * Três decisões que valem registro:
 *
 * 1. **`type="button"` por padrão.** O padrão do HTML é `submit`, e um botão
 *    de "adicionar item" dentro de um formulário enviaria a venda inteira sem
 *    que ninguém tivesse pedido.
 * 2. **Ocupado desabilita e anuncia.** Ver `ocupado` acima.
 * 3. **Cor nunca é a única pista.** O tom de perigo muda a cor e o texto do
 *    botão continua dizendo o que ele faz — quem não distingue vermelho de
 *    verde continua sabendo o que está prestes a apagar.
 */
export function Botao({
  tom = "primario",
  tamanho = "normal",
  ocupado = false,
  rotuloOcupado = "Aguarde",
  disabled,
  className,
  children,
  type,
  ...resto
}: PropsBotao): ReactNode {
  const desabilitado = disabled === true || ocupado;

  return (
    <button
      type={type ?? "button"}
      disabled={desabilitado}
      aria-busy={ocupado || undefined}
      className={juntarClasses(
        "inline-flex items-center justify-center gap-2 rounded-md border font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        TONS[tom],
        TAMANHOS[tamanho],
        className,
      )}
      {...resto}
    >
      {ocupado ? (
        <>
          <Girando />
          <span>{rotuloOcupado}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Indicador de progresso. `aria-hidden` porque o texto ao lado já anuncia. */
function Girando(): ReactNode {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
