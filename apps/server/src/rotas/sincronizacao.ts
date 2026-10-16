import {
  type CodigoFormaPagamento,
  Dinheiro,
  type DomainError,
  ehCodigoFormaPagamento,
  Identificador,
  type Quantidade,
} from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { interpretarQuantidade } from "../http/entrada.js";
import { responderErro } from "../http/erros.js";

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

      // Tudo o que pode ser recusado por formato é conferido **antes** de a
      // venda existir: recusar no meio deixaria uma venda pela metade no
      // servidor.
      const itens = interpretarItens(dados.itens);
      if (itens === "INVALIDA") return recusar(resposta, "Quantidade inválida.");

      const pagamentos = interpretarPagamentos(dados.pagamentos);
      if (pagamentos === "INVALIDA") {
        return recusar(resposta, "Forma de pagamento não reconhecida.");
      }

      const iniciada = await container.iniciarVenda.executar({
        estacaoId: Identificador.criar(dados.estacaoId).unwrap(),
        operadorId,
      });

      if (iniciada.isErr()) return responderErro(resposta, iniciada.error);

      const vendaId = iniciada.unwrap().id;

      const falha = await remontar(container, vendaId, operadorId, itens, pagamentos);

      if (falha !== undefined) {
        // Produto apagado depois da venda offline, preço que subiu e não fecha
        // mais com o que foi pago: são recusas de negócio, e a estação não deve
        // reenviar para sempre. A venda que ficou pela metade é descartada —
        // aberta com itens, ela impediria o fechamento deste caixa.
        const descartada = await container.cancelarVenda.executar({
          vendaId,
          operadorId,
          motivo: `Venda offline recusada na importação: ${falha.mensagem}`,
        });

        if (descartada.isErr()) {
          requisicao.log.warn(
            { vendaId: vendaId.valor, codigo: descartada.error.codigo },
            "venda offline recusada ficou aberta no servidor",
          );
        }

        return responderErro(resposta, falha);
      }

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

interface ItemImportado {
  readonly codigo: string;
  readonly quantidade: Quantidade | undefined;
}

interface PagamentoImportado {
  readonly forma: CodigoFormaPagamento;
  readonly valor: Dinheiro;
  readonly parcelas: number | undefined;
}

function interpretarItens(
  brutos: z.infer<typeof corpoImportacao>["itens"],
): readonly ItemImportado[] | "INVALIDA" {
  const itens: ItemImportado[] = [];

  for (const bruto of brutos) {
    const quantidade = interpretarQuantidade(bruto.quantidade);
    if (quantidade === "INVALIDA") return "INVALIDA";

    itens.push({ codigo: bruto.codigo, quantidade });
  }

  return itens;
}

function interpretarPagamentos(
  brutos: z.infer<typeof corpoImportacao>["pagamentos"],
): readonly PagamentoImportado[] | "INVALIDA" {
  const pagamentos: PagamentoImportado[] = [];

  for (const bruto of brutos) {
    if (!ehCodigoFormaPagamento(bruto.forma)) return "INVALIDA";

    pagamentos.push({
      forma: bruto.forma,
      // O schema só deixa passar inteiro positivo.
      valor: Dinheiro.deCentavos(BigInt(bruto.valor)).unwrap(),
      parcelas: bruto.parcelas,
    });
  }

  return pagamentos;
}

/**
 * Passa a venda offline pelos casos de uso do balcão.
 *
 * Com `origem: "IMPORTACAO"`: a venda **já aconteceu**, e as regras que
 * existem para impedir uma venda (estoque, limite de fiado) não têm mais o
 * que impedir — recusar agora só perderia o registro do que saiu da loja.
 */
async function remontar(
  container: Container,
  vendaId: Identificador,
  operadorId: Identificador,
  itens: readonly ItemImportado[],
  pagamentos: readonly PagamentoImportado[],
): Promise<DomainError | undefined> {
  for (const item of itens) {
    const adicionado = await container.adicionarItem.executar({
      vendaId,
      operadorId,
      codigo: item.codigo,
      quantidade: item.quantidade,
      origem: "IMPORTACAO",
    });

    if (adicionado.isErr()) return adicionado.error;
  }

  for (const pagamento of pagamentos) {
    const registrado = await container.registrarPagamento.executar({
      vendaId,
      operadorId,
      forma: pagamento.forma,
      valor: pagamento.valor,
      parcelas: pagamento.parcelas,
      origem: "IMPORTACAO",
    });

    if (registrado.isErr()) return registrado.error;
  }

  const finalizada = await container.finalizarVenda.executar({ vendaId });

  return finalizada.isErr() ? finalizada.error : undefined;
}

function operadorAutenticado(requisicao: FastifyRequest): Identificador | undefined {
  return requisicao.autenticado?.usuarioId;
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
