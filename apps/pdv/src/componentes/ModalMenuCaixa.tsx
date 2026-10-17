import type { ReactNode } from "react";

import { Botao } from "@erp/ui";

import { Modal } from "./Modal.js";

/**
 * O que acontece algumas vezes por dia, fora da venda.
 *
 * Fora das teclas F de propósito: sangria e fechamento não são gesto de quem
 * está com cliente na frente, e uma tecla de função para eles é uma tecla a
 * mais para apertar por engano no meio da venda. Aqui cada opção tem um
 * número, e o menu abre por um botão sempre visível no alto da tela.
 */

export type OpcaoDoMenu =
  | "SUPRIMENTO"
  | "SANGRIA"
  | "REIMPRIMIR"
  | "DEVOLUCAO"
  | "CANCELAR_CONCLUIDA"
  | "FECHAR_CAIXA"
  | "TROCAR_OPERADOR";

interface Opcao {
  readonly codigo: OpcaoDoMenu;
  readonly tecla: string;
  readonly rotulo: string;
  readonly explicacao: string;
  /** Some no meio da venda: deixaria o atendimento pela metade. */
  readonly foraDaVenda: boolean;
}

const OPCOES: readonly Opcao[] = [
  {
    codigo: "SUPRIMENTO",
    tecla: "1",
    rotulo: "Suprimento",
    explicacao: "Pôr dinheiro na gaveta",
    foraDaVenda: false,
  },
  {
    codigo: "SANGRIA",
    tecla: "2",
    rotulo: "Sangria",
    explicacao: "Tirar dinheiro da gaveta",
    foraDaVenda: false,
  },
  {
    codigo: "REIMPRIMIR",
    tecla: "3",
    rotulo: "Reimprimir comprovante",
    explicacao: "Segunda via de uma venda",
    foraDaVenda: false,
  },
  {
    codigo: "DEVOLUCAO",
    tecla: "4",
    rotulo: "Devolução",
    explicacao: "Cliente devolvendo produto",
    foraDaVenda: false,
  },
  {
    codigo: "CANCELAR_CONCLUIDA",
    tecla: "5",
    rotulo: "Cancelar venda concluída",
    explicacao: "Estorna a venda inteira, com motivo",
    foraDaVenda: false,
  },
  {
    codigo: "FECHAR_CAIXA",
    tecla: "6",
    rotulo: "Fechar o caixa",
    explicacao: "Conferência do fim do dia",
    foraDaVenda: true,
  },
  {
    codigo: "TROCAR_OPERADOR",
    tecla: "7",
    rotulo: "Trocar operador",
    explicacao: "Sair e entrar com outra matrícula",
    foraDaVenda: true,
  },
];

export function ModalMenuCaixa(props: {
  readonly vendaEmCurso: boolean;
  readonly aoEscolher: (opcao: OpcaoDoMenu) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const disponivel = (opcao: Opcao): boolean =>
    !(opcao.foraDaVenda && props.vendaEmCurso);

  return (
    <Modal titulo="Caixa" aoFechar={props.aoFechar}>
      <ul
        aria-label="Opções do caixa"
        className="flex flex-col gap-2"
        onKeyDown={(evento) => {
          const opcao = OPCOES.find((atual) => atual.tecla === evento.key);
          if (opcao === undefined || !disponivel(opcao)) return;

          evento.preventDefault();
          props.aoEscolher(opcao.codigo);
        }}
      >
        {OPCOES.map((opcao) => (
          <li key={opcao.codigo}>
            <button
              type="button"
              disabled={!disponivel(opcao)}
              onClick={() => {
                props.aoEscolher(opcao.codigo);
              }}
              className="grid w-full grid-cols-[2rem_1fr] items-baseline gap-2 rounded-md border border-borda px-3 py-2 text-left hover:bg-acao-suave disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="font-numero text-tinta-suave">{opcao.tecla}</span>
              <span className="text-tinta">
                {opcao.rotulo}
                <span className="block text-sm text-tinta-suave">{opcao.explicacao}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {props.vendaEmCurso && (
        <p className="text-sm text-tinta-suave">
          Para fechar o caixa ou trocar de operador, conclua ou guarde (F7) a venda da
          tela.
        </p>
      )}

      <div>
        <Botao tom="discreto" onClick={props.aoFechar}>
          Voltar (Esc)
        </Botao>
      </div>
    </Modal>
  );
}
