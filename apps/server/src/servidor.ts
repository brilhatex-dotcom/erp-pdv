import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import type { Container } from "./composicao/container.js";
import { tratadorDeErro } from "./http/erros.js";
import { rotasDeAcesso } from "./rotas/acesso.js";
import { rotasDeCadastros } from "./rotas/cadastros.js";
import { rotasDeCaixa } from "./rotas/caixa.js";
import { rotasDeCatalogo } from "./rotas/catalogo.js";
import { rotasDeProdutos } from "./rotas/produtos.js";
import { rotasDeSaude } from "./rotas/saude.js";
import { rotasDeSincronizacao } from "./rotas/sincronizacao.js";
import { rotasDeVendas } from "./rotas/vendas.js";

/**
 * Monta o servidor HTTP.
 *
 * Fastify é uma camada fina de transporte — exatamente o papel de um adapter de
 * entrada. Nenhuma regra de negócio mora aqui: as rotas traduzem HTTP para caso
 * de uso e de volta (ARQUITETURA.md §5.2.3).
 *
 * Devolve a instância **sem escutar**, para que o teste use `inject` e não
 * precise de porta livre — o que também deixa a suíte paralelizável.
 */
export async function montarServidor(container: Container): Promise<FastifyInstance> {
  const servidor = Fastify({
    logger: {
      level: container.ambiente.ehProducao ? "info" : "warn",
      // Nunca registrar corpo de requisição: o login passa por aqui, e um log
      // com PIN em claro é um vazamento com data marcada.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    // O proxy do PDV pode encaminhar o IP real; sem isto o rate limit
    // contaria todas as estações como um único cliente.
    trustProxy: true,
    disableRequestLogging: !container.ambiente.ehProducao,
  });

  servidor.setErrorHandler(tratadorDeErro);

  await servidor.register(cookie);

  await servidor.register(cors, {
    // Lista fechada. `origin: true` refletiria qualquer origem, o que anula o
    // CORS justamente onde ele protege — e cookies vão junto.
    origin:
      container.ambiente.origens.length > 0 ? [...container.ambiente.origens] : false,
    credentials: true,
  });

  /**
   * Limite de tentativas por IP.
   *
   * Complementa o bloqueio por usuário, não o substitui: o bloqueio protege uma
   * conta de força bruta; este limite protege o **servidor** de alguém varrendo
   * matrículas. Sem ele, o custo do Argon2id vira a arma do atacante — cada
   * tentativa consome CPU da máquina que está rodando o caixa.
   */
  await servidor.register(rateLimit, {
    max: container.ambiente.LIMITE_REQUISICOES_MINUTO,
    timeWindow: "1 minute",
    // Saúde precisa responder mesmo sob ataque, senão o supervisor de processo
    // reinicia o servidor no pior momento possível.
    allowList: (requisicao) => requisicao.url.startsWith("/saude"),
  });

  rotasDeSaude(servidor, container);
  rotasDeAcesso(servidor, container);
  rotasDeProdutos(servidor, container);
  rotasDeCaixa(servidor, container);
  rotasDeVendas(servidor, container);
  rotasDeCadastros(servidor, container);
  rotasDeSincronizacao(servidor, container);
  rotasDeCatalogo(servidor, container);

  return servidor;
}
