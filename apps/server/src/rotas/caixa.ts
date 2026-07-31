import { Dinheiro, Identificador } from "@erp/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Abertura e consulta do caixa da estação.
 *
 * É a primeira coisa do dia, e sem ela nenhuma venda começa: `IniciarVenda`
 * exige sessão aberta, porque venda sem caixa não tem onde creditar o dinheiro
 * e só aparece no fechamento, quando a gaveta não corresponde a lançamento
 * nenhum.
 *
 * O fundo de troco trafega como **texto de centavos**, como todo dinheiro que
 * cruza a fronteira.
 */

const corpoAbertura = z.object({
  estacaoId: z.uuid(),
  fundoTroco: z.string().regex(/^\d{1,15}$/, "valor inválido"),
});

export function rotasDeCaixa(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);

  servidor.post(
    "/api/caixa/abrir",
    { preHandler: [autenticado, exigirPermissao(container, "caixa:abrir")] },
    async (requisicao, resposta) => {
      const entrada = corpoAbertura.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe a estação e o fundo.");

      const sessao = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (sessao === undefined) return resposta.status(401).send();

      const resultado = await container.abrirCaixa.executar({
        estacaoId: Identificador.criar(entrada.data.estacaoId).unwrap(),
        operadorId: sessao.usuarioId,
        fundoTroco: Dinheiro.deCentavos(BigInt(entrada.data.fundoTroco)).unwrap(),
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentar(resultado.unwrap()));
    },
  );

  /**
   * O caixa aberto da estação, se houver.
   *
   * Responde **204**, e não 404: "ainda não abriu o caixa" é resposta legítima
   * do começo do dia, não recurso que sumiu. O PDV usa isso para decidir entre
   * mostrar a tela de abertura e a tela de venda.
   */
  servidor.get(
    "/api/caixa/aberto",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const estacaoId = z
        .uuid()
        .safeParse((requisicao.query as { estacaoId?: string }).estacaoId);

      if (!estacaoId.success) return recusar(resposta, "Informe a estação.");

      const caixa = await container.leitura.caixas.abertaNaEstacao(
        Identificador.criar(estacaoId.data).unwrap(),
      );

      if (caixa === undefined) return resposta.status(204).send();

      return resposta.send(apresentar(caixa));
    },
  );
}

function apresentar(caixa: {
  id: Identificador;
  estacaoId: Identificador;
  fundoTroco: Dinheiro;
  esperadoEmDinheiro: Dinheiro;
  totalVendido: Dinheiro;
  quantidadeVendas: number;
  abertaEm: Date;
}): Record<string, unknown> {
  return {
    id: caixa.id.valor,
    estacaoId: caixa.estacaoId.valor,
    fundoTroco: caixa.fundoTroco.centavos.toString(),
    esperadoEmDinheiro: caixa.esperadoEmDinheiro.centavos.toString(),
    totalVendido: caixa.totalVendido.centavos.toString(),
    quantidadeVendas: caixa.quantidadeVendas,
    abertaEm: caixa.abertaEm.toISOString(),
  };
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
