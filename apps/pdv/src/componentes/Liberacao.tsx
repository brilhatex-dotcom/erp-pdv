import { ErroDaApi } from "@erp/cliente-api";
import { Botao, CampoTexto } from "@erp/ui";
import { type ReactNode, useCallback, useRef, useState } from "react";

import type { CredencialSupervisor } from "../api/tipos.js";
import { Modal } from "./Modal.js";

/**
 * Liberação pelo supervisor — sem trocar a sessão.
 *
 * Quando o servidor responde `AUTORIZACAO_NECESSARIA`, a tela não diz "não
 * pode": abre esta janela, o supervisor digita matrícula e PIN no próprio
 * caixa, e **a mesma operação** é repetida com a credencial dele. A venda
 * continua em nome do operador, e o registro guarda os dois nomes.
 *
 * Quem decide se a credencial serve é o servidor. A tela só repete o pedido.
 */

interface Pendente {
  readonly acao: (credencial: CredencialSupervisor) => Promise<unknown>;
  readonly resolver: (valor: unknown) => void;
  readonly rejeitar: (causa: unknown) => void;
}

export interface EstadoLiberacao {
  readonly mensagem: string;
  readonly erro?: string | undefined;
  readonly ocupado: boolean;
}

/** Erros que pedem outra credencial — e não que a operação desista. */
function ehCredencialRecusada(causa: unknown): boolean {
  return (
    causa instanceof ErroDaApi &&
    (causa.codigo.startsWith("SUPERVISOR_") || causa.codigo === "USUARIO_BLOQUEADO")
  );
}

export function useLiberacao(): {
  readonly pedido: EstadoLiberacao | undefined;
  /**
   * Executa a operação; se ela pedir liberação, espera o supervisor.
   *
   * Devolve `undefined` quando o operador desiste — e a tela não mostra erro
   * nenhum, porque desistir não é falha.
   */
  readonly comLiberacao: <T>(
    acao: (credencial?: CredencialSupervisor) => Promise<T>,
  ) => Promise<T | undefined>;
  readonly confirmar: (credencial: CredencialSupervisor) => Promise<void>;
  readonly desistir: () => void;
} {
  const [pedido, setPedido] = useState<EstadoLiberacao | undefined>(undefined);
  const pendente = useRef<Pendente | undefined>(undefined);

  const comLiberacao = useCallback(
    async <T,>(
      acao: (credencial?: CredencialSupervisor) => Promise<T>,
    ): Promise<T | undefined> => {
      try {
        return await acao(undefined);
      } catch (causa) {
        if (!(causa instanceof ErroDaApi) || causa.codigo !== "AUTORIZACAO_NECESSARIA") {
          throw causa;
        }

        return new Promise<T | undefined>((resolver, rejeitar) => {
          pendente.current = {
            acao,
            resolver: resolver as (valor: unknown) => void,
            rejeitar,
          };
          setPedido({ mensagem: causa.mensagemAmigavel, ocupado: false });
        });
      }
    },
    [],
  );

  const confirmar = useCallback(
    async (credencial: CredencialSupervisor): Promise<void> => {
      const atual = pendente.current;
      if (atual === undefined) return;

      setPedido(
        (anterior) => anterior && { ...anterior, ocupado: true, erro: undefined },
      );

      try {
        const resultado = await atual.acao(credencial);
        pendente.current = undefined;
        setPedido(undefined);
        atual.resolver(resultado);
      } catch (causa) {
        if (ehCredencialRecusada(causa)) {
          setPedido(
            (anterior) =>
              anterior && {
                ...anterior,
                ocupado: false,
                erro: (causa as ErroDaApi).mensagemAmigavel,
              },
          );
          return;
        }

        pendente.current = undefined;
        setPedido(undefined);
        atual.rejeitar(causa);
      }
    },
    [],
  );

  const desistir = useCallback((): void => {
    const atual = pendente.current;
    pendente.current = undefined;
    setPedido(undefined);
    atual?.resolver(undefined);
  }, []);

  return { pedido, comLiberacao, confirmar, desistir };
}

export function ModalSupervisor(props: {
  readonly pedido: EstadoLiberacao;
  readonly aoConfirmar: (credencial: CredencialSupervisor) => void;
  readonly aoDesistir: () => void;
}): ReactNode {
  const [matricula, setMatricula] = useState("");
  const [pin, setPin] = useState("");

  return (
    <Modal titulo="Liberação do supervisor" aoFechar={props.aoDesistir}>
      <p className="text-tinta">{props.pedido.mensagem}</p>
      <p className="text-sm text-tinta-suave">
        O supervisor digita a matrícula e o PIN dele. A venda continua no seu nome.
      </p>

      {props.pedido.erro !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-sm text-tinta"
        >
          {props.pedido.erro}
        </p>
      )}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(evento) => {
          evento.preventDefault();
          if (matricula.trim() === "" || pin === "") return;
          props.aoConfirmar({ matricula: matricula.trim(), pin });
          setPin("");
        }}
      >
        <CampoTexto
          rotulo="Matrícula do supervisor"
          numerico
          value={matricula}
          onChange={(evento) => {
            setMatricula(evento.target.value);
          }}
        />
        <CampoTexto
          rotulo="PIN do supervisor"
          type="password"
          numerico
          autoComplete="off"
          value={pin}
          onChange={(evento) => {
            setPin(evento.target.value);
          }}
        />
        <div className="flex gap-3">
          <Botao type="submit" ocupado={props.pedido.ocupado} rotuloOcupado="Conferindo…">
            Liberar
          </Botao>
          <Botao tom="discreto" onClick={props.aoDesistir}>
            Voltar (Esc)
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
