import type {
  ConferenciaDaCopia,
  ConfiguracaoDeBackup,
  CopiaGuardada,
  ExecucaoDeBackup,
  ResumoDoBanco,
  SituacaoDasCopias,
} from "@erp/application";
import { ErroRegraNegocio } from "@erp/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { Container, CopiasDoServidor } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { recusar, usuarioAutenticado } from "../http/entrada.js";
import { responderErro } from "../http/erros.js";

/**
 * Cópias de segurança: ver, fazer, mudar a agenda, conferir e restaurar.
 *
 * Duas permissões, de propósito:
 *
 * - `backup:executar` (gerente) vê a lista e faz uma cópia agora — o "copiei
 *   antes de mexer nos preços".
 * - `config:backup` (administrador) muda a agenda, confere e **restaura**.
 *   Restaurar apaga tudo o que a loja fez desde a cópia; quem pode isso é quem
 *   responde pela loja inteira.
 *
 * As rotas só traduzem: a regra (provar, recusar versão diferente, copiar o
 * banco de agora antes de trocar) está nos casos de uso.
 */

const corpoAgenda = z.object({
  intervaloHoras: z.number().int(),
  aoFecharCaixa: z.boolean(),
});

const corpoRestauracao = z.object({
  confirmacao: z.string().max(40),
  comCaixasAbertos: z.boolean().optional(),
});

/**
 * O nome que chega da tela. O formato de verdade quem confere é a pasta, que
 * recusa o que não for nome de cópia — aqui só se barra o vazio. O comprido o
 * Fastify já recusa antes, com 414.
 */
const parametrosDaCopia = z.object({
  nome: z.string().min(1),
});

export function rotasDeCopias(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);
  const deGerente = {
    preHandler: [autenticado, exigirPermissao(container, "backup:executar")],
  };
  const deAdministrador = {
    preHandler: [autenticado, exigirPermissao(container, "config:backup")],
  };

  servidor.get("/api/copias-de-seguranca", deGerente, async (_requisicao, resposta) => {
    const copias = container.copias;
    if (copias === undefined) return resposta.send({ configurada: false });

    const situacao = await copias.consultar.executar();
    if (situacao.isErr()) return responderErro(resposta, situacao.error);

    return resposta.send({
      configurada: true,
      pasta: copias.pasta,
      ...apresentarSituacao(situacao.value),
    });
  });

  /** A cópia feita agora, por quem pediu. Demora o tempo do `pg_dump` e da prova. */
  servidor.post("/api/copias-de-seguranca", deGerente, async (requisicao, resposta) => {
    const copias = await disponiveis(container, resposta);
    if (copias === undefined) return resposta;

    const usuarioId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (usuarioId === undefined) return resposta.status(401).send();

    const feita = await copias.fazer.executar({ origem: "MANUAL", usuarioId });
    if (feita.isErr()) return responderErro(resposta, feita.error);

    return resposta.status(201).send({ copia: apresentarCopia(feita.value) });
  });

  servidor.put(
    "/api/copias-de-seguranca/agenda",
    deAdministrador,
    async (requisicao, resposta) => {
      const entrada = corpoAgenda.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Confira a agenda das cópias.");

      const copias = await disponiveis(container, resposta);
      if (copias === undefined) return resposta;

      const usuarioId = usuarioAutenticado(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (usuarioId === undefined) return resposta.status(401).send();

      const definida = await copias.definirAgenda.executar({
        usuarioId,
        ...entrada.data,
      });
      if (definida.isErr()) return responderErro(resposta, definida.error);

      return resposta.send({ configuracao: apresentarConfiguracao(definida.value) });
    },
  );

  /** Restaura numa base à parte e mostra o que há dentro — sem trocar nada. */
  servidor.post(
    "/api/copias-de-seguranca/:nome/conferencia",
    deAdministrador,
    async (requisicao, resposta) => {
      const parametros = parametrosDaCopia.safeParse(requisicao.params);
      if (!parametros.success) return recusar(resposta, "Cópia inválida.");

      const copias = await disponiveis(container, resposta);
      if (copias === undefined) return resposta;

      const conferida = await copias.conferir.executar(parametros.data.nome);
      if (conferida.isErr()) return responderErro(resposta, conferida.error);

      return resposta.send({ conferencia: apresentarConferencia(conferida.value) });
    },
  );

  servidor.post(
    "/api/copias-de-seguranca/:nome/restauracao",
    deAdministrador,
    async (requisicao, resposta) => {
      const parametros = parametrosDaCopia.safeParse(requisicao.params);
      const entrada = corpoRestauracao.safeParse(requisicao.body);
      if (!parametros.success || !entrada.success) {
        return recusar(resposta, "Confira o pedido de restauração.");
      }

      const copias = await disponiveis(container, resposta);
      if (copias === undefined) return resposta;

      const autenticado = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (autenticado === undefined) return resposta.status(401).send();

      const usuario = await container.leitura.usuarios.porId(autenticado.usuarioId);

      const restaurada = await copias.restaurar.executar({
        nome: parametros.data.nome,
        confirmacao: entrada.data.confirmacao,
        comCaixasAbertos: entrada.data.comCaixasAbertos,
        usuarioId: autenticado.usuarioId,
        quem: `${usuario?.nome ?? "Usuário"} (matrícula ${autenticado.matricula})`,
      });
      if (restaurada.isErr()) return responderErro(resposta, restaurada.error);

      return resposta.send({
        restaurada: apresentarCopia(restaurada.value.restaurada),
        copiaDeAntes: apresentarCopia(restaurada.value.copiaDeAntes),
      });
    },
  );
}

/**
 * As cópias desta instalação — ou a resposta de que ela não tem.
 *
 * Só acontece fora da produção, onde a pasta pode ficar vazia; na loja, o
 * servidor nem sobe sem ela.
 */
async function disponiveis(
  container: Container,
  resposta: FastifyReply,
): Promise<CopiasDoServidor | undefined> {
  if (container.copias !== undefined) return container.copias;

  await responderErro(
    resposta,
    new ErroRegraNegocio(
      "COPIAS_NAO_CONFIGURADAS",
      "As cópias de segurança não estão configuradas nesta instalação. Chame o suporte.",
    ),
  );

  return undefined;
}

function apresentarSituacao(situacao: SituacaoDasCopias) {
  return {
    copias: situacao.copias.map(apresentarCopia),
    configuracao: apresentarConfiguracao(situacao.configuracao),
    ultimaTentativa:
      situacao.ultimaTentativa === undefined
        ? undefined
        : apresentarTentativa(situacao.ultimaTentativa),
    emAndamento: situacao.emAndamento,
    proximaAutomatica: situacao.proximaAutomatica?.toISOString(),
  };
}

function apresentarConfiguracao(configuracao: ConfiguracaoDeBackup) {
  return {
    intervaloHoras: configuracao.intervaloHoras,
    aoFecharCaixa: configuracao.aoFecharCaixa,
  };
}

function apresentarTentativa(tentativa: ExecucaoDeBackup) {
  return {
    origem: tentativa.origem,
    situacao: tentativa.situacao,
    iniciadaEm: tentativa.iniciadaEm.toISOString(),
    concluidaEm: tentativa.concluidaEm?.toISOString(),
    arquivo: tentativa.arquivo,
    erro: tentativa.erro,
  };
}

function apresentarCopia(copia: CopiaGuardada) {
  return {
    nome: copia.nome,
    criadaEm: copia.criadaEm.toISOString(),
    origem: copia.origem,
    tamanhoBytes: copia.tamanhoBytes,
    sha256: copia.sha256,
    conferida: copia.prova.restaurou,
    ...(copia.prova.restaurou
      ? { resumo: apresentarResumo(copia.prova.resumo) }
      : { motivo: copia.prova.motivo }),
  };
}

function apresentarResumo(resumo: ResumoDoBanco) {
  return {
    vendas: resumo.vendas,
    produtos: resumo.produtos,
    clientes: resumo.clientes,
    primeiraVenda: resumo.primeiraVenda?.toISOString(),
    ultimaVenda: resumo.ultimaVenda?.toISOString(),
    caixasAbertos: resumo.caixasAbertos,
    // A versão do sistema é a última migração: é o que o suporte pergunta.
    versao: resumo.migracoes.at(-1),
  };
}

function apresentarConferencia(conferencia: ConferenciaDaCopia) {
  return {
    copia: apresentarCopia(conferencia.copia),
    restaurou: conferencia.prova.restaurou,
    ...(conferencia.prova.restaurou
      ? { daCopia: apresentarResumo(conferencia.prova.resumo) }
      : { motivo: conferencia.prova.motivo }),
    atual: apresentarResumo(conferencia.atual),
    compativel: conferencia.compativel,
  };
}
