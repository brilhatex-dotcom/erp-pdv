import { CABECALHO_CORRELACAO } from "@erp/contracts";
import helmet from "@fastify/helmet";
import limitador from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import type { Ambiente } from "../composicao/ambiente.js";
import type { Container } from "../composicao/container.js";
import { VERSAO } from "../versao.js";
import { correlacaoDaRequisicao, registrarCorrelacao } from "./middleware/correlacao.js";
import { registrarTratamentoDeErro } from "./middleware/tratamento-erro.js";
import { registrarRotasDeSaude } from "./rotas/saude.js";

/**
 * Monta o servidor HTTP.
 *
 * Recebe ambiente e container prontos em vez de construí-los: é o que permite ao
 * teste levantar a aplicação inteira contra dublês, sem banco e sem porta TCP,
 * e ainda assim exercitar o caminho real das requisições.
 */

export interface OpcoesServidor {
  readonly ambiente: Ambiente;
  readonly container: Container;
  /** Sobrescrita só para teste, onde a versão precisa ser previsível. */
  readonly versao?: string;
  readonly tempoNoArSegundos?: () => number;
}

/**
 * Limite de corpo: 1 MiB.
 *
 * Nenhuma requisição legítima deste sistema chega perto — a maior é uma venda
 * com centenas de itens. O limite existe para que corpo gigante seja recusado
 * antes de ser lido na memória do servidor da loja, que é uma máquina modesta.
 */
const LIMITE_CORPO_BYTES = 1_048_576;

export async function criarServidor(opcoes: OpcoesServidor): Promise<FastifyInstance> {
  const { ambiente, container } = opcoes;

  const app = Fastify({
    bodyLimit: LIMITE_CORPO_BYTES,

    logger: {
      level: ambiente.nivelLog,
      // Sem isto, o log grava credencial e token inteiros — e o log vai para
      // arquivo, para o pacote de diagnóstico e para o suporte (§7.6).
      redact: {
        paths: [
          'req.headers["authorization"]',
          'req.headers["cookie"]',
          'res.headers["set-cookie"]',
        ],
        censor: "[oculto]",
      },
    },

    // A correlação vem de `genReqId`, com validação própria. Deixar o Fastify
    // aceitar `request-id` reintroduziria o cabeçalho não validado no log, que é
    // exatamente o que `correlacaoDaRequisicao` existe para impedir.
    requestIdHeader: false,
    genReqId: (requisicao) =>
      correlacaoDaRequisicao(
        requisicao.headers[CABECALHO_CORRELACAO],
        () => container.geradorId.proximo().valor,
      ),

    // A rede é local e sem proxy reverso (§2.2). Confiar em `X-Forwarded-For`
    // aqui permitiria a qualquer estação forjar a origem e escapar do limitador.
    trustProxy: false,
  });

  // Antes de tudo: o cabeçalho de correlação precisa estar na resposta mesmo
  // quando o limitador rejeita a requisição sem chegar à rota.
  registrarCorrelacao(app);

  await app.register(helmet, {
    // A API devolve JSON, nunca HTML. `contentSecurityPolicy` padrão do Helmet
    // é desenhada para página e não protege nada aqui; desligá-la evita
    // cabeçalho grande em toda resposta do caminho quente do PDV. A CSP real
    // pertence à retaguarda e ao Electron, onde há documento para proteger.
    contentSecurityPolicy: false,
  });

  // O limitador **lança** a resposta que monta, então quem dá formato ao
  // envelope é o tratador de erro — que já é o único lugar da fronteira que
  // decide isso. Configurar aqui um formato próprio criaria um segundo envelope
  // de erro na API, e o PDV precisaria reconhecer os dois.
  await app.register(limitador, {
    max: ambiente.limiteRequisicoesPorMinuto,
    timeWindow: "1 minute",
  });

  registrarTratamentoDeErro(app);

  registrarRotasDeSaude(app, {
    container,
    relogio: container.relogio,
    versao: opcoes.versao ?? VERSAO,
    tempoNoArSegundos: opcoes.tempoNoArSegundos ?? (() => process.uptime()),
  });

  return app;
}
