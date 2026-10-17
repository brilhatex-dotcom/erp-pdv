import type { ReactNode } from "react";

/**
 * A faixa que não deixa ninguém esquecer que está no treino (ADR-0026).
 *
 * No alto de toda tela do treino — entrada, abertura, venda, fechamento —, e
 * sem botão: o que se faz com o treino (recomeçar, sair) mora no menu do
 * caixa, onde o teclado chega; aqui é só o aviso.
 */
export function FaixaDoTreino(): ReactNode {
  return (
    <p
      role="note"
      className="rounded-md bg-atencao px-3 py-1 text-center font-semibold text-tinta"
    >
      MODO TREINAMENTO — nada do que acontece aqui vale como venda de verdade.
    </p>
  );
}
