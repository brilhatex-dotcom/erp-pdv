import { type InputHTMLAttributes, type ReactNode, type Ref, useId } from "react";

import { juntarClasses } from "../juntarClasses.js";

export interface PropsCampoTexto extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id"
> {
  /**
   * Referência ao `<input>`.
   *
   * Existe para devolver o foco depois de um erro — no balcão, obrigar o
   * operador a encontrar o campo de novo com o mouse é atrito puro. No React 19
   * `ref` é prop comum em componente de função, sem `forwardRef`.
   */
  readonly ref?: Ref<HTMLInputElement>;
  readonly rotulo: string;
  /** Mensagem de erro. Presente = campo inválido. */
  readonly erro?: string;
  /** Explicação curta abaixo do campo. Some quando há erro. */
  readonly ajuda?: string;
  /**
   * Só dígitos, com teclado numérico no celular e sem autocorreção.
   *
   * Vale para matrícula, PIN, código de barras e quantidade — que é quase todo
   * campo deste produto.
   */
  readonly numerico?: boolean;
}

/**
 * Campo de texto com rótulo, ajuda e erro.
 *
 * O rótulo é **obrigatório** e é sempre visível — nunca só `placeholder`.
 * Placeholder como rótulo some no instante em que o operador começa a digitar,
 * e quem foi interrompido no meio do preenchimento não descobre mais o que
 * aquele campo pedia. Também não é lido de forma confiável por leitor de tela.
 *
 * O erro é ligado ao campo por `aria-describedby` e anunciado por `role
 * ="alert"`: quem não vê a borda vermelha ainda assim ouve o que houve.
 */
export function CampoTexto({
  ref,
  rotulo,
  erro,
  ajuda,
  numerico = false,
  className,
  required,
  ...resto
}: PropsCampoTexto): ReactNode {
  const id = useId();
  const idErro = `${id}-erro`;
  const idAjuda = `${id}-ajuda`;
  const invalido = erro !== undefined && erro !== "";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-tinta">
        {rotulo}
        {required === true && (
          <>
            {" "}
            <span className="text-erro" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(obrigatório)</span>
          </>
        )}
      </label>

      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={invalido || undefined}
        aria-describedby={invalido ? idErro : ajuda !== undefined ? idAjuda : undefined}
        {...(numerico
          ? {
              inputMode: "numeric" as const,
              autoComplete: "off",
              autoCorrect: "off",
              spellCheck: false,
            }
          : {})}
        className={juntarClasses(
          "min-h-alvo rounded-md border bg-papel px-3 text-base text-tinta",
          "placeholder:text-tinta-suave disabled:cursor-not-allowed disabled:opacity-55",
          numerico && "font-numero tracking-wide",
          invalido ? "border-erro" : "border-borda",
          className,
        )}
        {...resto}
      />

      {invalido ? (
        <p id={idErro} role="alert" className="text-sm text-erro">
          {erro}
        </p>
      ) : (
        ajuda !== undefined && (
          <p id={idAjuda} className="text-sm text-tinta-suave">
            {ajuda}
          </p>
        )
      )}
    </div>
  );
}
