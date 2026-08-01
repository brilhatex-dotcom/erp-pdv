import { notasDeCompra } from "@erp/database";
import { Identificador, type NotaDeCompra } from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import {
  autenticadoTem,
  exigirAutenticacao,
  exigirPermissao,
} from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Rotas de compras — entrada de mercadoria.
 *
 * ### A permissão é a do estoque, não uma nova
 *
 * Lançar nota é dar entrada de mercadoria, e quem faz isso já tem
 * `estoque:entrada`. Criar `compra:lancar` significaria concedê-la exatamente
 * às mesmas pessoas — permissão que acompanha outra não decide nada e só faz o
 * administrador se perguntar o que ela é.
 *
 * Cancelar é diferente: **estorna estoque**, e por isso exige `estoque:ajuste`,
 * a mesma que protege perda e ajuste de inventário.
 *
 * ### O custo não é escondido aqui
 *
 * Ao contrário do catálogo, a nota **é** um documento de custo: não existe
 * lançá-la sem digitar o que se pagou. Esconder o campo tornaria a tela
 * inutilizável, então o corte é na rota inteira — quem não tem
 * `estoque:entrada` não vê nota nenhuma.
 */

/** Centavos em texto — dinheiro nunca atravessa a fronteira como `number`. */
const zCentavos = z.string().regex(/^\d{1,15}$/, "valor inválido");
/** Milésimos em texto, pelo mesmo motivo. */
const zMilesimos = z.string().regex(/^\d{1,15}$/, "quantidade inválida");

const zItem = z.object({
  produtoId: z.uuid(),
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
  custoUnitario: zCentavos,
  desconto: zCentavos.optional(),
});

const corpoNota = z.object({
  fornecedorId: z.uuid(),
  numero: z.string().trim().min(1).max(20),
  serie: z.string().trim().max(5).optional(),
  /** Data pura (`2026-07-28`): a nota não tem hora, e inventar uma confunde. */
  emitidaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida"),
  recebidaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida"),
  itens: z.array(zItem).min(1).max(200),
  totalDeclarado: zCentavos,
  observacao: z.string().trim().min(1).max(500).optional(),
});

const corpoCancelamento = z.object({
  motivo: z.string().trim().min(1).max(500),
});

const consultaNotas = z.object({
  termo: z.string().max(120).optional(),
  fornecedorId: z.uuid().optional(),
  incluirCanceladas: z.enum(["true", "false"]).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export function rotasDeCompras(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);

  const protegida = (permissao: Parameters<typeof exigirPermissao>[1]) => ({
    preHandler: [autenticado, exigirPermissao(container, permissao)],
  });

  servidor.get(
    "/api/compras/notas",
    protegida("estoque:entrada"),
    async (requisicao, resposta) => {
      const consulta = consultaNotas.safeParse(requisicao.query);
      if (!consulta.success) return recusar(resposta, "Consulta inválida.");

      const notas = await notasDeCompra(container.prisma, {
        termo: consulta.data.termo,
        fornecedorId: consulta.data.fornecedorId,
        incluirCanceladas: consulta.data.incluirCanceladas === "true",
        limite: consulta.data.limite,
      });

      return resposta.send({ itens: notas });
    },
  );

  servidor.get(
    "/api/compras/notas/:id",
    protegida("estoque:entrada"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Nota inválida.");

      const nota = await container.leitura.notasDeCompra.porId(id);

      if (nota === undefined) {
        return resposta.status(404).send({
          erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Nota não encontrada." },
        });
      }

      return resposta.send(apresentar(nota));
    },
  );

  servidor.post(
    "/api/compras/notas",
    protegida("estoque:entrada"),
    async (requisicao, resposta) => {
      const entrada = corpoNota.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Confira os dados da nota.");

      const fornecedorId = Identificador.criar(entrada.data.fornecedorId);
      /* v8 ignore next -- inalcançável: o esquema já validou o formato */
      if (fornecedorId.isErr()) return recusar(resposta, "Fornecedor inválido.");

      const itens = interpretarItens(entrada.data.itens);
      if (itens === "INVALIDO") return recusar(resposta, "Produto inválido na nota.");

      const autor = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (autor === undefined) return resposta.status(401).send();

      const resultado = await container.lancarNotaDeCompra.executar({
        fornecedorId: fornecedorId.unwrap(),
        numero: entrada.data.numero,
        serie: entrada.data.serie,
        emitidaEm: comoData(entrada.data.emitidaEm),
        recebidaEm: comoData(entrada.data.recebidaEm),
        itens,
        totalDeclarado: BigInt(entrada.data.totalDeclarado),
        observacao: entrada.data.observacao,
        usuarioId: autor.usuarioId,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentar(resultado.unwrap()));
    },
  );

  /**
   * Cancela a nota e estorna o estoque.
   *
   * `POST` num sub-recurso, e não `DELETE`: nada é apagado. A nota continua
   * existindo, marcada, com o motivo e os movimentos de estorno ao lado dos
   * originais — fato é imutável (princípio 5).
   */
  servidor.post(
    "/api/compras/notas/:id/cancelamento",
    protegida("estoque:ajuste"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Nota inválida.");

      const entrada = corpoCancelamento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o motivo do cancelamento.");

      const autor = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (autor === undefined) return resposta.status(401).send();

      const resultado = await container.cancelarNotaDeCompra.executar({
        id,
        motivo: entrada.data.motivo,
        usuarioId: autor.usuarioId,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentar(resultado.unwrap()));
    },
  );

  /**
   * Quem pode cancelar? A tela precisa saber para esconder o botão.
   *
   * Devolvido junto com a lista seria mais econômico, mas misturaria a
   * permissão de quem pergunta com o dado perguntado. Aqui é explícito.
   */
  servidor.get(
    "/api/compras/permissoes",
    protegida("estoque:entrada"),
    async (requisicao, resposta) =>
      resposta.send({
        podeCancelar: await autenticadoTem(container, requisicao, "estoque:ajuste"),
      }),
  );
}

function apresentar(nota: NotaDeCompra): Record<string, unknown> {
  return {
    id: nota.id.valor,
    fornecedorId: nota.fornecedorId.valor,
    numero: nota.numero,
    serie: nota.serie,
    emitidaEm: nota.emitidaEm.toISOString(),
    recebidaEm: nota.recebidaEm.toISOString(),
    // Centavos em texto: é dinheiro atravessando a fronteira.
    total: nota.total.centavos.toString(),
    totalDeclarado: nota.totalDeclarado.centavos.toString(),
    status: nota.status,
    observacao: nota.observacao,
    motivoCancelamento: nota.motivoCancelamento,
    canceladaEm: nota.canceladaEm?.toISOString(),
    itens: nota.itens.map((item) => ({
      numero: item.numero,
      produtoId: item.produtoId.valor,
      descricao: item.descricao,
      quantidade: item.quantidade.milesimos.toString(),
      unidade: item.quantidade.unidade.codigo,
      custoUnitario: item.custoUnitario.centavos.toString(),
      desconto: item.desconto.centavos.toString(),
      total: item.total.centavos.toString(),
    })),
  };
}

type ItemInterpretado = Parameters<
  Container["lancarNotaDeCompra"]["executar"]
>[0]["itens"][number];

function interpretarItens(
  brutos: readonly z.infer<typeof zItem>[],
): readonly ItemInterpretado[] | "INVALIDO" {
  const itens: ItemInterpretado[] = [];

  for (const bruto of brutos) {
    const produtoId = Identificador.criar(bruto.produtoId);
    /* v8 ignore next -- inalcançável: o esquema já validou o formato */
    if (produtoId.isErr()) return "INVALIDO";

    itens.push({
      produtoId: produtoId.unwrap(),
      quantidade: BigInt(bruto.quantidade),
      unidade: bruto.unidade,
      custoUnitario: BigInt(bruto.custoUnitario),
      ...(bruto.desconto === undefined ? {} : { desconto: BigInt(bruto.desconto) }),
    });
  }

  return itens;
}

/**
 * `"2026-07-28"` → meio-dia UTC daquele dia.
 *
 * Meio-dia, e não meia-noite: a loja pode estar em qualquer fuso do país, e
 * meia-noite UTC vira o **dia anterior** em todos eles. A nota não tem hora, e
 * o que precisa sobreviver é a data.
 */
function comoData(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
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
