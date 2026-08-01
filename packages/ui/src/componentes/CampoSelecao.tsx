import { type ReactNode, type Ref, type SelectHTMLAttributes, useId } from "react";

import { juntarClasses } from "../juntarClasses.js";

export interface OpcaoSelecao {
  readonly valor: string;
  readonly rotulo: string;
}

export interface PropsCampoSelecao extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "children"
> {
  readonly ref?: Ref<HTMLSelectElement>;
  readonly rotulo: string;
  readonly opcoes: readonly OpcaoSelecao[];
  /** Mensagem de erro. Presente = campo inválido. */
  readonly erro?: string;
  /** Explicação curta abaixo do campo. Some quando há erro. */
  readonly ajuda?: string;
}

/**
 * Seleção entre opções conhecidas.
 *
 * É `<select>` nativo, e não uma lista construída à mão. A lista custom parece
 * melhor na captura de tela e é pior em tudo o que importa aqui: o nativo abre
 * com o teclado, filtra ao digitar a primeira letra, é lido corretamente por
 * leitor de tela e vira roda de rolagem no celular sem uma linha de código.
 *
 * Não há opção vazia automática: quando o campo é obrigatório, quem chama passa
 * um valor inicial. "Selecione…" como estado válido é o que produz cadastro
 * salvo pela metade quando alguém esquece de conferir no servidor.
 */
export function CampoSelecao({
  ref,
  rotulo,
  opcoes,
  erro,
  ajuda,
  className,
  required,
  ...resto
}: PropsCampoSelecao): ReactNode {
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

      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={invalido || undefined}
        aria-describedby={invalido ? idErro : ajuda !== undefined ? idAjuda : undefined}
        className={juntarClasses(
          "min-h-alvo rounded-md border bg-papel px-3 text-base text-tinta",
          "disabled:cursor-not-allowed disabled:opacity-55",
          invalido ? "border-erro" : "border-borda",
          className,
        )}
        {...resto}
      >
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>

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
