import { Dinheiro, ehCodigoFormaPagamento, Identificador } from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";
import { interpretarQuantidade } from "./vendas.js";

/**
 * Recebimento das vendas que a estação registrou offline.
 *
 * ### Reenviar não pode duplicar
 *
 * A resposta desta rota pode se perder na rede **depois** de a venda ter sido
 * gravada. A estação, sem receber confirmação, reenvia. Sem proteção, a segunda
 * chamada criaria uma venda nova, e o fechamento de caixa acusaria dinheiro que
 * não existe — com o agravante de ninguém conseguir explicar de onde veio.
 *
 * A `chave` é o identificador que a estação gerou antes de qualquer ida ao
 * servidor. Ela é chave primária de `vendas_importadas`: a segunda chamada
 * encontra o registro e responde `jaExistia`, sem tocar em nada.
 *
 * ### A venda é remontada pelos mesmos casos de uso
 *
 * Nada aqui grava direto. A venda offline passa por `IniciarVenda`,
 * `AdicionarItemPorCodigo`, `RegistrarPagamento` e `FinalizarVenda`, como uma
 * venda de balcão — porque é isso que ela é. Um caminho de gravação paralelo
 * seria um segundo lugar onde a regra de negócio precisaria ser mantida, e o
 * segundo lugar sempre diverge.
 *
 * ### O preço é o do cadastro, não o da estação
 *
 * A estação registrou com o preço que a réplica conhecia. Se ele mudou, a venda
 * entra com o preço atual — e a diferença aparece no relatório, para o gerente
 * decidir. Aceitar o preço enviado pelo cliente abriria a porta para qualquer
 * um definir quanto pagou.
 */

const corpoImportacao = z.object({
  /** Identificador gerado na estação. */
  chave: z.string().min(8).max(64),
  estacaoId: z.uuid(),
  registradaEm: z.iso.datetime(),
  itens: z
    .array(
      z.object({
        codigo: z.string().min(1).max(60),
        quantidade: z
          .object({
            milesimos: z.string().regex(/^[1-9]\d*$/),
            unidade: z.string().min(1).max(6),
          })
          .optional(),
      }),
    )
    .min(1),
  pagamentos: z
    .array(
      z.object({
        forma: z.string().min(1).max(30),
        valor: z.string().regex(/^[1-9]\d*$/),
        parcelas: z.number().int().positive().max(36).optional(),
      }),
    )
    .min(1),
});

export function rotasDeSincronizacao(
  servidor: FastifyInstance,
  container: Container,
): void {
  servidor.post(
    "/api/sincronizacao/vendas",
    {
      preHandler: [
        exigirAutenticacao(container),
        exigirPermissao(container, "venda:criar"),
      ],
    },
    async (requisicao, resposta) => {
      const entrada = corpoImportacao.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Venda offline malformada.");

      const dados = entrada.data;

      // Idempotência antes de qualquer escrita: é o ponto inteiro desta rota.
      const jaImportada = await container.prisma.vendaImportada.findUnique({
        where: { chave: dados.chave },
      });

      if (jaImportada !== null) {
        return resposta.send({
          jaExistia: true,
          vendaId: jaImportada.vendaId,
        });
      }

      const operadorId = operadorAutenticado(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (operadorId === undefined) return resposta.status(401).send();

      const iniciada = await container.iniciarVenda.executar({
        estacaoId: Identificador.criar(dados.estacaoId).unwrap(),
        operadorId,
      });

      if (iniciada.isErr()) return responderErro(resposta, iniciada.error);

      const vendaId = iniciada.unwrap().id;

      for (const item of dados.itens) {
        const quantidade = interpretarQuantidade(item.quantidade);
        if (quantidade === "INVALIDA") return recusar(resposta, "Quantidade inválida.");

        const adicionado = await container.adicionarItem.executar({
          vendaId,
          codigo: item.codigo,
          quantidade,
        });

        // Produto apagado depois da venda offline, estoque insuficiente: são
        // recusas de negócio, e a estação não deve reenviar para sempre.
        if (adicionado.isErr()) return responderErro(resposta, adicionado.error);
      }

      for (const pagamento of dados.pagamentos) {
        if (!ehCodigoFormaPagamento(pagamento.forma)) {
          return recusar(resposta, "Forma de pagamento não reconhecida.");
        }

        const registrado = await container.registrarPagamento.executar({
          vendaId,
          forma: pagamento.forma,
          valor: Dinheiro.deCentavos(BigInt(pagamento.valor)).unwrap(),
          parcelas: pagamento.parcelas,
        });

        if (registrado.isErr()) return responderErro(resposta, registrado.error);
      }

      const finalizada = await container.finalizarVenda.executar({ vendaId });
      if (finalizada.isErr()) return responderErro(resposta, finalizada.error);

      // A marca de importada é gravada **depois** de a venda existir: gravá-la
      // antes faria uma falha no meio do caminho bloquear o reenvio de uma
      // venda que nunca chegou a ser criada.
      await container.prisma.vendaImportada.create({
        data: {
          chave: dados.chave,
          vendaId: vendaId.valor,
          estacaoId: dados.estacaoId,
        },
      });

      return resposta.status(201).send({ jaExistia: false, vendaId: vendaId.valor });
    },
  );
}

function operadorAutenticado(requisicao: FastifyRequest): Identificador | undefined {
  return requisicao.autenticado?.usuarioId;
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
