import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";

/**
 * Janela por cima do balcão — para pedir uma coisa só e voltar.
 *
 * ### Teclado primeiro
 *
 * Abre com o foco no primeiro campo, prende o Tab dentro dela (o operador não
 * se perde atrás da janela) e fecha no Esc. Ao fechar, o foco volta para onde
 * estava — o campo de código —, e a próxima bipada funciona sem tocar no
 * mouse. Exigir o mouse no PDV é veto do papel UX (CLAUDE.md §1).
 *
 * ### Sem animação
 *
 * O balcão não tem tempo para transição, e uma janela que desliza atrasa a
 * leitura do que ela pede.
 *
 * ### O erro aparece dentro da janela
 *
 * A recusa do servidor ao que a janela pediu — o desconto acima do permitido,
 * a sangria sem saldo — é mostrada nela, e não na tela de trás, que o fundo
 * escuro esconde. A tela de venda fornece o erro por `ErroDaJanela`, e toda
 * janela o exibe sem precisar repassá-lo de mão em mão.
 */

/** O erro da última operação, para a janela aberta exibir. */
export const ErroDaJanela = createContext<string | undefined>(undefined);

const FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PropsModal {
  readonly titulo: string;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
  readonly largura?: "normal" | "larga";
}

export function Modal(props: PropsModal): ReactNode {
  const idTitulo = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const erro = useContext(ErroDaJanela);
  const { aoFechar } = props;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const primeiro = caixa.current?.querySelector<HTMLElement>(FOCAVEIS);
    primeiro?.focus();

    return (): void => {
      anterior?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-tinta/40 p-4 pt-[8vh]"
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.preventDefault();
          evento.stopPropagation();
          aoFechar();
          return;
        }

        if (evento.key === "Tab") prenderTab(evento);
      }}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={`flex w-full flex-col gap-4 rounded-lg border border-borda bg-papel p-6 shadow-flutuante ${
          props.largura === "larga" ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <h2 id={idTitulo} className="text-xl font-semibold text-tinta">
          {props.titulo}
        </h2>
        {erro !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
          >
            {erro}
          </p>
        )}
        {props.children}
      </div>
    </div>
  );
}

/**
 * Tab no último volta ao primeiro, e Shift+Tab no primeiro vai ao último.
 *
 * Toda janela do balcão tem ao menos o botão de voltar, e por isso sempre há
 * primeiro e último.
 */
function prenderTab(evento: {
  readonly shiftKey: boolean;
  readonly currentTarget: HTMLElement;
  readonly preventDefault: () => void;
}): void {
  const focaveis = [...evento.currentTarget.querySelectorAll<HTMLElement>(FOCAVEIS)];
  const primeiro = focaveis[0];
  const ultimo = focaveis.at(-1);
  if (primeiro === undefined || ultimo === undefined) return;

  if (evento.shiftKey && document.activeElement === primeiro) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && document.activeElement === ultimo) {
    evento.preventDefault();
    primeiro.focus();
  }
}
