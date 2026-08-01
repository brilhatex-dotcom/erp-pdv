import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { CABECALHO_SEGREDO, PORTA_AGENTE } from "@erp/agente-contrato";

import { carregarConfiguracao } from "./configuracao.js";
import { montarContingencia } from "./contingencia.js";
import { montarImpressora } from "./hardware/impressora.js";
import { ServicoImpressao } from "./hardware/servicoImpressao.js";
import { montarRoteador, type PedidoHttp } from "./servidor.js";

/**
 * O Agente Local da estação.
 *
 * É o único processo do produto com acesso a disco, porta serial e impressora
 * na máquina do caixa. A tela é uma PWA e não alcança nada disso — fala com o
 * Agente por HTTP, na própria máquina (ADR-0023).
 *
 * ### Escuta só em 127.0.0.1
 *
 * Não é configurável, e é a primeira das três camadas de defesa descritas em
 * `seguranca.ts`. Um Agente alcançável pela rede da loja seria um caminho de
 * impressão e de leitura de catálogo aberto a qualquer máquina do Wi-Fi.
 *
 * ### `node:http`, não Fastify
 *
 * São dez rotas locais sem roteamento dinâmico, sem plugin e sem validação de
 * esquema. O servidor da loja usa Fastify porque precisa; aqui ele seria uma
 * dependência a manter e a auditar dentro do instalador — que é o lugar onde
 * cada megabyte e cada CVE custam suporte.
 */

const LIMITE_CORPO_BYTES = 512 * 1024;

function iniciar(): void {
  const configuracao = carregarConfiguracao(process.env["ERP_AGENTE_CONFIG"]);

  const contingencia = montarContingencia({
    pasta: configuracao.pastaDados,
    api: configuracao.api,
    registrar: (mensagem) => {
      console.warn(`[contingencia] ${mensagem}`);
    },
  });

  const impressao = new ServicoImpressao(
    montarImpressora(configuracao.impressora),
    (mensagem) => {
      console.error(`[impressora] ${mensagem}`);
    },
  );

  const responder = montarRoteador({
    contingencia,
    impressao,
    colunas: configuracao.colunas,
    politica: {
      origensPermitidas: configuracao.origensPermitidas,
      segredo: configuracao.segredo,
    },
    registrar: (mensagem) => {
      console.warn(`[agente] ${mensagem}`);
    },
  });

  const servidor = createServer((requisicao, resposta) => {
    void atender(requisicao, resposta, responder);
  });

  void contingencia.atualizarCatalogo();
  const pararRelogio = contingencia.iniciarRelogio();

  servidor.listen(PORTA_AGENTE, "127.0.0.1", () => {
    console.warn(`[agente] escutando em 127.0.0.1:${String(PORTA_AGENTE)}`);
  });

  const encerrar = (): void => {
    pararRelogio();
    servidor.close();
  };

  process.on("SIGTERM", encerrar);
  process.on("SIGINT", encerrar);
}

async function atender(
  requisicao: IncomingMessage,
  resposta: ServerResponse,
  responder: (pedido: PedidoHttp) => Promise<{
    status: number;
    corpo: unknown;
    cabecalhos: Record<string, string>;
  }>,
): Promise<void> {
  const corpo = await lerCorpo(requisicao);

  const resultado = await responder({
    metodo: requisicao.method ?? "GET",
    caminho: (requisicao.url ?? "/").split("?")[0] ?? "/",
    origem: cabecalho(requisicao, "origin"),
    host: cabecalho(requisicao, "host"),
    segredo: cabecalho(requisicao, CABECALHO_SEGREDO),
    corpo,
  });

  resposta.writeHead(resultado.status, {
    ...resultado.cabecalhos,
    ...(resultado.corpo === undefined ? {} : { "content-type": "application/json" }),
  });

  resposta.end(
    resultado.corpo === undefined ? undefined : JSON.stringify(resultado.corpo),
  );
}

function cabecalho(requisicao: IncomingMessage, nome: string): string | undefined {
  const valor = requisicao.headers[nome];

  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Lê o corpo com teto.
 *
 * Sem limite, um programa local qualquer derruba o Agente mandando um corpo
 * infinito — e o caixa fica sem impressão até alguém reiniciar a máquina.
 */
function lerCorpo(requisicao: IncomingMessage): Promise<unknown> {
  return new Promise((resolver) => {
    const partes: Buffer[] = [];
    let tamanho = 0;

    requisicao.on("data", (parte: Buffer) => {
      tamanho += parte.length;

      if (tamanho > LIMITE_CORPO_BYTES) {
        requisicao.destroy();
        resolver(undefined);
        return;
      }

      partes.push(parte);
    });

    requisicao.on("end", () => {
      if (partes.length === 0) {
        resolver(undefined);
        return;
      }

      try {
        resolver(JSON.parse(Buffer.concat(partes).toString("utf8")));
      } catch {
        // Corpo ilegível vira ausência de corpo: cada rota já sabe recusar o
        // que não veio, com mensagem própria.
        resolver(undefined);
      }
    });

    requisicao.on("error", () => {
      resolver(undefined);
    });
  });
}

/* v8 ignore start -- só executa como processo, fora do alcance do Vitest */
if (process.env["VITEST"] === undefined) {
  iniciar();
}
/* v8 ignore stop */
