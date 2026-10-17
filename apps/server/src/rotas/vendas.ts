import { Dinheiro, ehCodigoFormaPagamento } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import {
  apresentarItem,
  apresentarPagamento,
  apresentarVenda,
} from "../http/apresentacao.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import {
  identificadorDaRota,
  identificadorValidado,
  identificadorValidadoOpcional,
  interpretarQuantidade,
  numeroDaRota,
  recusar,
  usuarioAutenticado,
  zInteiroNaoNegativo,
  zInteiroPositivo,
  zQuantidadeNoFio,
  zSupervisor,
} from "../http/entrada.js";
import { responderErro } from "../http/erros.js";

/**
 * Rotas da venda — o caminho quente do produto.
 *
 * Três decisões atravessam todas elas.
 *
 * **O operador vem do token, nunca do corpo.** Ver `usuarioAutenticado`.
 *
 * **Toda resposta traz a venda inteira.** O PDV precisa do total, do que falta
 * e do troco a cada toque, e uma segunda requisição para buscá-los custaria
 * uma ida ao servidor no caminho onde o cliente está esperando (RNF-03).
 *
 * **A permissão da rota é a de vender.** O que passa da alçada do operador —
 * tirar item, desconto acima do teto, cancelar — não é negado aqui: o caso de
 * uso responde `AUTORIZACAO_NECESSARIA`, a tela abre o modal do supervisor, e
 * a mesma requisição volta com a credencial dele. Negar na rota tiraria do
 * balcão o caminho que a arquitetura promete (§9.4).
 */

const corpoIniciar = z.object({
  /** Gerado na estação: repetir o primeiro bipe não abre uma segunda venda. */
  id: z.uuid().optional(),
  estacaoId: z.uuid(),
  clienteId: z.uuid().optional(),
});

const corpoItem = z.object({
  /** O que o operador bipou, digitou ou tocou num botão. */
  codigo: z.string().trim().min(1).max(60),
  /**
   * Ausente é uma unidade. Pode vir em gramas para produto vendido por quilo.
   *
   * **Sem `unidade`** é o "3 ×" digitado antes do código: milésimos na unidade
   * do próprio produto, que a tela não precisa conhecer.
   */
  quantidade: z
    .object({ milesimos: zInteiroPositivo, unidade: z.string().min(1).max(6).optional() })
    .optional(),
  supervisor: zSupervisor,
});

const corpoQuantidade = z.object({
  quantidade: zQuantidadeNoFio,
  supervisor: zSupervisor,
});

const corpoSoSupervisor = z.object({ supervisor: zSupervisor }).optional();

const corpoDesconto = z
  .object({
    /** Ausente é a venda inteira. */
    numeroItem: z.number().int().min(1).max(9999).optional(),
    /** Em centavos **ou** em pontos-base (`1000` é 10%) — um dos dois. */
    valor: zInteiroNaoNegativo.optional(),
    percentualBps: z.number().int().min(0).max(10_000).optional(),
    supervisor: zSupervisor,
  })
  .refine((corpo) => (corpo.valor === undefined) !== (corpo.percentualBps === undefined));

const corpoCliente = z.object({
  /** `null` tira o cliente da venda. */
  clienteId: z.uuid().nullable(),
});

const corpoPagamento = z.object({
  forma: z.string().min(1).max(30),
  valor: zInteiroPositivo,
  parcelas: z.number().int().positive().max(36).optional(),
  /** Código da maquininha (NSU/autorização). Nunca o número do cartão. */
  autorizacao: z.string().trim().min(1).max(60).optional(),
  /** Só o modo treinamento aceita `SIMULADA`. */
  confirmacao: z.enum(["MANUAL", "INTEGRACAO", "SIMULADA"]).optional(),
  /** Gerada pela tela: o reenvio não duplica o pagamento. */
  chave: z.string().trim().min(8).max(64).optional(),
  supervisor: zSupervisor,
});

const corpoSuspender = z
  .object({ rotulo: z.string().trim().max(40).optional() })
  .optional();

const corpoRetomar = z.object({ estacaoId: z.uuid() });

const corpoCancelar = z.object({
  motivo: z.string().trim().min(3).max(200),
  supervisor: zSupervisor,
});

const corpoFinalizar = z
  .object({
    crediario: z
      .object({
        parcelas: z.number().int().min(1).max(12),
        diasParaPrimeiroVencimento: z.number().int().min(0).max(120).optional(),
        diasEntreParcelas: z.number().int().min(1).max(60).optional(),
      })
      .optional(),
  })
  .optional();

const consultaAbertas = z.object({ estacaoId: z.uuid() });

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

    const operadorId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (operadorId === undefined) return resposta.status(401).send();

    const resultado = await container.iniciarVenda.executar({
      id: identificadorValidadoOpcional(entrada.data.id),
      estacaoId: identificadorValidado(entrada.data.estacaoId),
      operadorId,
      clienteId: identificadorValidadoOpcional(entrada.data.clienteId),
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.status(201).send(apresentarVenda(resultado.unwrap()));
  });

  /**
   * As vendas em aberto no caixa da estação — as guardadas e a que ficou na
   * tela quando o navegador fechou.
   *
   * Responde lista vazia, e não erro, sem caixa aberto: é o começo do dia.
   */
  servidor.get("/api/vendas/abertas", protegida, async (requisicao, resposta) => {
    const consulta = consultaAbertas.safeParse(requisicao.query);
    if (!consulta.success) return recusar(resposta, "Informe a estação.");

    const sessao = await container.leitura.caixas.abertaNaEstacao(
      identificadorValidado(consulta.data.estacaoId),
    );

    if (sessao === undefined) return resposta.send({ vendas: [] });

    const abertas = await container.leitura.vendas.abertasNaSessao(sessao.id);

    return resposta.send({ vendas: abertas.map(apresentarVenda) });
  });

  /**
   * Estado atual da venda — para o PDV **recuperar** uma venda em curso depois
   * de um F5, do navegador reiniciando ou da estação reabrindo no meio do
   * atendimento.
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

  servidor.post("/api/vendas/:id/itens", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoItem.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Informe o código do produto.");

    const bruta = entrada.data.quantidade;
    const naUnidadeDoProduto =
      bruta !== undefined && bruta.unidade === undefined
        ? BigInt(bruta.milesimos)
        : undefined;

    const quantidade =
      bruta?.unidade === undefined
        ? undefined
        : interpretarQuantidade({ milesimos: bruta.milesimos, unidade: bruta.unidade });
    if (quantidade === "INVALIDA") return recusar(resposta, "Quantidade inválida.");

    const operadorId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (operadorId === undefined) return resposta.status(401).send();

    const resultado = await container.adicionarItem.executar({
      vendaId,
      operadorId,
      codigo: entrada.data.codigo,
      quantidade,
      quantidadeNaUnidadeDoProduto: naUnidadeDoProduto,
      credencialSupervisor: entrada.data.supervisor,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    const saida = resultado.unwrap();

    // `somado` diz à tela se a leitura virou linha nova ou engordou uma que
    // já estava lá — é a linha que ela destaca, para o operador ver o que a
    // bipada fez.
    return resposta.status(201).send({
      item: apresentarItem(saida.item),
      somado: saida.somado,
      venda: apresentarVenda(saida.venda),
    });
  });

  servidor.put(
    "/api/vendas/:id/itens/:numero",
    protegida,
    async (requisicao, resposta) => {
      const vendaId = identificadorDaRota(requisicao);
      const numeroItem = numeroDaRota(requisicao, "numero");
      if (vendaId === undefined || numeroItem === undefined) {
        return recusar(resposta, "Item inválido.");
      }

      const entrada = corpoQuantidade.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe a nova quantidade.");

      const quantidade = interpretarQuantidade(entrada.data.quantidade);
      if (quantidade === "INVALIDA" || quantidade === undefined) {
        return recusar(resposta, "Quantidade inválida.");
      }

      const operadorId = usuarioAutenticado(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (operadorId === undefined) return resposta.status(401).send();

      const resultado = await container.alterarQuantidadeItem.executar({
        vendaId,
        operadorId,
        numeroItem,
        quantidade,
        credencialSupervisor: entrada.data.supervisor,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarVenda(resultado.unwrap()));
    },
  );

  /**
   * Tira um item. `POST .../remover`, e não `DELETE`: a credencial do
   * supervisor vai no corpo, e corpo em `DELETE` é descartado por proxies e
   * bibliotecas no meio do caminho.
   */
  servidor.post(
    "/api/vendas/:id/itens/:numero/remover",
    protegida,
    async (requisicao, resposta) => {
      const vendaId = identificadorDaRota(requisicao);
      const numeroItem = numeroDaRota(requisicao, "numero");
      if (vendaId === undefined || numeroItem === undefined) {
        return recusar(resposta, "Item inválido.");
      }

      const entrada = corpoSoSupervisor.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Credencial inválida.");

      const operadorId = usuarioAutenticado(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (operadorId === undefined) return resposta.status(401).send();

      const resultado = await container.removerItem.executar({
        vendaId,
        operadorId,
        numeroItem,
        credencialSupervisor: entrada.data?.supervisor,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarVenda(resultado.unwrap()));
    },
  );

  servidor.post("/api/vendas/:id/desconto", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoDesconto.safeParse(requisicao.body);
    if (!entrada.success) {
      return recusar(resposta, "Informe o desconto em reais ou em percentual.");
    }

    const operadorId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (operadorId === undefined) return resposta.status(401).send();

    const { numeroItem, valor, percentualBps, supervisor } = entrada.data;

    const resultado = await container.aplicarDesconto.executar({
      vendaId,
      operadorId,
      alvo:
        numeroItem === undefined
          ? { tipo: "VENDA" }
          : { tipo: "ITEM", numero: numeroItem },
      // O schema já recusou valor que não é inteiro não negativo.
      valor:
        valor === undefined ? undefined : Dinheiro.deCentavos(BigInt(valor)).unwrap(),
      percentualBps,
      credencialSupervisor: supervisor,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.send(apresentarVenda(resultado.unwrap()));
  });

  servidor.put("/api/vendas/:id/cliente", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoCliente.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Cliente inválido.");

    const clienteId = identificadorValidadoOpcional(entrada.data.clienteId ?? undefined);

    const resultado = await container.identificarCliente.executar({ vendaId, clienteId });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.send(apresentarVenda(resultado.unwrap()));
  });

  servidor.post("/api/vendas/:id/pagamentos", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoPagamento.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Informe a forma e o valor.");

    if (!ehCodigoFormaPagamento(entrada.data.forma)) {
      return recusar(resposta, "Forma de pagamento não reconhecida.");
    }

    const operadorId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (operadorId === undefined) return resposta.status(401).send();

    const resultado = await container.registrarPagamento.executar({
      vendaId,
      operadorId,
      forma: entrada.data.forma,
      // O schema só deixa passar inteiro positivo.
      valor: Dinheiro.deCentavos(BigInt(entrada.data.valor)).unwrap(),
      parcelas: entrada.data.parcelas,
      autorizacao: entrada.data.autorizacao,
      confirmacao: entrada.data.confirmacao,
      chave: entrada.data.chave,
      credencialSupervisor: entrada.data.supervisor,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    const saida = resultado.unwrap();
    const indice = saida.venda.pagamentos.indexOf(saida.pagamento);

    // Falta e troco no topo, além da venda: são exatamente os dois números que
    // a tela mostra em seguida.
    return resposta.status(201).send({
      pagamento: apresentarPagamento(saida.pagamento, indice),
      faltaPagar: saida.faltaPagar.centavos.toString(),
      troco: saida.troco.centavos.toString(),
      venda: apresentarVenda(saida.venda),
    });
  });

  servidor.post(
    "/api/vendas/:id/pagamentos/:indice/remover",
    protegida,
    async (requisicao, resposta) => {
      const vendaId = identificadorDaRota(requisicao);
      const indice = numeroDaRota(requisicao, "indice", 0);
      if (vendaId === undefined || indice === undefined) {
        return recusar(resposta, "Pagamento inválido.");
      }

      const operadorId = usuarioAutenticado(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (operadorId === undefined) return resposta.status(401).send();

      const resultado = await container.removerPagamento.executar({
        vendaId,
        operadorId,
        indice,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarVenda(resultado.unwrap()));
    },
  );

  servidor.post("/api/vendas/:id/suspender", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoSuspender.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Nome muito comprido.");

    const rotulo = entrada.data?.rotulo;

    const resultado = await container.suspenderVenda.executar({
      vendaId,
      rotulo: rotulo === "" ? undefined : rotulo,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.send(apresentarVenda(resultado.unwrap()));
  });

  servidor.post("/api/vendas/:id/retomar", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoRetomar.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Informe a estação.");

    const resultado = await container.retomarVenda.executar({
      vendaId,
      estacaoId: identificadorValidado(entrada.data.estacaoId),
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.send(apresentarVenda(resultado.unwrap()));
  });

  /**
   * Cancela — aberta (descarta) ou concluída (estorna tudo).
   *
   * A resposta lista o que devolver ao cliente, forma a forma: o sistema
   * estorna o registro, mas o dinheiro, o Pix e o cartão quem devolve é o
   * operador, e a tela mostra a lista para que nada fique esquecido.
   */
  servidor.post("/api/vendas/:id/cancelar", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoCancelar.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Informe o motivo do cancelamento.");

    const operadorId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (operadorId === undefined) return resposta.status(401).send();

    const resultado = await container.cancelarVenda.executar({
      vendaId,
      operadorId,
      motivo: entrada.data.motivo,
      credencialSupervisor: entrada.data.supervisor,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    const saida = resultado.unwrap();

    return resposta.send({
      venda: apresentarVenda(saida.venda),
      estornada: saida.estornada,
      estornos: saida.estornos.map((estorno) => ({
        forma: estorno.forma,
        valor: estorno.valor.centavos.toString(),
      })),
    });
  });

  servidor.post("/api/vendas/:id/finalizar", protegida, async (requisicao, resposta) => {
    const vendaId = identificadorDaRota(requisicao);
    if (vendaId === undefined) return recusar(resposta, "Venda inválida.");

    const entrada = corpoFinalizar.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Parcelamento inválido.");

    const resultado = await container.finalizarVenda.executar({
      vendaId,
      crediario: entrada.data?.crediario,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    const saida = resultado.unwrap();

    return resposta.send({
      ...apresentarVenda(saida.venda),
      troco: saida.troco.centavos.toString(),
    });
  });
}
