import {
  Dinheiro,
  ehCodigoFormaPagamento,
  ehCodigoUnidade,
  Identificador,
  Quantidade,
  type Venda,
  type VendaItem,
} from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Rotas da venda — o caminho quente do produto.
 *
 * Duas decisões atravessam todas elas.
 *
 * **O operador vem do token, nunca do corpo.** Aceitar `operadorId` na
 * requisição permitiria a qualquer estação atribuir uma venda a outra pessoa, e
 * a auditoria passaria a apontar quem não vendeu — pior que não ter auditoria,
 * porque parece prova. A matrícula de quem vende é a de quem está autenticado,
 * e ponto.
 *
 * **Dinheiro e quantidade trafegam como inteiro em texto.** `JSON.parse`
 * transforma número em `double`, que é o que o ADR-0009 proíbe para dinheiro.
 * O risco real não é estourar a precisão — nenhum cliente chega perto —, é o
 * valor ser somado ou dividido em algum ponto do caminho e voltar com casas que
 * não existem em centavos. O defeito aparece no fechamento de caixa, como um
 * centavo que ninguém explica.
 */

const zIdentificador = z.uuid();

const zInteiroPositivo = z.string().regex(/^[1-9]\d*$/, "valor deve ser positivo");

const corpoIniciar = z.object({
  estacaoId: zIdentificador,
  clienteId: zIdentificador.optional(),
});

const corpoItem = z.object({
  /** O que o operador bipou ou digitou. */
  codigo: z.string().min(1).max(60),
  /**
   * Ausente significa uma unidade.
   *
   * A unidade vem junto porque o PDV acabou de exibi-la na consulta: pedir ao
   * servidor que a deduza exigiria uma segunda busca do produto no caminho onde
   * o cliente está esperando.
   */
  quantidade: z
    .object({ milesimos: zInteiroPositivo, unidade: z.string().min(1).max(6) })
    .optional(),
});

const corpoPagamento = z.object({
  forma: z.string().min(1).max(30),
  valor: zInteiroPositivo,
  parcelas: z.number().int().positive().max(36).optional(),
  autorizacao: z.string().min(1).max(60).optional(),
});

export function rotasDeVendas(servidor: FastifyInstance, container: Container): void {
  const protegida = {
    preHandler: [
      exigirAutenticacao(container),
      exigirPermissao(container, "venda:criar"),
    ],
  };

  servidor.post("/api/vendas", protegida, async (requisicao, resposta) => {
    const entrada = corpoIniciar.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Informe a estação da venda.");

    const operadorId = operadorAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (operadorId === undefined) return resposta.status(401).send();

    const resultado = await container.iniciarVenda.executar({
      estacaoId: Identificador.criar(entrada.data.estacaoId).unwrap(),
      operadorId,
      clienteId:
        entrada.data.clienteId === undefined
          ? undefined
          : Identificador.criar(entrada.data.clienteId).unwrap(),
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.status(201).send(apresentarVenda(resultado.unwrap()));
  });

  servidor.post("/api/vendas/:id/itens", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoItem.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Informe o código do produto.");

    const quantidade = interpretarQuantidade(entrada.data.quantidade);
    if (quantidade === "INVALIDA") return recusar(resposta, "Quantidade inválida.");

    const resultado = await container.adicionarItem.executar({
      vendaId,
      codigo: entrada.data.codigo,
      quantidade,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    // Devolve o **item e a venda inteira**. O PDV precisa do total e do que
    // falta pagar a cada bipada, e uma segunda requisição para buscá-los
    // custaria uma ida ao servidor no caminho mais percorrido do sistema
    // (RNF-03). Recalcular no navegador não é opção: o desconto rateado é
    // regra de negócio.
    const atual = await container.leitura.vendas.porId(vendaId);
    /* v8 ignore next -- inalcançável: a venda acabou de ser gravada */
    if (atual === undefined) return resposta.status(404).send();

    return resposta.status(201).send({
      item: apresentarItem(resultado.unwrap()),
      venda: apresentarVenda(atual),
    });
  });

  /**
   * Estado atual da venda.
   *
   * Existe para o PDV **recuperar** uma venda em curso: um F5 acidental, o
   * navegador reiniciando ou a estação reabrindo no meio do atendimento. Sem
   * isto o operador perderia o carrinho e a venda ficaria órfã no servidor —
   * com o estoque ainda não baixado, mas ocupando numeração.
   */
  servidor.get("/api/vendas/:id", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const venda = await container.leitura.vendas.porId(vendaId);

    if (venda === undefined) {
      return resposta.status(404).send({
        erro: { codigo: "VENDA_NAO_ENCONTRADA", mensagem: "Venda não encontrada." },
      });
    }

    return resposta.send(apresentarVenda(venda));
  });

  servidor.post("/api/vendas/:id/pagamentos", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoPagamento.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Informe a forma e o valor.");

    if (!ehCodigoFormaPagamento(entrada.data.forma)) {
      return recusar(resposta, "Forma de pagamento não reconhecida.");
    }

    const valor = Dinheiro.deCentavos(BigInt(entrada.data.valor));
    /* v8 ignore next -- inalcançável: o schema já recusou valor não positivo */
    if (valor.isErr()) return recusar(resposta, "Valor inválido.");

    const resultado = await container.registrarPagamento.executar({
      vendaId,
      forma: entrada.data.forma,
      valor: valor.unwrap(),
      parcelas: entrada.data.parcelas,
      autorizacao: entrada.data.autorizacao,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    const saida = resultado.unwrap();

    // Falta e troco voltam junto com o pagamento: são exatamente os dois
    // números que a tela mostra em seguida, e uma segunda consulta
    // acrescentaria latência com o cliente esperando na frente do operador.
    return resposta.status(201).send({
      forma: saida.pagamento.forma.codigo,
      valor: saida.pagamento.valor.centavos.toString(),
      parcelas: saida.pagamento.parcelas,
      faltaPagar: saida.faltaPagar.centavos.toString(),
      troco: saida.troco.centavos.toString(),
    });
  });

  servidor.post("/api/vendas/:id/finalizar", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const resultado = await container.finalizarVenda.executar({ vendaId });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    const saida = resultado.unwrap();

    return resposta.send({
      ...apresentarVenda(saida.venda),
      troco: saida.troco.centavos.toString(),
    });
  });
}

function operadorAutenticado(requisicao: FastifyRequest): Identificador | undefined {
  const autenticado = requisicao.autenticado;
  /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
  if (autenticado === undefined) return undefined;

  return autenticado.usuarioId;
}

function identificadorDaRota(requisicao: FastifyRequest): Identificador | undefined {
  const parametros = z.object({ id: z.string() }).safeParse(requisicao.params);
  if (!parametros.success) return undefined;

  const identificador = Identificador.criar(parametros.data.id);

  return identificador.isOk() ? identificador.unwrap() : undefined;
}

/**
 * Converte a quantidade do fio, ou diz que ela não serve.
 *
 * Unidade desconhecida é recusada em vez de assumida: adivinhar "UN" para uma
 * etiqueta de quilo faria a balança cobrar por peça.
 */
function interpretarQuantidade(
  bruta: { readonly milesimos: string; readonly unidade: string } | undefined,
): Quantidade | undefined | "INVALIDA" {
  if (bruta === undefined) return undefined;

  const unidade = bruta.unidade.toUpperCase();
  if (!ehCodigoUnidade(unidade)) return "INVALIDA";

  const quantidade = Quantidade.deMilesimos(BigInt(bruta.milesimos), unidade);

  return quantidade.isOk() ? quantidade.unwrap() : "INVALIDA";
}

function recusar(resposta: FastifyReply, mensagem: string): FastifyReply {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}

function apresentarVenda(venda: Venda): Record<string, unknown> {
  return {
    id: venda.id.valor,
    numero: venda.numero,
    status: venda.status,
    subtotal: venda.subtotal.centavos.toString(),
    descontoTotal: venda.descontoTotal.centavos.toString(),
    total: venda.total.centavos.toString(),
    totalPago: venda.totalPago.centavos.toString(),
    faltaPagar: venda.faltaPagar.centavos.toString(),
    itens: venda.itens.map(apresentarItem),
  };
}

function apresentarItem(item: VendaItem): Record<string, unknown> {
  return {
    numero: item.numero,
    produtoId: item.produtoId.valor,
    descricao: item.descricao,
    quantidade: {
      milesimos: item.quantidade.milesimos.toString(),
      unidade: item.quantidade.unidade.codigo,
    },
    precoUnitario: item.precoUnitario.centavos.toString(),
    total: item.total.centavos.toString(),
  };
}
