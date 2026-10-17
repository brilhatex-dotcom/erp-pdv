import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import type { Container } from "./composicao/container.js";
import { tratadorDeErro } from "./http/erros.js";
import { registrarTelas } from "./http/estaticos.js";
import { baterAgendaDeCopias, recusarDuranteManutencao } from "./http/manutencao.js";
import { rotasDeAcesso } from "./rotas/acesso.js";
import { rotasDeAuditoria } from "./rotas/auditoria.js";
import { rotasDeCadastros } from "./rotas/cadastros.js";
import { rotasDeCaixa } from "./rotas/caixa.js";
import { rotasDeCatalogo } from "./rotas/catalogo.js";
import { rotasDeCompras } from "./rotas/compras.js";
import { rotasDeConfiguracao } from "./rotas/configuracao.js";
import { rotasDeCopias } from "./rotas/copias.js";
import { rotasDeEmpresa } from "./rotas/empresa.js";
import { rotasDeFinanceiro } from "./rotas/financeiro.js";
import { rotasDeEstoque } from "./rotas/estoque.js";
import { rotasDeImagens } from "./rotas/imagens.js";
import { rotasDoPdv } from "./rotas/pdv.js";
import { rotasDePosVenda } from "./rotas/posVenda.js";
import { rotasDeProdutos } from "./rotas/produtos.js";
import { rotasDeSaude } from "./rotas/saude.js";
import { rotasDeSincronizacao } from "./rotas/sincronizacao.js";
import { rotasDeTreinamento } from "./rotas/treinamento.js";
import { rotasDeUsuarios } from "./rotas/usuarios.js";
import { rotasDeVendas } from "./rotas/vendas.js";

/** Onde o modo treinamento atende: as mesmas rotas, noutro banco (ADR-0026). */
export const PREFIXO_DO_TREINO = "/treino";

/**
 * Monta o servidor HTTP.
 *
 * Fastify é uma camada fina de transporte — exatamente o papel de um adapter de
 * entrada. Nenhuma regra de negócio mora aqui: as rotas traduzem HTTP para caso
 * de uso e de volta (ARQUITETURA.md §5.2.3).
 *
 * Devolve a instância **sem escutar**, para que o teste use `inject` e não
 * precise de porta livre — o que também deixa a suíte paralelizável.
 *
 * O container do treinamento, quando existe, atende as mesmas rotas da loja
 * sob `/treino` — e só elas: cópia de segurança, saúde e a fila do Agente são
 * do banco de verdade.
 */
export async function montarServidor(
  container: Container,
  treinamento?: Container,
): Promise<FastifyInstance> {
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

  recusarDuranteManutencao(servidor, container.manutencao);
  if (container.copias !== undefined)
    baterAgendaDeCopias(servidor, container.copias.agenda);

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
  rotasDeCopias(servidor, container);
  rotasDeSincronizacao(servidor, container);
  rotasDaLoja(servidor, container);

  if (treinamento !== undefined) {
    await servidor.register(
      (treino) => {
        rotasDaLoja(treino, treinamento);
        rotasDeTreinamento(treino, treinamento);

        return Promise.resolve();
      },
      { prefix: PREFIXO_DO_TREINO },
    );
  } else if (container.ambiente.treinamento.url === undefined) {
    const { aviso } = container.ambiente.treinamento;

    // Na partida, e não aqui: é quando o técnico está olhando o log.
    if (aviso !== undefined) {
      servidor.addHook("onReady", () => {
        servidor.log.warn({ motivo: aviso }, "treinamento desligado");
        return Promise.resolve();
      });
    }
  }

  // Depois das rotas, sempre: o `notFound` das telas responde o que sobrar, e
  // registrá-lo antes engoliria as rotas de API declaradas depois dele.
  if (container.ambiente.PASTA_PDV !== "" || container.ambiente.PASTA_RETAGUARDA !== "") {
    await registrarTelas(servidor, {
      pdv: container.ambiente.PASTA_PDV,
      retaguarda: container.ambiente.PASTA_RETAGUARDA,
    });
  }

  return servidor;
}

/**
 * As rotas que a loja e o treino atendem do mesmo jeito.
 *
 * Uma lista só, chamada duas vezes: o treino ensina o caixa de verdade, e uma
 * rota esquecida aqui seria uma tela que funciona na loja e quebra no treino.
 */
function rotasDaLoja(servidor: FastifyInstance, container: Container): void {
  rotasDeAcesso(servidor, container);
  rotasDeProdutos(servidor, container);
  rotasDeCaixa(servidor, container);
  rotasDeVendas(servidor, container);
  rotasDePosVenda(servidor, container);
  rotasDoPdv(servidor, container);
  rotasDeConfiguracao(servidor, container);
  rotasDeImagens(servidor, container);
  rotasDeAuditoria(servidor, container);
  rotasDeCadastros(servidor, container);
  rotasDeUsuarios(servidor, container);
  rotasDeCatalogo(servidor, container);
  rotasDeEstoque(servidor, container);
  rotasDeCompras(servidor, container);
  rotasDeEmpresa(servidor, container);
  rotasDeFinanceiro(servidor, container);
}
