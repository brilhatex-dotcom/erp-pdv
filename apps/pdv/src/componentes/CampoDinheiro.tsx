import { formatarDinheiro } from "@erp/ui";
import { type ReactNode, type Ref, useId } from "react";

/**
 * Campo de dinheiro no jeito da maquininha: os dígitos entram pela direita.
 *
 * Digitar `2`, `0`, `0`, `0` mostra R$ 0,02 → R$ 0,20 → R$ 2,00 → R$ 20,00.
 * É o que a maquininha de cartão e o aplicativo do banco fazem, então o
 * operador já sabe usar — e acaba a dúvida de onde fica a vírgula, que num
 * teclado numérico de balcão nem sempre está onde se espera. O valor aparece
 * formatado o tempo todo, e é isso que evita confundir 1000 com 10000.
 *
 * O valor trafega como **centavos em texto**, como todo dinheiro do sistema.
 */

/** Teto de onze dígitos: R$ 999.999.999,99 — muito acima de qualquer venda. */
const DIGITOS_MAXIMOS = 11;

/** Só os dígitos, sem zeros à esquerda: `"R$ 0,020"` → `"20"`. */
export function centavosDoTexto(texto: string): string {
  const digitos = texto.replace(/\D/g, "").replace(/^0+/, "").slice(0, DIGITOS_MAXIMOS);

  return digitos === "" ? "0" : digitos;
}

export interface PropsCampoDinheiro {
  readonly rotulo: string;
  /** Centavos em texto. */
  readonly valor: string;
  readonly aoMudar: (centavos: string) => void;
  readonly aoConfirmar?: () => void;
  readonly ajuda?: string;
  readonly erro?: string;
  readonly autoFocus?: boolean;
  readonly ref?: Ref<HTMLInputElement>;
  readonly grande?: boolean;
}

export function CampoDinheiro(props: PropsCampoDinheiro): ReactNode {
  const id = useId();
  const idAjuda = `${id}-ajuda`;
  const invalido = props.erro !== undefined && props.erro !== "";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-tinta">
        {props.rotulo}
      </label>
      <input
        ref={props.ref}
        id={id}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        autoFocus={props.autoFocus}
        aria-invalid={invalido || undefined}
        aria-describedby={props.ajuda !== undefined || invalido ? idAjuda : undefined}
        value={formatarDinheiro(props.valor)}
        // Selecionar tudo ao entrar: o valor sugerido (o que falta pagar) é
        // trocado pela primeira tecla, sem apagar dígito por dígito.
        onFocus={(evento) => {
          evento.target.select();
        }}
        onChange={(evento) => {
          props.aoMudar(centavosDoTexto(evento.target.value));
        }}
        onKeyDown={(evento) => {
          if (evento.key === "Enter" && props.aoConfirmar !== undefined) {
            evento.preventDefault();
            props.aoConfirmar();
          }
        }}
        className={`min-h-alvo rounded-md border bg-papel px-3 text-right font-numero text-tinta ${
          props.grande === true ? "min-h-16 text-3xl font-semibold" : "text-xl"
        } ${invalido ? "border-erro" : "border-borda"}`}
      />
      {(invalido || props.ajuda !== undefined) && (
        <p
          id={idAjuda}
          role={invalido ? "alert" : undefined}
          className={`text-sm ${invalido ? "text-erro" : "text-tinta-suave"}`}
        >
          {invalido ? props.erro : props.ajuda}
        </p>
      )}
    </div>
  );
}
