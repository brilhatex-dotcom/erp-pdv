import {
  CODIGO_EXCESSO_REQUISICOES,
  CODIGO_REQUISICAO_INVALIDA,
  CODIGO_ROTA_NAO_ENCONTRADA,
  type TipoErroApi,
} from "@erp/contracts";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import {
  corpoDeErroDireto,
  corpoDeErroInterno,
  STATUS_ERRO_INTERNO,
} from "../apresentadores/erro.js";

/**
 * Rede de segurança da fronteira HTTP.
 *
 * Toda exceção que escapa de uma rota passa por aqui, e aqui ela deixa de ser
 * exceção e vira o envelope de erro do contrato. O que este arquivo impede, na
 * prática, é o comportamento padrão do Fastify: devolver `error.message` ao
 * cliente. Essa mensagem é escrita para desenvolvedor — vem em inglês, cita
 * coluna de tabela e ocasionalmente traz fragmento de SQL. Exibi-la ao operador
 * de caixa é proibido pelo CLAUDE.md §9, e mostrá-la a quem sonda a API entrega
 * o desenho interno do sistema.
 *
 * Falha de **negócio** não chega aqui: ela volta como `Result` do caso de uso e
 * é traduzida na rota. Este tratador cuida do que não estava previsto.
 */

const MENSAGEM_REQUISICAO_INVALIDA =
  "Não foi possível processar os dados enviados. Confira as informações e tente de novo.";

const MENSAGEM_ROTA_NAO_ENCONTRADA = "Recurso não encontrado.";

interface DescricaoErro {
  readonly codigo: string;
  readonly tipo: TipoErroApi;
  readonly mensagem: string;
}

/** Resposta padrão de 4xx: o pedido não serve, e o detalhe fica no log. */
const PEDIDO_INVALIDO: DescricaoErro = {
  codigo: CODIGO_REQUISICAO_INVALIDA,
  tipo: "VALIDACAO",
  mensagem: MENSAGEM_REQUISICAO_INVALIDA,
};

/**
 * Descrições que não são "pedido inválido".
 *
 * O 429 vem do limitador, que **lança** a própria resposta. A categoria dele é
 * `INDISPONIVEL` e não `VALIDACAO` porque o status já diz o que aconteceu — o
 * que o cliente precisa saber é o que fazer, e aqui é esperar e repetir, não
 * corrigir o pedido.
 */
const POR_STATUS = new Map<number, DescricaoErro>([
  [
    429,
    {
      codigo: CODIGO_EXCESSO_REQUISICOES,
      tipo: "INDISPONIVEL",
      mensagem: "Muitas requisições em pouco tempo. Aguarde um instante e tente de novo.",
    },
  ],
]);

export function registrarTratamentoDeErro(app: FastifyInstance): void {
  app.setNotFoundHandler((requisicao, resposta) => {
    // Nível `info`, não `warn`: cliente antigo consultando rota removida é
    // esperado durante atualização, e alarme para o esperado treina a equipe a
    // ignorar alarme.
    requisicao.log.info(
      { metodo: requisicao.method, caminho: requisicao.url },
      "rota não encontrada",
    );

    return resposta.code(404).send(
      corpoDeErroDireto(
        {
          codigo: CODIGO_ROTA_NAO_ENCONTRADA,
          tipo: "NAO_ENCONTRADO",
          mensagem: MENSAGEM_ROTA_NAO_ENCONTRADA,
        },
        requisicao.id,
      ),
    );
  });

  app.setErrorHandler((erro: unknown, requisicao, resposta) => {
    const status = statusDoErro(erro);

    // 4xx é problema do pedido: registrar como falha do servidor encheria o log
    // de alarme falso e esconderia o 500 de verdade no meio.
    if (status < STATUS_ERRO_INTERNO) {
      requisicao.log.info(
        { status, ...descreverParaLog(erro) },
        "requisição recusada na fronteira",
      );

      return resposta
        .code(status)
        .send(
          corpoDeErroDireto(POR_STATUS.get(status) ?? PEDIDO_INVALIDO, requisicao.id),
        );
    }

    // Aqui, sim, alguém precisa olhar. A pilha inteira vai para o log, ligada à
    // correlação que o cliente recebeu — é com ela que o suporte encontra esta
    // linha a partir do que o operador informou.
    requisicao.log.error({ err: erro }, "falha inesperada ao atender requisição");

    return resposta.code(STATUS_ERRO_INTERNO).send(corpoDeErroInterno(requisicao.id));
  });
}

/**
 * Status que a falha merece.
 *
 * O parâmetro é `unknown` porque é o que ele realmente é: `throw` aceita
 * qualquer valor, e plugins da fronteira lançam objeto simples em vez de
 * `Error` — o limitador de requisições é um deles. Tratar como `Error` sem
 * verificar quebraria justamente no caminho de erro, onde não há segunda chance.
 *
 * A faixa é conferida de propósito: valor fora de 400–599 num campo chamado
 * `statusCode` significa que quem lançou não estava falando de HTTP, e responder
 * 200 numa exceção esconderia a falha do monitoramento e do cliente.
 */
function statusDoErro(erro: unknown): number {
  if (erro instanceof ZodError) {
    return 400;
  }

  const declarado =
    typeof erro === "object" && erro !== null && "statusCode" in erro
      ? erro.statusCode
      : undefined;

  return typeof declarado === "number" && declarado >= 400 && declarado <= 599
    ? declarado
    : STATUS_ERRO_INTERNO;
}

/** Extrai o que é útil ao diagnóstico sem supor o formato do que foi lançado. */
function descreverParaLog(erro: unknown): Record<string, unknown> {
  if (erro instanceof Error) {
    // `code` não existe em `Error`, mas existe nos erros do Fastify e do Node — e
    // é ele que identifica a causa (`FST_ERR_CTP_INVALID_JSON`, `ECONNREFUSED`).
    // O estreitamento por `in` o alcança sem afirmar um tipo que pode não vir.
    return { erro: erro.message, codigo: "code" in erro ? erro.code : undefined };
  }

  return { erro: String(erro) };
}
