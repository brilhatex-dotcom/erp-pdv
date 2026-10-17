import {
  ErroInfraestrutura,
  exemplosDeCodigo,
  PESSOAS_DE_TREINO,
} from "@erp/application";
import type { DomainError } from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * As rotas próprias do modo treinamento (ADR-0026), registradas só no
 * container do treino — e, portanto, só sob `/treino`.
 *
 * ### A consulta é pública, e prepara a loja
 *
 * A tela de entrada do treino precisa dela **antes** de alguém entrar: é ela
 * que mostra com quem entrar. Os PINs que vão na resposta são públicos por
 * definição — as pessoas só existem no banco de treino, e o token delas não
 * vale fora dele.
 *
 * Responder é também o momento de montar a loja quando o banco está vazio: a
 * primeira abertura do treino, ou a seguinte ao "recomeçar". Assim nada
 * depende de o servidor ter conseguido prepará-la na partida.
 *
 * ### Recomeçar exige sessão
 *
 * Qualquer pessoa de treino pode recomeçar — o objetivo é este —, mas não
 * qualquer página aberta no navegador da loja: o token vai no cabeçalho, que
 * um formulário de outro site não consegue mandar.
 */
export function rotasDeTreinamento(
  servidor: FastifyInstance,
  container: Container,
): void {
  const loja = container.treinamento;
  /* v8 ignore next -- inalcançável: o servidor só registra estas rotas no container do treino */
  if (loja === undefined) return;

  servidor.get("/api/treinamento", async (requisicao, resposta) => {
    const preparada = await loja.preparar();

    if (preparada.isErr()) {
      return indisponivel(requisicao, resposta, preparada.error);
    }

    return resposta.send({
      pessoas: PESSOAS_DE_TREINO.map((pessoa) => ({
        matricula: pessoa.matricula,
        nome: pessoa.nome,
        pin: pessoa.pin,
        oQueFaz: pessoa.oQueFaz,
      })),
      exemplos: exemplosDeCodigo(),
    });
  });

  servidor.post(
    "/api/treinamento/recomecar",
    { preHandler: exigirAutenticacao(container) },
    async (requisicao, resposta) => {
      const recomecado = await loja.recomecar();

      if (recomecado.isErr()) {
        return indisponivel(requisicao, resposta, recomecado.error);
      }

      return resposta.status(204).send();
    },
  );
}

/**
 * O treino que não deu certo, dito para quem está no balcão.
 *
 * Falha de banco vira 503 com uma frase que diz o que fazer; o detalhe técnico
 * fica no log. Erro de regra — o banco que se recusou a esvaziar — segue como
 * qualquer outro, com a mensagem que ele próprio escreveu.
 */
async function indisponivel(
  requisicao: FastifyRequest,
  resposta: FastifyReply,
  erro: DomainError,
): Promise<void> {
  requisicao.log.warn(
    { codigo: erro.codigo, detalhes: erro.detalhes },
    "treinamento indisponível",
  );

  if (!(erro instanceof ErroInfraestrutura)) return responderErro(resposta, erro);

  await resposta.status(503).send({
    erro: {
      codigo: "TREINAMENTO_INDISPONIVEL",
      mensagem:
        "O treinamento não está disponível agora. O caixa de verdade não foi afetado; avise o responsável pela loja.",
    },
  });
}
