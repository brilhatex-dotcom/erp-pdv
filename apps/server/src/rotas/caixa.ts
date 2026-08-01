import { sessoesDeCaixa } from "@erp/database";
import { type ConferenciaCaixa, Dinheiro, Identificador } from "@erp/domain";
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

/** Centavos em texto: número viraria `double` no `JSON.parse` (ADR-0019). */
const zCentavos = z.string().regex(/^\d{1,15}$/, "valor inválido");

const corpoAbertura = z.object({
  estacaoId: z.uuid(),
  fundoTroco: zCentavos,
});

const corpoMovimento = z.object({
  estacaoId: z.uuid(),
  valor: zCentavos,
  motivo: z.string().min(3).max(120),
  /** Só na segunda tentativa, depois de `AUTORIZACAO_NECESSARIA`. */
  supervisor: z
    .object({ matricula: z.string().min(1).max(20), pin: z.string().min(4).max(12) })
    .optional(),
});

/**
 * Intervalo consultado.
 *
 * O padrão é **o dia de hoje**, e não "tudo": a consulta sem filtro numa loja
 * com dois anos de histórico devolveria centenas de sessões para a tela montar,
 * e ninguém abre esta tela querendo 2024.
 */
const consultaSessoes = z.object({
  de: z.iso.date().optional(),
  ate: z.iso.date().optional(),
  estacaoId: z.uuid().optional(),
});

const corpoFechamento = z.object({
  estacaoId: z.uuid(),
  contadoEmDinheiro: zCentavos,
  /** O que a estação ainda não conseguiu enviar. Ela é quem sabe. */
  vendasPendentes: z.number().int().min(0).max(10_000).optional(),
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
   * Retirada de dinheiro da gaveta.
   *
   * A permissão **não** é conferida por `exigirPermissao`: quem decide é a
   * política de autorização, dentro do caso de uso, porque a resposta aqui tem
   * três valores e não dois. Acima do teto do papel a operação não é negada —
   * ela pede liberação, e a tela precisa saber a diferença para abrir o modal
   * do supervisor em vez de dizer "não pode".
   */
  servidor.post(
    "/api/caixa/sangria",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const entrada = corpoMovimento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o valor e o motivo.");

      const sessao = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (sessao === undefined) return resposta.status(401).send();

      const resultado = await container.registrarSangria.executar({
        estacaoId: Identificador.criar(entrada.data.estacaoId).unwrap(),
        operadorId: sessao.usuarioId,
        valor: Dinheiro.deCentavos(BigInt(entrada.data.valor)).unwrap(),
        motivo: entrada.data.motivo,
        credencialSupervisor: entrada.data.supervisor,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentarMovimento(resultado.unwrap()));
    },
  );

  /** Dinheiro entrando na gaveta. Não tira nada de ninguém: só a permissão base. */
  servidor.post(
    "/api/caixa/suprimento",
    { preHandler: [autenticado, exigirPermissao(container, "caixa:abrir")] },
    async (requisicao, resposta) => {
      const entrada = corpoMovimento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o valor e o motivo.");

      const sessao = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (sessao === undefined) return resposta.status(401).send();

      const resultado = await container.registrarSuprimento.executar({
        estacaoId: Identificador.criar(entrada.data.estacaoId).unwrap(),
        operadorId: sessao.usuarioId,
        valor: Dinheiro.deCentavos(BigInt(entrada.data.valor)).unwrap(),
        motivo: entrada.data.motivo,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentarMovimento(resultado.unwrap()));
    },
  );

  /**
   * Fechamento com conferência.
   *
   * O valor contado **chega no corpo** — o servidor nunca o sugere. É a única
   * forma de a conferência significar alguma coisa: quem conta não pode saber o
   * resultado esperado antes de contar.
   */
  servidor.post(
    "/api/caixa/fechar",
    { preHandler: [autenticado, exigirPermissao(container, "caixa:fechar")] },
    async (requisicao, resposta) => {
      const entrada = corpoFechamento.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o valor contado.");

      const resultado = await container.fecharCaixa.executar({
        estacaoId: Identificador.criar(entrada.data.estacaoId).unwrap(),
        contadoEmDinheiro: Dinheiro.deCentavos(
          BigInt(entrada.data.contadoEmDinheiro),
        ).unwrap(),
        vendasPendentesNaEstacao: entrada.data.vendasPendentes,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarConferencia(resultado.unwrap().conferencia));
    },
  );

  /**
   * Sessões de caixa do período — a conferência depois do fato.
   *
   * Exige `relatorio:vendas`: a resposta mostra quanto cada operador vendeu e
   * qual foi a diferença dele. É informação de supervisão, não de balcão — e o
   * operador que enxerga a divergência dos colegas tem material para justificar
   * a própria.
   */
  servidor.get(
    "/api/caixa/sessoes",
    { preHandler: [autenticado, exigirPermissao(container, "relatorio:vendas")] },
    async (requisicao, resposta) => {
      const entrada = consultaSessoes.safeParse(requisicao.query);
      if (!entrada.success) return recusar(resposta, "Período inválido.");

      const { de, ate } = intervalo(entrada.data, container.relogio.agora());

      const sessoes = await sessoesDeCaixa(container.prisma, {
        de,
        ate,
        estacaoId: entrada.data.estacaoId,
      });

      return resposta.send({ sessoes });
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

/**
 * O caixa como a estação pode vê-lo.
 *
 * **`esperadoEmDinheiro` não sai daqui.** É o número que a conferência existe
 * para descobrir: quem conta a gaveta sabendo o resultado esperado digita o
 * resultado esperado, e a falta que o controle deveria achar passa despercebida
 * todos os dias. Esconder na tela não bastaria — o operador que abre a aba de
 * rede do navegador veria o mesmo valor.
 *
 * O total vendido e a quantidade ficam: são o que o operador confere durante o
 * expediente, e nenhum dos dois entrega quanto deveria haver em espécie na
 * gaveta.
 */
function apresentar(caixa: {
  id: Identificador;
  estacaoId: Identificador;
  fundoTroco: Dinheiro;
  totalVendido: Dinheiro;
  quantidadeVendas: number;
  abertaEm: Date;
}): Record<string, unknown> {
  return {
    id: caixa.id.valor,
    estacaoId: caixa.estacaoId.valor,
    fundoTroco: caixa.fundoTroco.centavos.toString(),
    totalVendido: caixa.totalVendido.centavos.toString(),
    quantidadeVendas: caixa.quantidadeVendas,
    abertaEm: caixa.abertaEm.toISOString(),
  };
}

/**
 * Converte o período pedido em instantes.
 *
 * O fim é **exclusivo e no dia seguinte**: `ate=2026-08-01` precisa incluir as
 * vendas das 23h daquele dia. Comparar com a meia-noite do próprio dia
 * esconderia o expediente inteiro da data que o usuário digitou — o defeito de
 * relatório mais comum que existe.
 */
function intervalo(
  pedido: { readonly de?: string | undefined; readonly ate?: string | undefined },
  agora: Date,
): { readonly de: Date; readonly ate: Date } {
  const hoje = agora.toISOString().slice(0, 10);

  const de = new Date(`${pedido.de ?? hoje}T00:00:00.000Z`);
  const fim = new Date(`${pedido.ate ?? pedido.de ?? hoje}T00:00:00.000Z`);

  fim.setUTCDate(fim.getUTCDate() + 1);

  return { de, ate: fim };
}

function apresentarMovimento(movimento: {
  id: Identificador;
  tipo: string;
  valor: Dinheiro;
  motivo: string;
  ocorridoEm: Date;
}): Record<string, unknown> {
  return {
    id: movimento.id.valor,
    tipo: movimento.tipo,
    valor: movimento.valor.centavos.toString(),
    motivo: movimento.motivo,
    ocorridoEm: movimento.ocorridoEm.toISOString(),
  };
}

/**
 * A conferência, depois de a contagem ter sido enviada.
 *
 * Só **aqui** o esperado aparece — o operador já contou, e agora precisa ver de
 * onde vem a diferença para conseguir explicá-la ao gerente. Devolvê-lo antes
 * seria entregar a resposta da prova.
 */
function apresentarConferencia(conferencia: ConferenciaCaixa): Record<string, unknown> {
  return {
    fundoTroco: conferencia.fundoTroco.centavos.toString(),
    recebidoEmDinheiro: conferencia.recebidoEmDinheiro.centavos.toString(),
    trocoDevolvido: conferencia.trocoDevolvido.centavos.toString(),
    suprimentos: conferencia.suprimentos.centavos.toString(),
    sangrias: conferencia.sangrias.centavos.toString(),
    esperadoEmDinheiro: conferencia.esperadoEmDinheiro.centavos.toString(),
    contadoEmDinheiro: conferencia.contadoEmDinheiro.centavos.toString(),
    divergenciaEmDinheiro: conferencia.divergenciaEmDinheiro.centavos.toString(),
    totalVendido: conferencia.totalVendido.centavos.toString(),
    totalAReceber: conferencia.totalAReceber.centavos.toString(),
    quantidadeVendas: conferencia.quantidadeVendas,
    porForma: conferencia.porForma.map((linha) => ({
      forma: linha.forma.codigo,
      esperado: linha.esperado.centavos.toString(),
      contado: linha.contado?.centavos.toString(),
      divergencia: linha.divergencia?.centavos.toString(),
    })),
  };
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
