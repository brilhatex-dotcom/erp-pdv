import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { TreinoNoFio } from "./api/tipos.js";

/**
 * Loja ou treino: em qual dos dois bancos esta tela está trabalhando
 * (ADR-0026).
 *
 * ### Um cliente da API para cada modo
 *
 * No treino, toda chamada vai para `/treino/...` — login, venda, caixa —, e a
 * sessão é outra: trocar de modo monta de novo o provedor de sessão, do zero.
 * Uma tela que esquecesse o prefixo não teria como falar com o banco errado,
 * porque o prefixo não é dela: é do cliente.
 *
 * ### Guardado na aba, não na estação
 *
 * `sessionStorage`: o F5 no meio do treino continua no treino, mas fechar a
 * janela — ou a estação reiniciar de manhã — volta sempre ao caixa de
 * verdade. Um caixa que amanhecesse no treino venderia de mentira o dia
 * inteiro.
 */

export const PREFIXO_DO_TREINO = "/treino";

const CHAVE_DO_MODO = "erp.pdv.treinamento";

export interface ValorModo {
  readonly treinamento: boolean;
  readonly entrarNoTreino: () => void;
  readonly sairDoTreino: () => void;
  /**
   * Com quem entrar no treino, e o que digitar. Pública, e rejeita quando
   * este servidor não tem treino — é assim que a entrada da loja sabe se
   * oferece o botão.
   */
  readonly consultarTreino: () => Promise<TreinoNoFio>;
}

const Contexto = createContext<ValorModo>({
  treinamento: false,
  entrarNoTreino: () => undefined,
  sairDoTreino: () => undefined,
  consultarTreino: () => Promise.reject(new Error("sem treino fora do provedor")),
});

/** O modo da tela. Fora do provedor, é a loja — o lado seguro. */
export function useModo(): ValorModo {
  return useContext(Contexto);
}

/** Cria o cliente da API de um modo. Os testes trocam o `fetch` por aqui. */
export type CriarCliente = (base: string) => ClienteApi;

const clienteDoNavegador: CriarCliente = (base) => new ClienteApi(new Sessao(), base);

export function ProvedorModo(props: {
  readonly criarCliente?: CriarCliente;
  readonly children: ReactNode;
}): ReactNode {
  const criarCliente = props.criarCliente ?? clienteDoNavegador;
  const [treinamento, setTreinamento] = useState(treinoGuardado);

  const cliente = useMemo(
    () => criarCliente(treinamento ? PREFIXO_DO_TREINO : ""),
    [criarCliente, treinamento],
  );

  const entrarNoTreino = useCallback((): void => {
    guardarTreino(true);
    setTreinamento(true);
  }, []);

  const sairDoTreino = useCallback((): void => {
    guardarTreino(false);
    setTreinamento(false);
  }, []);

  // Um cliente sem sessão, só para a consulta pública: na loja, o cliente da
  // tela fala com a raiz, e a pergunta é sobre o treino.
  const consultarTreino = useCallback(
    () => criarCliente(PREFIXO_DO_TREINO).requisitar<TreinoNoFio>("/api/treinamento"),
    [criarCliente],
  );

  const valor = useMemo(
    () => ({ treinamento, entrarNoTreino, sairDoTreino, consultarTreino }),
    [treinamento, entrarNoTreino, sairDoTreino, consultarTreino],
  );

  return (
    <Contexto.Provider value={valor}>
      {/* A chave remonta a sessão inteira na troca: nada de um modo sobra no outro. */}
      <ProvedorSessao
        key={treinamento ? "treino" : "loja"}
        contexto="PDV"
        cliente={cliente}
      >
        {props.children}
      </ProvedorSessao>
    </Contexto.Provider>
  );
}

function treinoGuardado(): boolean {
  try {
    return globalThis.sessionStorage.getItem(CHAVE_DO_MODO) === "sim";
  } catch {
    // Armazenamento bloqueado: começa na loja, que é o lado seguro.
    return false;
  }
}

function guardarTreino(treinando: boolean): void {
  try {
    if (treinando) globalThis.sessionStorage.setItem(CHAVE_DO_MODO, "sim");
    else globalThis.sessionStorage.removeItem(CHAVE_DO_MODO);
  } catch {
    // Sem armazenamento, o F5 volta para a loja. Incômodo no treino, seguro no caixa.
  }
}
