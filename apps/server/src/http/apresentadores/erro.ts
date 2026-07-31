import { ErroInfraestrutura } from "@erp/application";
import { CODIGO_ERRO_INTERNO, type RespostaErro, type TipoErroApi } from "@erp/contracts";
import type { DomainError } from "@erp/domain";

/**
 * Tradução de erro de domínio para resposta HTTP.
 *
 * É o ponto onde o vocabulário do negócio encontra o do protocolo, e ele existe
 * separado das rotas por dois motivos:
 *
 * 1. **Consistência.** Se cada rota escolher o status, "estoque insuficiente"
 *    voltará 400 numa e 409 noutra, e o PDV terá de tratar as duas.
 * 2. **Contenção de vazamento.** Nada além de código, tipo e mensagem sai
 *    daqui. `detalhes` de um `DomainError` costuma carregar id, código de
 *    barras e valor — contexto legítimo no log do servidor, indevido na
 *    resposta (CLAUDE.md §9, ARQUITETURA.md §7.6).
 */

/** Mensagem para falha não prevista. Diz o que fazer, não o que quebrou. */
export const MENSAGEM_ERRO_INTERNO =
  "Não foi possível concluir a operação. Tente novamente; se persistir, chame o suporte.";

/**
 * Categoria do erro no fio.
 *
 * `ErroInfraestrutura` se declara como `CONFLITO` porque o domínio não tem
 * categoria melhor, mas banco fora **não** é conflito: o cliente não deve
 * corrigir nada, deve repetir. Corrigir isso aqui — e não no domínio — mantém o
 * domínio sem conceito de indisponibilidade, que é assunto de infraestrutura.
 */
export function tipoNoFio(erro: DomainError): TipoErroApi {
  return erro instanceof ErroInfraestrutura ? "INDISPONIVEL" : erro.tipo;
}

/**
 * Status HTTP de cada categoria.
 *
 * A distinção que mais importa é 400 × 422: **400 é defeito do cliente**
 * (mandou o que a API não entende) e **422 é recusa de negócio** (a API
 * entendeu e a regra não permite). Colapsar as duas em 400 apagaria justamente
 * o sinal que separa bug de software de mensagem para o operador — e é essa
 * separação que decide se o PDV mostra a mensagem ou registra um defeito.
 */
export function statusHttp(tipo: TipoErroApi): number {
  switch (tipo) {
    case "VALIDACAO":
      return 400;
    case "NAO_AUTORIZADO":
      return 403;
    case "NAO_ENCONTRADO":
      return 404;
    case "CONFLITO":
      return 409;
    case "REGRA_NEGOCIO":
      return 422;
    case "INDISPONIVEL":
      return 503;
  }
}

/** Envelope de um erro de negócio. */
export function corpoDeErro(erro: DomainError, correlacao: string): RespostaErro {
  return {
    erro: {
      codigo: erro.codigo,
      tipo: tipoNoFio(erro),
      mensagem: erro.mensagem,
      correlacao,
    },
  };
}

/** Envelope de um erro montado na fronteira, sem `DomainError` por trás. */
export function corpoDeErroDireto(
  dados: {
    readonly codigo: string;
    readonly tipo: TipoErroApi;
    readonly mensagem: string;
  },
  correlacao: string,
): RespostaErro {
  return { erro: { ...dados, correlacao } };
}

/**
 * Status de falha inesperada — **500, não 503**.
 *
 * A categoria no fio é `INDISPONIVEL` porque é isso que o cliente precisa saber
 * (não é culpa dele, pode repetir), mas o status não é derivado dela: 503 diria
 * "o serviço sabe que está fora e volta", e uma exceção inesperada não sabe
 * nada disso. Confundir as duas engana o monitoramento sobre a causa.
 */
export const STATUS_ERRO_INTERNO = 500;

/**
 * Envelope de falha inesperada.
 *
 * Não recebe a exceção de propósito: assim é impossível o detalhe técnico
 * escapar por descuido de quem chama.
 */
export function corpoDeErroInterno(correlacao: string): RespostaErro {
  return corpoDeErroDireto(
    {
      codigo: CODIGO_ERRO_INTERNO,
      tipo: "INDISPONIVEL",
      mensagem: MENSAGEM_ERRO_INTERNO,
    },
    correlacao,
  );
}
