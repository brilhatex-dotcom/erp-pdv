import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";

const consulta = z.object({ codigo: z.string().min(1).max(60) });

/**
 * Consulta de produto — a rota mais percorrida do sistema.
 *
 * Existe aqui para provar a corrente inteira ponta a ponta: token conferido →
 * permissão decidida **no servidor** → caso de uso → repositório → Postgres.
 * As demais rotas de catálogo entram na etapa do módulo de cadastros.
 *
 * `produto:ver_custo` é verificado **por campo**, não por rota. Esconder o
 * custo só na interface seria acordo de cavalheiros: quem abrir a aba de rede
 * do navegador veria a margem da loja inteira.
 */
export function rotasDeProdutos(servidor: FastifyInstance, container: Container): void {
  servidor.get(
    "/api/produtos/buscar",
    {
      preHandler: [
        exigirAutenticacao(container),
        exigirPermissao(container, "venda:criar"),
      ],
    },
    async (requisicao, resposta) => {
      const entrada = consulta.safeParse(requisicao.query);

      if (!entrada.success) {
        return resposta.status(400).send({
          erro: {
            codigo: "REQUISICAO_INVALIDA",
            mensagem: "Informe o código do produto.",
          },
        });
      }

      const produto = await container.leitura.produtos.porCodigo(entrada.data.codigo);

      if (produto === undefined) {
        return resposta.status(404).send({
          erro: {
            codigo: "PRODUTO_NAO_ENCONTRADO",
            mensagem: "Produto não encontrado. Confira o código.",
          },
        });
      }

      const autenticado = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (autenticado === undefined) return resposta.status(401).send();

      const quemPergunta = await container.leitura.usuarios.porId(autenticado.usuarioId);
      const podeVerCusto = quemPergunta?.temPermissao("produto:ver_custo") ?? false;

      return resposta.send({
        id: produto.id.valor,
        sku: produto.sku,
        descricao: produto.descricao,
        descricaoPdv: produto.descricaoPdv,
        tipo: produto.tipo,
        unidade: produto.unidadeBase.codigo,
        // Centavos em texto: `number` perderia precisão em valores grandes, e é
        // dinheiro que está atravessando a fronteira.
        precoVenda: produto.precoVenda.centavos.toString(),
        ...(podeVerCusto ? { custo: produto.custo.centavos.toString() } : {}),
        ativo: produto.ativo,
      });
    },
  );
}
