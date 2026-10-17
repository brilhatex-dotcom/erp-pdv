import { mensagemDe, type UsuarioLogado, useSessao } from "@erp/cliente-api";
import { Botao, Carregando, ErroDeTela } from "@erp/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiDoBalcao } from "../api/servidor.js";
import type { ConfiguracaoNoFio, ContextoDoPdv, VendaNoFio } from "../api/tipos.js";
import { identificadorDaEstacao } from "../estacao.js";
import { ehQuedaDeServidor } from "../vendaComQueda.js";
import { Abertura } from "./Abertura.js";
import { Fechamento } from "./Fechamento.js";
import { TelaDeVenda } from "./TelaDeVenda.js";

/**
 * O caixa da estação: abrir, vender, fechar.
 *
 * Antes de mostrar qualquer coisa, a tela pergunta três: **quem** está no caixa
 * e como a loja vende (o contexto), **se** o caixa desta estação está aberto, e
 * **qual** venda ficou aberta quando a tela fechou. A terceira é o que faz o F5,
 * a queda de energia e o navegador fechado por engano não custarem a venda: ela
 * volta para a tela, com itens e pagamentos.
 *
 * ### Servidor fora do ar não é caixa fechado
 *
 * Se a resposta não vem porque o servidor sumiu, a estação vende pela fila do
 * Agente Local (ADR-0023), com a última configuração conhecida. Mostrar a
 * abertura de caixa nessa hora deixaria a loja parada justamente no cenário em
 * que a contingência existe para funcionar.
 */

type Estado =
  | { readonly tipo: "CARREGANDO" }
  | { readonly tipo: "FALHOU"; readonly mensagem: string }
  | { readonly tipo: "FECHADO" }
  | {
      readonly tipo: "VENDENDO";
      readonly contexto: ContextoDoPdv;
      readonly recuperada: VendaNoFio | undefined;
    }
  | { readonly tipo: "FECHANDO"; readonly contexto: ContextoDoPdv };

const CHAVE_CONFIGURACAO = "erp.pdv.configuracao";

export function Balcao(): ReactNode {
  const { cliente, usuario, sair } = useSessao();
  const api = useMemo(() => new ApiDoBalcao(cliente), [cliente]);
  const estacaoId = useMemo(() => identificadorDaEstacao(), []);
  const [estado, setEstado] = useState<Estado>({ tipo: "CARREGANDO" });
  const [carga, setCarga] = useState(0);

  // O operador entra pela referência para a recarga não depender da
  // identidade do objeto da sessão, que muda a cada renovação de token.
  const operador = useRef(usuario);
  operador.current = usuario;

  useEffect(() => {
    let vivo = true;
    setEstado({ tipo: "CARREGANDO" });

    void carregar(api, estacaoId, operador.current).then((carregado) => {
      if (vivo) setEstado(carregado);
    });

    return (): void => {
      vivo = false;
    };
  }, [api, estacaoId, carga]);

  const recarregar = useCallback((): void => {
    setCarga((atual) => atual + 1);
  }, []);

  switch (estado.tipo) {
    case "CARREGANDO":
      return (
        <main className="flex min-h-screen items-center justify-center">
          <Carregando oQue="o caixa" />
        </main>
      );

    case "FALHOU":
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
          <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={recarregar} />
          <Botao tom="discreto" onClick={() => void sair()}>
            Sair
          </Botao>
        </main>
      );

    case "FECHADO":
      return <Abertura api={api} estacaoId={estacaoId} aoAbrir={recarregar} />;

    case "FECHANDO":
      return (
        <Fechamento
          api={api}
          estacaoId={estacaoId}
          aoVoltar={() => {
            setEstado({
              tipo: "VENDENDO",
              contexto: estado.contexto,
              recuperada: undefined,
            });
          }}
          aoConcluir={recarregar}
        />
      );

    case "VENDENDO":
      return (
        <TelaDeVenda
          api={api}
          contexto={estado.contexto}
          estacaoId={estacaoId}
          recuperada={estado.recuperada}
          aoFecharCaixa={() => {
            setEstado({ tipo: "FECHANDO", contexto: estado.contexto });
          }}
          aoSair={() => void sair()}
        />
      );
  }
}

async function carregar(
  api: ApiDoBalcao,
  estacaoId: string,
  usuario: UsuarioLogado | undefined,
): Promise<Estado> {
  try {
    const [contexto, caixa] = await Promise.all([
      api.contexto(),
      api.caixaAberto(estacaoId),
    ]);
    guardarConfiguracao(contexto.configuracao);

    if (caixa === undefined) return { tipo: "FECHADO" };

    // A venda da tela é a aberta e **não guardada** mais recente; as guardadas
    // esperam o F7.
    const abertas = await api.abertas(estacaoId);
    const recuperada = abertas.filter((venda) => venda.suspensao === undefined).at(-1);

    return { tipo: "VENDENDO", contexto, recuperada };
  } catch (causa) {
    if (ehQuedaDeServidor(causa) && usuario !== undefined) {
      return {
        tipo: "VENDENDO",
        contexto: contextoSemServidor(usuario),
        recuperada: undefined,
      };
    }

    return { tipo: "FALHOU", mensagem: mensagemDe(causa) };
  }
}

/**
 * O contexto montado na estação, para vender sem o servidor.
 *
 * A configuração é a última que o servidor mandou, guardada nesta estação; na
 * falta dela, o comportamento mais seguro: comprovante sempre — que é o que
 * abre a gaveta — e nenhum recurso que dependa do servidor.
 */
function contextoSemServidor(usuario: UsuarioLogado): ContextoDoPdv {
  return {
    modo: "REAL",
    operador: {
      id: usuario.id,
      nome: usuario.nome,
      matricula: usuario.matricula,
      papel: usuario.papel,
      permissoes: usuario.permissoes,
      limites: {},
    },
    configuracao: configuracaoGuardada() ?? {
      segmento: "MISTO",
      recursos: [],
      vendaSemEstoque: "PERMITIR",
      larguraCupom: 80,
      impressaoComprovante: "SEMPRE",
      gravada: false,
    },
    integracoes: [],
  };
}

/**
 * Guarda a configuração da loja nesta estação — só para a venda sem servidor.
 *
 * Não há segredo nela: segmento, recursos ligados, largura do papel. É
 * conveniência, e por isso nenhuma falha de armazenamento vira erro.
 */
function guardarConfiguracao(configuracao: ConfiguracaoNoFio): void {
  try {
    globalThis.localStorage.setItem(CHAVE_CONFIGURACAO, JSON.stringify(configuracao));
  } catch {
    // Armazenamento cheio ou bloqueado: a venda sem servidor usa o padrão.
  }
}

function configuracaoGuardada(): ConfiguracaoNoFio | undefined {
  try {
    const guardada = globalThis.localStorage.getItem(CHAVE_CONFIGURACAO);

    // Escrita por esta mesma tela, com o tipo dela: não é entrada de fora.
    return guardada === null ? undefined : (JSON.parse(guardada) as ConfiguracaoNoFio);
  } catch {
    return undefined;
  }
}
