import { type Baixa, Identificador, TIPOS_TITULO, type Titulo } from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Contas a receber e a pagar.
 *
 * ### Ver e lançar são permissões diferentes
 *
 * `financeiro:ver` responde "quem me deve" — informação que o balcão precisa
 * para decidir se a próxima venda a prazo pode sair. `financeiro:lancar` mexe
 * em dinheiro: dar baixa, estornar, adiar vencimento. Juntar as duas daria a
 * quem consulta o poder de quitar uma dívida.
 *
 * ### O recebimento é `POST`, e não `PUT`
 *
 * Cada recebimento é um **fato novo**, não uma atualização do título. Isso
 * também deixa claro que reenviar por causa da rede cria uma segunda baixa —
 * e é por isso que a tela desabilita o botão enquanto envia, em vez de o
 * servidor fingir idempotência que ele não tem.
 */

const zTexto = (max: number) => z.string().trim().min(1).max(max);

/** Centavos em texto — dinheiro nunca atravessa a fronteira como `number`. */
const zCentavos = z.string().regex(/^\d{1,15}$/, "valor inválido");

const zData = z.iso.datetime({ offset: true });

const corpoLancamento = z.object({
  tipo: z.enum(TIPOS_TITULO),
  contraparteId: z.uuid().optional(),
  contraparteNome: zTexto(120).optional(),
  valor: zCentavos,
  vencimento: zData,
  parcelas: z.number().int().min(1).max(36).optional(),
  diasEntreParcelas: z.number().int().min(1).max(365).optional(),
  descricao: zTexto(200).optional(),
});

const corpoRecebimento = z.object({
  valor: zCentavos,
  forma: zTexto(30).optional(),
  observacao: zTexto(500).optional(),
});

const corpoEstorno = z.object({ observacao: zTexto(500).optional() });

const corpoAdiamento = z.object({
  vencimento: zData,
  motivo: zTexto(200).optional(),
});

const corpoCancelamento = z.object({ motivo: zTexto(500) });

const consultaTitulos = z.object({
  tipo: z.enum(TIPOS_TITULO).optional(),
  contraparteId: z.uuid().optional(),
  apenasEmAberto: z.enum(["true", "false"]).optional(),
  vencidosAte: zData.optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export function rotasDeFinanceiro(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);

  const protegida = (permissao: Parameters<typeof exigirPermissao>[1]) => ({
    preHandler: [autenticado, exigirPermissao(container, permissao)],
  });

  servidor.get(
    "/api/financeiro/titulos",
    protegida("financeiro:ver"),
    async (requisicao, resposta) => {
      const consulta = consultaTitulos.safeParse(requisicao.query);

      if (!consulta.success) return recusar(resposta, "Consulta inválida.");

      // Sem conferir o resultado: o Zod já validou como `uuid`, e
      // `Identificador` aceita qualquer UUID. Uma guarda aqui seria ramo que
      // nenhum teste alcança — e ramo inalcançável esconde os que importam.
      const contraparteId = identificadorDe(consulta.data.contraparteId);

      const achados = await container.leitura.titulos.buscar({
        tipo: consulta.data.tipo,
        contraparteId,
        apenasEmAberto: consulta.data.apenasEmAberto !== "false",
        vencidosAte:
          consulta.data.vencidosAte === undefined
            ? undefined
            : new Date(consulta.data.vencidosAte),
        limite: consulta.data.limite,
      });

      const agora = container.relogio.agora();

      return resposta.send({ itens: achados.map((titulo) => apresentar(titulo, agora)) });
    },
  );

  servidor.get(
    "/api/financeiro/titulos/:id",
    protegida("financeiro:ver"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Título inválido.");

      const titulo = await container.leitura.titulos.porId(id);
      if (titulo === undefined) return naoEncontrado(resposta);

      return resposta.send(apresentar(titulo, container.relogio.agora(), true));
    },
  );

  servidor.post(
    "/api/financeiro/titulos",
    protegida("financeiro:lancar"),
    async (requisicao, resposta) => {
      const entrada = corpoLancamento.safeParse(requisicao.body);

      if (!entrada.success) {
        return recusar(resposta, "Confira o valor, o vencimento e de quem é a conta.");
      }

      const resultado = await container.lancarTitulo.executar({
        tipo: entrada.data.tipo,
        contraparteId: identificadorDe(entrada.data.contraparteId),
        contraparteNome: entrada.data.contraparteNome,
        valorCentavos: BigInt(entrada.data.valor),
        vencimento: new Date(entrada.data.vencimento),
        parcelas: entrada.data.parcelas,
        diasEntreParcelas: entrada.data.diasEntreParcelas,
        descricao: entrada.data.descricao,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      const agora = container.relogio.agora();

      return resposta
        .status(201)
        .send({ itens: resultado.unwrap().map((titulo) => apresentar(titulo, agora)) });
    },
  );

  servidor.post(
    "/api/financeiro/titulos/:id/recebimentos",
    protegida("financeiro:lancar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Título inválido.");

      const entrada = corpoRecebimento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o valor recebido.");

      const usuarioId = autorId(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (usuarioId === undefined) return recusar(resposta, "Sessão inválida.");

      const resultado = await container.registrarRecebimento.executar({
        tituloId: id,
        valorCentavos: BigInt(entrada.data.valor),
        usuarioId,
        forma: entrada.data.forma,
        observacao: entrada.data.observacao,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(
        apresentar(resultado.unwrap(), container.relogio.agora(), true),
      );
    },
  );

  servidor.post(
    "/api/financeiro/titulos/:id/recebimentos/:baixaId/estorno",
    protegida("financeiro:lancar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      const baixaId = identificadorDe(
        (requisicao.params as { baixaId?: string }).baixaId,
      );

      if (id === undefined || baixaId === undefined) {
        return recusar(resposta, "Recebimento inválido.");
      }

      const entrada = corpoEstorno.safeParse(requisicao.body ?? {});
      if (!entrada.success) return recusar(resposta, "Observação inválida.");

      const usuarioId = autorId(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (usuarioId === undefined) return recusar(resposta, "Sessão inválida.");

      const resultado = await container.estornarRecebimento.executar({
        tituloId: id,
        baixaId,
        usuarioId,
        observacao: entrada.data.observacao,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(
        apresentar(resultado.unwrap(), container.relogio.agora(), true),
      );
    },
  );

  servidor.put(
    "/api/financeiro/titulos/:id/vencimento",
    protegida("financeiro:lancar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Título inválido.");

      const entrada = corpoAdiamento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe a nova data.");

      const resultado = await container.adiarVencimento.executar({
        tituloId: id,
        novoVencimento: new Date(entrada.data.vencimento),
        motivo: entrada.data.motivo,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentar(resultado.unwrap(), container.relogio.agora()));
    },
  );

  servidor.post(
    "/api/financeiro/titulos/:id/cancelamento",
    protegida("financeiro:lancar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Título inválido.");

      const entrada = corpoCancelamento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o motivo do cancelamento.");

      const resultado = await container.cancelarTitulo.executar({
        tituloId: id,
        motivo: entrada.data.motivo,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentar(resultado.unwrap(), container.relogio.agora()));
    },
  );

  /**
   * Quanto o cliente ainda deve.
   *
   * Rota própria, e não um filtro da lista, porque é a pergunta do **balcão** e
   * ela tem uma resposta curta: um número. A tela de venda a prazo a consulta
   * antes de liberar o fiado, e devolver a lista inteira para somar no cliente
   * gastaria rede num momento em que há gente esperando.
   */
  servidor.get(
    "/api/financeiro/em-aberto/:contraparteId",
    protegida("financeiro:ver"),
    async (requisicao, resposta) => {
      const contraparteId = identificadorDe(
        (requisicao.params as { contraparteId?: string }).contraparteId,
      );

      if (contraparteId === undefined) {
        return recusar(resposta, "Cliente ou fornecedor inválido.");
      }

      const tipo =
        (requisicao.query as { tipo?: string }).tipo === "PAGAR" ? "PAGAR" : "RECEBER";

      const titulos = await container.leitura.titulos.emAbertoDaContraparte(
        contraparteId,
        tipo,
      );

      const agora = container.relogio.agora();

      const total = titulos.reduce((soma, titulo) => soma + titulo.saldo.centavos, 0n);
      const vencido = titulos
        .filter((titulo) => titulo.estaVencidoEm(agora))
        .reduce((soma, titulo) => soma + titulo.saldo.centavos, 0n);

      return resposta.send({
        // Centavos em texto, como todo dinheiro que cruza a fronteira.
        total: total.toString(),
        vencido: vencido.toString(),
        quantidade: titulos.length,
        itens: titulos.map((titulo) => apresentar(titulo, agora)),
      });
    },
  );
}

// ── Apresentação ─────────────────────────────────────────────────────────

function apresentar(
  titulo: Titulo,
  agora: Date,
  comBaixas = false,
): Record<string, unknown> {
  return {
    id: titulo.id.valor,
    tipo: titulo.tipo,
    origem: titulo.origem,
    documentoId: titulo.documentoId?.valor,
    contraparteId: titulo.contraparteId?.valor,
    contraparteNome: titulo.contraparteNome,
    valorOriginal: titulo.valorOriginal.centavos.toString(),
    totalBaixado: titulo.totalBaixado.centavos.toString(),
    saldo: titulo.saldo.centavos.toString(),
    vencimento: titulo.vencimento.toISOString(),
    emitidoEm: titulo.emitidoEm.toISOString(),
    parcela: titulo.parcela,
    descricao: titulo.descricao,
    // Calculados no servidor: a regra de "vencido" compara por dia, e repeti-la
    // na tela abriria a porta para as duas discordarem por causa de fuso.
    situacao: titulo.situacao,
    vencido: titulo.estaVencidoEm(agora),
    diasEmAtraso: titulo.diasEmAtrasoEm(agora),
    canceladoEm: titulo.canceladoEm?.toISOString(),
    motivoCancelamento: titulo.motivoCancelamento,
    ...(comBaixas ? { baixas: titulo.baixas.map(apresentarBaixa) } : {}),
  };
}

function apresentarBaixa(baixa: Baixa): Record<string, unknown> {
  return {
    id: baixa.id.valor,
    tipo: baixa.tipo,
    valor: baixa.valor.centavos.toString(),
    ocorridaEm: baixa.ocorridaEm.toISOString(),
    usuarioId: baixa.usuarioId.valor,
    forma: baixa.forma,
    observacao: baixa.observacao,
    estornaId: baixa.estornaId?.valor,
  };
}

// ── Auxiliares ───────────────────────────────────────────────────────────

function identificadorDe(valor: string | undefined): Identificador | undefined {
  if (valor === undefined) return undefined;

  const identificador = Identificador.criar(valor);

  return identificador.isErr() ? undefined : identificador.unwrap();
}

function identificadorDaRota(requisicao: FastifyRequest): Identificador | undefined {
  return identificadorDe((requisicao.params as { id?: string }).id);
}

/** Quem está lançando. Fica gravado na baixa: "quem recebeu isso?" tem resposta. */
function autorId(requisicao: FastifyRequest): Identificador | undefined {
  return requisicao.autenticado?.usuarioId;
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}

function naoEncontrado(resposta: FastifyReply) {
  return resposta
    .status(404)
    .send({ erro: { codigo: "NAO_ENCONTRADO", mensagem: "Título não encontrado." } });
}
