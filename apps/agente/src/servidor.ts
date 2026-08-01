import { CABECALHO_SEGREDO, ROTAS } from "@erp/agente-contrato";

import type { ContingenciaViva } from "./contingencia.js";
import type {
  Aviso,
  DadosImpressaoCupom,
  ServicoImpressao,
} from "./hardware/servicoImpressao.js";
import { avaliarAcesso, cabecalhosCors, type PoliticaAcesso } from "./seguranca.js";

/**
 * A superfície HTTP do Agente Local.
 *
 * ### Nenhum tratador lança
 *
 * O que estava valendo para o IPC vale mais ainda aqui: do outro lado há uma
 * tela no meio de uma venda offline, e uma exceção vira 500 sem mensagem que o
 * operador entenda. Falha vira desfecho nomeado.
 *
 * ### A resposta é sempre JSON, mesmo quando nega
 *
 * Um 403 com corpo vazio chega na tela como "erro desconhecido". Com motivo, o
 * suporte lê o log do Agente e sabe em dez segundos se foi origem, host ou
 * segredo — e essa é a diferença entre um chamado de dez minutos e um de duas
 * horas.
 */

export interface PedidoHttp {
  readonly metodo: string;
  readonly caminho: string;
  readonly origem: string | undefined;
  readonly host: string | undefined;
  readonly segredo: string | undefined;
  readonly corpo: unknown;
}

export interface RespostaHttp {
  readonly status: number;
  readonly corpo: unknown;
  readonly cabecalhos: Record<string, string>;
}

export interface OpcoesRoteador {
  readonly contingencia: ContingenciaViva;
  readonly impressao: ServicoImpressao;
  readonly politica: PoliticaAcesso;
  readonly registrar?: (mensagem: string) => void;
  /** Colunas do papel: 48 para 80 mm, 32 para 58 mm. */
  readonly colunas: number;
}

export function montarRoteador(
  opcoes: OpcoesRoteador,
): (pedido: PedidoHttp) => Promise<RespostaHttp> {
  const registrar = opcoes.registrar ?? ((): void => undefined);

  return async function responder(pedido: PedidoHttp): Promise<RespostaHttp> {
    const cors =
      pedido.origem === undefined ? {} : cabecalhosCors(pedido.origem, CABECALHO_SEGREDO);

    // A vistoria prévia do navegador não carrega segredo nem corpo — ela existe
    // justamente para perguntar se o pedido seguinte é permitido.
    if (pedido.metodo === "OPTIONS") {
      const origemConhecida =
        pedido.origem !== undefined &&
        opcoes.politica.origensPermitidas.includes(pedido.origem);

      return origemConhecida
        ? { status: 204, corpo: undefined, cabecalhos: cors }
        : { status: 403, corpo: { erro: "Origem não autorizada." }, cabecalhos: {} };
    }

    const veredito = avaliarAcesso(opcoes.politica, pedido);

    if (veredito.tipo === "NEGADO") {
      registrar(`Acesso negado em ${pedido.caminho}: ${veredito.motivo}`);

      // Sem cabeçalho de CORS na negativa: devolvê-lo diria ao site hostil que
      // o Agente existe e qual é a forma dele.
      return { status: 403, corpo: { erro: veredito.motivo }, cabecalhos: {} };
    }

    try {
      return { ...(await despachar(opcoes, pedido)), cabecalhos: cors };
    } catch (causa) {
      registrar(`Falha em ${pedido.caminho}: ${String(causa)}`);

      return {
        status: 500,
        corpo: { erro: "O agente desta estação falhou." },
        cabecalhos: cors,
      };
    }
  };
}

async function despachar(
  opcoes: OpcoesRoteador,
  pedido: PedidoHttp,
): Promise<{ status: number; corpo: unknown }> {
  const { contingencia, impressao } = opcoes;

  switch (pedido.caminho) {
    case ROTAS.saude:
      return { status: 200, corpo: { estado: "ok" } };

    case ROTAS.estado:
      return { status: 200, corpo: contingencia.estado() };

    case ROTAS.iniciarVenda: {
      const dados = pedido.corpo as
        { readonly estacaoId?: unknown; readonly operadorId?: unknown } | undefined;

      if (typeof dados?.estacaoId !== "string" || typeof dados.operadorId !== "string") {
        return { status: 400, corpo: { erro: "Informe a estação e o operador." } };
      }

      return {
        status: 200,
        corpo: contingencia.iniciar(dados.estacaoId, dados.operadorId),
      };
    }

    case ROTAS.item: {
      const codigo = (pedido.corpo as { readonly codigo?: unknown } | undefined)?.codigo;

      return typeof codigo === "string"
        ? { status: 200, corpo: contingencia.adicionarItem(codigo) }
        : { status: 200, corpo: { tipo: "ERRO", mensagem: "Código inválido." } };
    }

    case ROTAS.pagamento: {
      const dados = pedido.corpo as
        { readonly forma?: unknown; readonly valor?: unknown } | undefined;

      return typeof dados?.forma === "string" && typeof dados.valor === "string"
        ? {
            status: 200,
            corpo: contingencia.registrarPagamento(dados.forma, dados.valor),
          }
        : { status: 200, corpo: { tipo: "ERRO", mensagem: "Pagamento inválido." } };
    }

    case ROTAS.finalizar:
      return { status: 200, corpo: contingencia.finalizar() };

    case ROTAS.cancelar:
      contingencia.cancelar();
      return { status: 200, corpo: { cancelada: true } };

    case ROTAS.sincronizar:
      return { status: 200, corpo: await contingencia.sincronizar() };

    case ROTAS.imprimirCupom: {
      const dados = pedido.corpo as DadosImpressaoCupom | undefined;

      if (dados === undefined) {
        const aviso: Aviso = { tipo: "NAO_IMPRESSO", mensagem: "Cupom não impresso." };
        return { status: 200, corpo: aviso };
      }

      return {
        status: 200,
        corpo: await impressao.imprimirCupom({
          ...dados,
          colunas: dados.colunas ?? opcoes.colunas,
        }),
      };
    }

    case ROTAS.abrirGaveta:
      return { status: 200, corpo: await impressao.abrirGaveta() };

    default:
      return { status: 404, corpo: { erro: "Caminho desconhecido." } };
  }
}
