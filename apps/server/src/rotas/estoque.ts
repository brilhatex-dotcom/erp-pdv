import { Identificador, type MovimentoEstoque, type Permissao } from "@erp/domain";
import { extratoDeEstoque, saldosDeEstoque } from "@erp/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { autenticadoTem, exigirAutenticacao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Rotas de estoque.
 *
 * ### A permissão depende do **tipo** do movimento, não da rota
 *
 * Dar entrada de mercadoria e lançar uma perda são decisões diferentes: a
 * primeira é rotina do estoquista, a segunda reduz patrimônio e precisa de
 * justificativa. Uma permissão só para as duas obrigaria a loja a escolher
 * entre ninguém dar entrada e todo mundo poder baixar mercadoria.
 *
 * Por isso o mapa abaixo, e por isso ele é conferido **no servidor**: a tela
 * esconde o que o operador não pode fazer, mas quem esconde não decide.
 *
 * ### O custo é conferido por campo
 *
 * Mesmo critério do catálogo: `produto:ver_custo` decide se o custo sai na
 * resposta e se o custo enviado é aceito. Sem isso, quem não vê a margem da
 * loja poderia gravá-la — ou lê-la pela aba de rede do navegador.
 */

const PERMISSAO_POR_TIPO: Readonly<Record<string, Permissao>> = {
  ENTRADA: "estoque:entrada",
  DEVOLUCAO_CLIENTE: "estoque:entrada",
  AJUSTE_POSITIVO: "estoque:ajuste",
  AJUSTE_NEGATIVO: "estoque:ajuste",
  PERDA: "estoque:ajuste",
  DEVOLUCAO_FORNECEDOR: "estoque:ajuste",
};

/** Milésimos em texto — quantidade fracionada nunca vira `number` (ADR-0009). */
const zMilesimos = z.string().regex(/^\d{1,15}$/, "quantidade inválida");
const zCentavos = z.string().regex(/^\d{1,15}$/, "valor inválido");

const corpoMovimento = z.object({
  produtoId: z.uuid(),
  tipo: z.enum([
    "ENTRADA",
    "DEVOLUCAO_CLIENTE",
    "AJUSTE_POSITIVO",
    "AJUSTE_NEGATIVO",
    "PERDA",
    "DEVOLUCAO_FORNECEDOR",
  ]),
  quantidade: zMilesimos,
  unidade: z.enum([
    "UN",
    "PC",
    "CX",
    "FD",
    "PCT",
    "DZ",
    "KG",
    "G",
    "L",
    "ML",
    "M",
    "M2",
    "M3",
    "SC",
  ]),
  custoUnitario: zCentavos.optional(),
  lote: z.string().trim().min(1).max(30).optional(),
  observacao: z.string().trim().min(1).max(500).optional(),
});

const consultaSaldos = z.object({
  termo: z.string().max(120).optional(),
  situacao: z.enum(["TODOS", "NEGATIVO", "ZERADO", "COM_SALDO"]).optional(),
  apenasAtivos: z.enum(["true", "false"]).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

const consultaExtrato = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export function rotasDeEstoque(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);

  /**
   * Saldo por produto.
   *
   * Exige **apenas autenticação**. "Tem no estoque?" é pergunta de balcão, e o
   * operador que não consegue respondê-la manda o cliente embora. O que é
   * sensível — custo médio e valor imobilizado — sai por `produto:ver_custo`.
   */
  servidor.get(
    "/api/estoque/saldos",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const consulta = consultaSaldos.safeParse(requisicao.query);
      if (!consulta.success) return recusar(resposta, "Consulta inválida.");

      const saldos = await saldosDeEstoque(container.prisma, {
        termo: consulta.data.termo,
        situacao: consulta.data.situacao,
        apenasAtivos: consulta.data.apenasAtivos !== "false",
        limite: consulta.data.limite,
        comCusto: await autenticadoTem(container, requisicao, "produto:ver_custo"),
      });

      return resposta.send({ itens: saldos });
    },
  );

  /**
   * Extrato de um produto.
   *
   * É a resposta para "por que o saldo está assim" — a pergunta que aparece
   * toda vez que a contagem física não bate. Sem ela, o suporte responderia
   * lendo o banco na loja do cliente.
   */
  servidor.get(
    "/api/estoque/produtos/:id/movimentos",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Produto inválido.");

      const consulta = consultaExtrato.safeParse(requisicao.query);
      if (!consulta.success) return recusar(resposta, "Consulta inválida.");

      const movimentos = await extratoDeEstoque(container.prisma, id.valor, {
        limite: consulta.data.limite,
        comCusto: await autenticadoTem(container, requisicao, "produto:ver_custo"),
      });

      return resposta.send({ itens: movimentos });
    },
  );

  /**
   * Lança um movimento.
   *
   * A permissão sai do tipo (ver o mapa no topo). `SAIDA` e as transferências
   * não estão sequer no esquema aceito: saída é a venda, e transferência não
   * tem destino numa instalação que é uma loja só (ADR-0024). O caso de uso
   * também as recusa — a validação dupla é de propósito, porque o esquema
   * protege a fronteira e o caso de uso protege a regra.
   */
  servidor.post(
    "/api/estoque/movimentos",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const entrada = corpoMovimento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Confira os dados do movimento.");

      const necessaria = PERMISSAO_POR_TIPO[entrada.data.tipo];

      /* v8 ignore next -- inalcançável: o enum do esquema cobre o mapa inteiro */
      if (necessaria === undefined)
        return recusar(resposta, "Tipo de movimento inválido.");

      if (!(await autenticadoTem(container, requisicao, necessaria))) {
        return resposta.status(403).send({
          erro: {
            codigo: "SEM_PERMISSAO",
            mensagem: "Você não pode lançar este tipo de movimento. Chame o supervisor.",
            detalhes: { permissaoNecessaria: necessaria },
          },
        });
      }

      const autor = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (autor === undefined) return resposta.status(401).send();

      const produtoId = Identificador.criar(entrada.data.produtoId);
      /* v8 ignore next -- inalcançável: o esquema já validou o formato */
      if (produtoId.isErr()) return recusar(resposta, "Produto inválido.");

      // Quem não pode ver o custo também não o define: aceitar o número que ele
      // mandou seria gravar margem vinda de um campo que a tela dele não mostra.
      const podeVerCusto = await autenticadoTem(
        container,
        requisicao,
        "produto:ver_custo",
      );

      const resultado = await container.registrarMovimento.executar({
        produtoId: produtoId.unwrap(),
        tipo: entrada.data.tipo,
        quantidade: BigInt(entrada.data.quantidade),
        unidade: entrada.data.unidade,
        custoUnitario:
          podeVerCusto && entrada.data.custoUnitario !== undefined
            ? BigInt(entrada.data.custoUnitario)
            : undefined,
        lote: entrada.data.lote,
        observacao: entrada.data.observacao,
        usuarioId: autor.usuarioId,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentar(resultado.unwrap(), podeVerCusto));
    },
  );
}

function apresentar(
  movimento: MovimentoEstoque,
  podeVerCusto: boolean,
): Record<string, unknown> {
  return {
    id: movimento.id.valor,
    produtoId: movimento.produtoId.valor,
    tipo: movimento.tipo,
    // Milésimos em texto: quantidade de balança tem três casas, e `number`
    // devolveria 0.30000000000000004 no primeiro relatório somado.
    quantidade: movimento.quantidade.milesimos.toString(),
    unidade: movimento.quantidade.unidade.codigo,
    origemTipo: movimento.origem.tipo,
    ...(podeVerCusto && movimento.custoUnitario !== undefined
      ? { custoUnitario: movimento.custoUnitario.centavos.toString() }
      : {}),
    lote: movimento.lote,
    observacao: movimento.observacao,
    ocorridoEm: movimento.ocorridoEm.toISOString(),
  };
}

function identificadorDaRota(requisicao: FastifyRequest): Identificador | undefined {
  const id = (requisicao.params as { id?: string }).id;
  /* v8 ignore next -- inalcançável: a rota só casa com o parâmetro presente */
  if (id === undefined) return undefined;

  const identificador = Identificador.criar(id);
  return identificador.isErr() ? undefined : identificador.unwrap();
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
