import { type ReactNode, useId } from "react";

export interface OpcaoDeSelecao {
  readonly valor: string;
  readonly rotulo: string;
}

export interface PropsCampoSelecao {
  readonly rotulo: string;
  /** Explicação curta abaixo do campo. */
  readonly ajuda?: string | undefined;
  readonly valor: string;
  readonly opcoes: readonly OpcaoDeSelecao[];
  readonly aoMudar: (valor: string) => void;
  readonly required?: boolean | undefined;
  /**
   * Campo travado.
   *
   * Existe para a tela que o usuário **pode ver e não pode alterar** — o
   * cadastro da empresa aberto por quem não tem `config:empresa`. Esconder o
   * valor esconderia informação que ele precisa conferir; deixá-lo editável
   * produziria um erro do servidor depois de tudo preenchido.
   */
  readonly disabled?: boolean | undefined;
}

/**
 * Escolha entre opções conhecidas, com rótulo visível.
 *
 * `<select>` nativo de propósito. Uma lista customizada teria que reimplementar
 * teclado, leitor de tela e o comportamento de rolagem do celular — e o
 * resultado seria pior que o nativo em todos os três. O produto atende balcão,
 * onde a mão vai do teclado ao leitor de código: componente que só responde a
 * mouse é veto do papel UX.
 *
 * O rótulo é obrigatório e sempre visível, pelo mesmo motivo de `CampoTexto`:
 * quem foi interrompido no meio do preenchimento não descobre mais o que aquele
 * campo pedia.
 */
export function CampoSelecao({
  rotulo,
  ajuda,
  valor,
  opcoes,
  aoMudar,
  required,
  disabled,
}: PropsCampoSelecao): ReactNode {
  const id = useId();
  const idAjuda = `${id}-ajuda`;

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
        id={id}
        required={required}
        disabled={disabled}
        value={valor}
        aria-describedby={ajuda === undefined ? undefined : idAjuda}
        onChange={(evento) => {
          aoMudar(evento.target.value);
        }}
        className="min-h-alvo rounded-md border border-borda bg-papel px-3 text-base text-tinta disabled:cursor-not-allowed disabled:opacity-55"
      >
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>

      {ajuda !== undefined && (
        <p id={idAjuda} className="text-sm text-tinta-suave">
          {ajuda}
        </p>
      )}
    </div>
  );
}
