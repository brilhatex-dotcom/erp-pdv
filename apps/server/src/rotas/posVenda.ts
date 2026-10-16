import { vendasRecentes } from "@erp/database";
import { Identificador, type PedidoDeItemDevolvido, type Venda } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { apresentarDevolucao, apresentarVenda } from "../http/apresentacao.js";
import {
  autenticadoTem,
  exigirAutenticacao,
  exigirPermissao,
} from "../http/autenticacao.js";
import {
  identificadorDaRota,
  interpretarQuantidade,
  recusar,
  usuarioAutenticado,
  zQuantidadeNoFio,
  zSupervisor,
} from "../http/entrada.js";
import { responderErro } from "../http/erros.js";

/**
 * Depois da venda: achar o cupom, reimprimir, devolver.
 *
 * ### O comprovante é montado aqui e impresso lá
 *
 * O servidor entrega os **dados** do comprovante, já com o aviso de que não é
 * documento fiscal; quem formata para 58 ou 80 colunas e manda à impressora é
 * o Agente Local (ADR-0023), e na falta dele o navegador imprime a mesma coisa.
 * Os dois partem da mesma resposta, e por isso não divergem.
 */

const consultaRecentes = z.object({
  estacaoId: z.uuid().optional(),
  numero: z.coerce.number().int().min(1).max(99_999_999).optional(),
  limite: z.coerce.number().int().min(1).max(20).optional(),
});

const corpoDevolucao = z.object({
  /** Onde a devolução acontece — de que gaveta sai o dinheiro. */
  estacaoId: z.uuid(),
  itens: z
    .array(
      z.object({
        numeroItem: z.number().int().min(1).max(9999),
        quantidade: zQuantidadeNoFio,
        destino: z.enum(["ESTOQUE", "PERDA"]),
      }),
    )
    .min(1)
    .max(200),
  formaReembolso: z.enum(["DINHEIRO", "PIX", "CARTAO", "ABATER_FIADO"]),
  motivo: z.string().trim().min(3).max(200),
  supervisor: zSupervisor,
});

export function rotasDePosVenda(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);
  const deVenda = {
    preHandler: [autenticado, exigirPermissao(container, "venda:criar")],
  };
  const deDevolucao = {
    preHandler: [autenticado, exigirPermissao(container, "venda:devolver")],
  };

  /**
   * Vendas concluídas e canceladas, mais nova primeiro.
   *
   * Quem não tem `venda:consultar_todas` vê só as próprias: o operador
   * reimprime o cupom que acabou de fazer, mas a lista dos colegas — com
   * valores e clientes — é informação de supervisão.
   */
  servidor.get("/api/vendas/recentes", deVenda, async (requisicao, resposta) => {
    const consulta = consultaRecentes.safeParse(requisicao.query);
    if (!consulta.success) return recusar(resposta, "Consulta inválida.");

    const usuarioId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (usuarioId === undefined) return resposta.status(401).send();

    const todas = await autenticadoTem(container, requisicao, "venda:consultar_todas");

    const achadas = await vendasRecentes(container.prisma, {
      estacaoId: consulta.data.estacaoId,
      numero: consulta.data.numero,
      limite: consulta.data.limite,
      operadorId: todas ? undefined : usuarioId.valor,
    });

    return resposta.send({
      vendas: achadas.map((achada) => ({
        ...apresentarVenda(achada.venda),
        operadorNome: achada.operadorNome,
        clienteNome: achada.clienteNome,
      })),
    });
  });

  servidor.get("/api/vendas/:id/comprovante", deVenda, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const venda = await container.leitura.vendas.porId(vendaId);

    if (venda === undefined) {
      return resposta.status(404).send({
        erro: { codigo: "VENDA_NAO_ENCONTRADA", mensagem: "Venda não encontrada." },
      });
    }

    if (venda.finalizadaEm === undefined) {
      return resposta.status(422).send({
        erro: {
          codigo: "VENDA_NAO_CONCLUIDA",
          mensagem:
            "A venda ainda não foi concluída. O comprovante sai depois do pagamento.",
        },
      });
    }

    return resposta.send(await montarComprovante(container, venda));
  });

  /**
   * As devoluções da venda e o que ainda pode voltar de cada item.
   *
   * O "ainda pode" é calculado aqui só para a tela sugerir o máximo; quem
   * decide de verdade é o domínio, na hora de registrar.
   */
  servidor.get(
    "/api/vendas/:id/devolucoes",
    deDevolucao,
    async (requisicao, resposta) => {
      const vendaId = identificadorDaRota(requisicao);
      if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

      const venda = await container.leitura.vendas.porId(vendaId);

      if (venda === undefined) {
        return resposta.status(404).send({
          erro: { codigo: "VENDA_NAO_ENCONTRADA", mensagem: "Venda não encontrada." },
        });
      }

      const devolucoes = await container.leitura.devolucoes.porVenda(venda.id);
      const devolvido = new Map<number, bigint>();

      for (const devolucao of devolucoes) {
        for (const item of devolucao.itens) {
          devolvido.set(
            item.numeroItem,
            (devolvido.get(item.numeroItem) ?? 0n) + item.quantidade.milesimos,
          );
        }
      }

      return resposta.send({
        venda: apresentarVenda(venda),
        devolucoes: devolucoes.map(apresentarDevolucao),
        restante: venda.itens.map((item) => ({
          numeroItem: item.numero,
          milesimos: (
            item.quantidade.milesimos - (devolvido.get(item.numero) ?? 0n)
          ).toString(),
          unidade: item.quantidade.unidade.codigo,
        })),
      });
    },
  );

  servidor.post(
    "/api/vendas/:id/devolucoes",
    deDevolucao,
    async (requisicao, resposta) => {
      const vendaId = identificadorDaRota(requisicao);
      if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

      const entrada = corpoDevolucao.safeParse(requisicao.body);
      if (!entrada.success) {
        return recusar(resposta, "Informe os itens, a forma de reembolso e o motivo.");
      }

      const itens: PedidoDeItemDevolvido[] = [];

      for (const item of entrada.data.itens) {
        const quantidade = interpretarQuantidade(item.quantidade);
        if (quantidade === "INVALIDA" || quantidade === undefined) {
          return recusar(resposta, "Quantidade inválida.");
        }

        itens.push({ numeroItem: item.numeroItem, quantidade, destino: item.destino });
      }

      const operadorId = usuarioAutenticado(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (operadorId === undefined) return resposta.status(401).send();

      const resultado = await container.registrarDevolucao.executar({
        vendaId,
        estacaoId: Identificador.criar(entrada.data.estacaoId).unwrap(),
        operadorId,
        itens,
        formaReembolso: entrada.data.formaReembolso,
        motivo: entrada.data.motivo,
        credencialSupervisor: entrada.data.supervisor,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentarDevolucao(resultado.unwrap()));
    },
  );
}

/**
 * Os dados do comprovante, prontos para 58 ou 80 colunas.
 *
 * **Sempre** marcado como não fiscal: um comprovante de venda que se parece
 * com cupom fiscal é o que a fiscalização autua, e o cliente que o guarda
 * achando que é nota não tem como pedir crédito de imposto com ele.
 */
async function montarComprovante(
  container: Container,
  venda: Venda,
): Promise<Record<string, unknown>> {
  const [empresa, { configuracao: loja }, operador, cliente] = await Promise.all([
    container.leitura.empresa.atual(),
    container.obterConfiguracao.executar(),
    container.leitura.usuarios.porId(venda.operadorId),
    venda.clienteId === undefined
      ? Promise.resolve(undefined)
      : container.leitura.clientes.porId(venda.clienteId),
  ]);

  return {
    aviso: "NÃO É DOCUMENTO FISCAL",
    treinamento: container.modo === "TREINAMENTO",
    larguraCupom: loja.larguraCupom,
    logoId: loja.logoId?.valor,
    loja:
      empresa === undefined
        ? undefined
        : {
            nome: empresa.exibicao,
            razaoSocial: empresa.razaoSocial,
            cnpj: empresa.cnpj.formatar(),
            endereco: empresa.endereco.linhaUnica(),
            telefone: empresa.telefone?.formatar(),
          },
    operadorNome: operador?.nome ?? "—",
    clienteNome: cliente?.exibicao,
    emitidoEm: container.relogio.agora().toISOString(),
    venda: apresentarVenda(venda),
  };
}
