import { CABECALHO_CORRELACAO } from "@erp/contracts";
import type { FastifyInstance } from "fastify";

/**
 * Correlação — o número que amarra a reclamação do cliente à linha do log.
 *
 * O suporte deste produto é remoto (CLAUDE.md §2: "um bug precisa ser
 * diagnosticável sem ir à loja"). Sem correlação, "deu erro na venda das 14h"
 * obriga a procurar entre milhares de linhas; com ela, a tela do PDV mostra o
 * código, o atendente pede, e a linha aparece.
 */

/**
 * Formato aceito para correlação vinda do cliente.
 *
 * Restrito de propósito. O valor **entra no log**, e log com quebra de linha
 * injetada permite forjar registros — um atacante que controla a estação
 * poderia fabricar a linha "login autorizado" no meio do arquivo. Aceitar só
 * este alfabeto elimina a classe inteira de ataque, ao custo de gerar um id
 * novo quando o cliente manda algo exótico.
 */
const FORMATO_CORRELACAO = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Decide a correlação da requisição: aproveita a do cliente quando é confiável,
 * gera uma quando não é.
 *
 * Aproveitar importa porque o PDV registra a sua própria linha antes de chamar;
 * correlação diferente nas duas pontas obrigaria a cruzar por horário, que é
 * exatamente o que não funciona quando o relógio da estação está errado.
 */
export function correlacaoDaRequisicao(
  cabecalho: string | string[] | undefined,
  gerar: () => string,
): string {
  // Cabeçalho repetido: o Node entrega um array. Ambíguo por definição — quem
  // manda dois valores não tem um identificador, tem dois.
  const recebido = typeof cabecalho === "string" ? cabecalho : undefined;

  return recebido !== undefined && FORMATO_CORRELACAO.test(recebido) ? recebido : gerar();
}

/**
 * Devolve a correlação em toda resposta, inclusive nas de erro.
 *
 * Sem isto, a correlação existiria só no servidor, e o operador não teria o
 * número para informar — que é justamente quando ele é necessário.
 */
export function registrarCorrelacao(app: FastifyInstance): void {
  // `onRequest`, e não `onSend`: o cabeçalho precisa estar posto antes de
  // qualquer resposta curta — 429 do limitador, 404 de rota inexistente, 500 de
  // exceção. São exatamente as respostas em que o suporte mais precisa dele.
  app.addHook("onRequest", (requisicao, resposta, prosseguir) => {
    void resposta.header(CABECALHO_CORRELACAO, requisicao.id);
    prosseguir();
  });
}
