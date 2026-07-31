import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ClienteApi, Sessao } from "../api/cliente.js";

export interface UsuarioLogado {
  readonly id: string;
  readonly nome: string;
  readonly matricula: string;
  readonly papel: string;
  readonly permissoes: readonly string[];
  readonly precisaTrocarCredencial: boolean;
}

export interface ValorSessao {
  readonly usuario: UsuarioLogado | undefined;
  readonly cliente: ClienteApi;
  /** `true` enquanto tenta restaurar a sessão pelo cookie. */
  readonly restaurando: boolean;
  /**
   * Declarados como **propriedades de função**, não métodos.
   *
   * As telas desestruturam (`const { entrar } = useSessao()`), e assinatura de
   * método permitiria que a função perdesse o `this` no caminho.
   */
  readonly entrar: (matricula: string, segredo: string) => Promise<void>;
  readonly sair: () => Promise<void>;
  /**
   * O usuário tem a permissão.
   *
   * Serve para **esconder** o que ele não pode fazer — isso é experiência, não
   * segurança. A decisão real acontece no servidor, e um cliente adulterado
   * não contorna nada (ARQUITETURA.md §9.5).
   */
  readonly pode: (permissao: string) => boolean;
}

const Contexto = createContext<ValorSessao | undefined>(undefined);

interface RespostaLogin {
  readonly token: string;
  readonly usuario: UsuarioLogado;
}

export interface PropsProvedorSessao {
  readonly cliente?: ClienteApi;
  readonly children: ReactNode;
}

/**
 * Provedor de sessão.
 *
 * Ao montar, tenta **restaurar** a sessão renovando pelo cookie. É o que faz
 * um F5 no meio do trabalho não jogar o gerente para a tela de login — o
 * refresh vive num cookie `httpOnly` que sobrevive ao recarregamento, mesmo
 * com o token de acesso guardado só em memória.
 */
export function ProvedorSessao({ cliente, children }: PropsProvedorSessao): ReactNode {
  const api = useMemo(() => cliente ?? new ClienteApi(new Sessao()), [cliente]);
  const [usuario, setUsuario] = useState<UsuarioLogado | undefined>(undefined);
  const [restaurando, setRestaurando] = useState(true);

  useEffect(() => {
    // `AbortController` em vez de um sinalizador booleano: além de evitar
    // atualizar estado de componente desmontado, **cancela a requisição em
    // voo** — o que importa no `StrictMode`, que monta duas vezes em
    // desenvolvimento e dispararia duas restaurações.
    const controle = new AbortController();

    api.sessao.aoPerderSessao(() => {
      if (!controle.signal.aborted) setUsuario(undefined);
    });

    void (async () => {
      try {
        const eu = await api.requisitar<UsuarioLogado>("/api/acesso/eu", {
          sinal: controle.signal,
        });
        if (!controle.signal.aborted) setUsuario(eu);
      } catch {
        // Sem sessão para restaurar é o caso normal do primeiro acesso, não um
        // defeito: cai na tela de login sem barulho.
        if (!controle.signal.aborted) setUsuario(undefined);
      } finally {
        if (!controle.signal.aborted) setRestaurando(false);
      }
    })();

    return () => {
      controle.abort();
    };
  }, [api]);

  const entrar = useCallback(
    async (matricula: string, segredo: string): Promise<void> => {
      const resposta = await api.requisitar<RespostaLogin>("/api/acesso/login", {
        metodo: "POST",
        corpo: {
          matricula,
          segredo,
          contexto: "RETAGUARDA",
          dispositivoId: identificadorDoDispositivo(),
        },
      });

      api.sessao.definir(resposta.token);
      setUsuario(resposta.usuario);
    },
    [api],
  );

  const sair = useCallback(async (): Promise<void> => {
    try {
      await api.requisitar("/api/acesso/sair", { metodo: "POST" });
    } catch {
      // Falha ao avisar o servidor é **engolida de propósito**. A sessão local
      // cai de qualquer forma: deixar o usuário "logado" numa tela cuja sessão
      // já não vale é pior do que pedir o login de novo. Propagar o erro só
      // produziria uma rejeição não tratada no console, sem nada que o
      // operador pudesse fazer a respeito.
      //
      // O servidor limpa a sessão órfã na expiração.
    } finally {
      api.sessao.definir(undefined);
      setUsuario(undefined);
    }
  }, [api]);

  const pode = useCallback(
    (permissao: string): boolean => usuario?.permissoes.includes(permissao) ?? false,
    [usuario],
  );

  const valor = useMemo<ValorSessao>(
    () => ({ usuario, cliente: api, restaurando, entrar, sair, pode }),
    [usuario, api, restaurando, entrar, sair, pode],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const valor = useContext(Contexto);

  if (valor === undefined) {
    // Erro de programação, não de negócio: `throw` é o certo (princípio 7).
    throw new Error("useSessao precisa estar dentro de <ProvedorSessao>");
  }

  return valor;
}

const CHAVE_DISPOSITIVO = "erp.dispositivo";

/**
 * Identificador estável deste navegador.
 *
 * Fica em `localStorage` de propósito — **não é segredo**. Serve para o
 * administrador reconhecer "o computador do escritório" na lista de sessões e
 * encerrá-lo remotamente. Perder o valor não dá acesso a ninguém: só faz o
 * dispositivo aparecer como novo.
 */
export function identificadorDoDispositivo(): string {
  const guardado = globalThis.localStorage.getItem(CHAVE_DISPOSITIVO);

  if (guardado !== null && guardado !== "") return guardado;

  const novo = crypto.randomUUID();
  globalThis.localStorage.setItem(CHAVE_DISPOSITIVO, novo);

  return novo;
}
