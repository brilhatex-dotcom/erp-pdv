import type { ReactNode } from "react";

import { Botao } from "./Botao.js";

/**
 * Os três estados que toda tela precisa ter.
 *
 * Carregando, vazio e erro não são detalhe de acabamento — são o veto do papel
 * UX no checklist (CLAUDE.md §8). Uma tela que só desenha o caso feliz deixa o
 * operador olhando para o branco sem saber se o sistema travou, se não há
 * dados, ou se a rede caiu. As três situações parecem idênticas na tela e
 * exigem reações completamente diferentes dele.
 */

export interface PropsCarregando {
  /** O que está sendo buscado. Vira "Carregando produtos…". */
  readonly oQue?: string;
}

/**
 * Carregando.
 *
 * `role="status"` com `aria-live="polite"` anuncia sem interromper o que o
 * leitor de tela estava dizendo.
 */
export function Carregando({ oQue }: PropsCarregando): ReactNode {
  const texto = oQue === undefined ? "Carregando…" : `Carregando ${oQue}…`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12 text-tinta-suave"
    >
      <svg
        className="size-8 animate-spin"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.25"
        />
        <path
          d="M14 8a6 6 0 0 0-6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-sm">{texto}</span>
    </div>
  );
}

export interface PropsVazio {
  readonly titulo: string;
  /** Diz o **próximo passo**, não só que está vazio. */
  readonly descricao?: string;
  readonly acao?: { readonly rotulo: string; readonly aoClicar: () => void };
}

/**
 * Estado vazio.
 *
 * Sempre com uma saída. "Nenhum produto cadastrado" deixa o usuário parado;
 * "Nenhum produto cadastrado — cadastre o primeiro" resolve o problema dele.
 * Estado vazio é a melhor oportunidade de ensinar o sistema sem treinamento.
 */
export function Vazio({ titulo, descricao, acao }: PropsVazio): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <p className="text-lg font-medium text-tinta">{titulo}</p>
      {descricao !== undefined && (
        <p className="max-w-md text-sm text-tinta-suave">{descricao}</p>
      )}
      {acao !== undefined && (
        <Botao tom="secundario" onClick={acao.aoClicar} className="mt-1">
          {acao.rotulo}
        </Botao>
      )}
    </div>
  );
}

export interface PropsErroDeTela {
  /** Mensagem **do domínio** — já escrita para o operador. */
  readonly mensagem: string;
  /** Repetir a operação. Ausente quando repetir não adianta. */
  readonly aoTentarDeNovo?: () => void;
}

/**
 * Erro de tela.
 *
 * Mostra a mensagem que veio do servidor, que o domínio escreveu para o
 * operador — não o código, não o status HTTP, não a exceção. E oferece "tentar
 * de novo" só quando isso pode funcionar: um botão que repete um erro de
 * permissão ensina o operador a ignorar o botão.
 */
export function ErroDeTela({ mensagem, aoTentarDeNovo }: PropsErroDeTela): ReactNode {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <span aria-hidden="true" className="text-2xl">
        ⚠️
      </span>
      <p className="max-w-md text-base font-medium text-tinta">{mensagem}</p>
      {aoTentarDeNovo !== undefined && (
        <Botao tom="secundario" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}
