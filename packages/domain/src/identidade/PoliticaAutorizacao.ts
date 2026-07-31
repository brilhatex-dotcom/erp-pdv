import type { Dinheiro } from "../valores/Dinheiro.js";

import { BASE_PERCENTUAL } from "./Papel.js";
import type { Permissao } from "./Permissao.js";
import type { Usuario } from "./Usuario.js";

/**
 * O que o usuário está tentando fazer.
 *
 * Deliberadamente uma união discriminada, e não um par
 * `(permissao, valor?)`: as operações com limite têm **unidades diferentes** —
 * desconto é percentual, sangria é dinheiro, cancelamento é tempo. Um campo
 * `valor: number` genérico faria alguém comparar reais com pontos-base, e o
 * erro só apareceria quando um desconto de 30% passasse por um teto de
 * R$ 30,00.
 */
export type AcaoSolicitada =
  /** Verificação simples de permissão, sem valor envolvido. */
  | { readonly tipo: "PERMISSAO"; readonly permissao: Permissao }
  | { readonly tipo: "DESCONTO_ITEM"; readonly percentualBps: number }
  | { readonly tipo: "DESCONTO_VENDA"; readonly percentualBps: number }
  | { readonly tipo: "SANGRIA"; readonly valor: Dinheiro }
  | { readonly tipo: "ESTORNO_EM_DINHEIRO"; readonly valor: Dinheiro }
  | {
      readonly tipo: "CANCELAR_VENDA";
      readonly minutosDesdeFinalizacao: number;
    };

/**
 * Resposta da política.
 *
 * São **três** saídas, não duas, e essa é a decisão de produto que mais importa
 * aqui. Um sistema que só sabe permitir e negar obriga a loja a contornar a
 * regra: o operador chama o supervisor, que **faz login no lugar dele** para
 * liberar o desconto — e a venda inteira passa a ser atribuída à pessoa errada.
 * A auditoria fica pior do que se não existisse.
 *
 * `REQUER_SUPERVISOR` preserva a operação **e** o rastro: a sessão continua
 * sendo do operador, e o evento registra quem pediu e quem autorizou
 * (ARQUITETURA.md §9.4).
 */
export type Decisao =
  | { readonly tipo: "PERMITIDO" }
  | {
      readonly tipo: "REQUER_SUPERVISOR";
      /** O que o supervisor precisa ter para liberar. */
      readonly permissaoNecessaria: Permissao;
      /** Mostrado ao operador — escrito para ele, não para o log. */
      readonly motivo: string;
    }
  | { readonly tipo: "NEGADO"; readonly motivo: string };

const PERMITIDO: Decisao = { tipo: "PERMITIDO" };

/** Permissão exigida do supervisor em cada ação com limite. */
const PERMISSAO_BASE: Record<Exclude<AcaoSolicitada["tipo"], "PERMISSAO">, Permissao> = {
  DESCONTO_ITEM: "venda:desconto",
  DESCONTO_VENDA: "venda:desconto",
  SANGRIA: "caixa:sangria",
  ESTORNO_EM_DINHEIRO: "caixa:sangria",
  CANCELAR_VENDA: "venda:cancelar",
};

/**
 * Decide se o usuário pode executar a ação.
 *
 * **Nega por padrão**: permissão ausente é permissão negada. Funcionalidade
 * nova nunca abre acesso por esquecimento.
 *
 * Função pura, sem estado e sem infraestrutura — o que a torna o ponto do
 * sistema mais barato de cobrir por teste, e é bom que seja: é ela que decide
 * quem mexe no dinheiro.
 */
export function avaliar(usuario: Usuario, acao: AcaoSolicitada): Decisao {
  if (!usuario.ativo) {
    return { tipo: "NEGADO", motivo: "Este usuário não tem mais acesso." };
  }

  if (acao.tipo === "PERMISSAO") {
    return usuario.temPermissao(acao.permissao)
      ? PERMITIDO
      : {
          tipo: "NEGADO",
          motivo: "Você não tem permissão para esta operação.",
        };
  }

  const permissaoBase = PERMISSAO_BASE[acao.tipo];

  // Sem a permissão base, nem se discute limite: o operador de caixa não
  // sangra a gaveta nem com supervisor ao lado — ele **chama** o supervisor,
  // que executa a operação com a própria conta.
  if (!usuario.temPermissao(permissaoBase)) {
    return { tipo: "NEGADO", motivo: "Você não tem permissão para esta operação." };
  }

  const { limites } = usuario.papel;

  switch (acao.tipo) {
    case "DESCONTO_ITEM":
      return avaliarPercentual(acao.percentualBps, limites.descontoMaximoItemBps, "item");

    case "DESCONTO_VENDA":
      return avaliarPercentual(
        acao.percentualBps,
        limites.descontoMaximoVendaBps,
        "venda",
      );

    case "SANGRIA":
      return avaliarValor(
        acao.valor,
        limites.valorMaximoSangria,
        "caixa:sangria",
        (teto) => `Sangria acima do seu limite de ${teto}.`,
      );

    case "ESTORNO_EM_DINHEIRO":
      return avaliarValor(
        acao.valor,
        limites.estornoMaximoEmDinheiro,
        "caixa:sangria",
        (teto) => `Estorno em dinheiro acima do seu limite de ${teto}.`,
      );

    case "CANCELAR_VENDA":
      return avaliarJanela(
        acao.minutosDesdeFinalizacao,
        limites.minutosParaCancelarVenda,
      );
  }
}

function avaliarPercentual(
  solicitadoBps: number,
  tetoBps: number | undefined,
  alvo: "item" | "venda",
): Decisao {
  if (solicitadoBps < 0 || solicitadoBps > BASE_PERCENTUAL) {
    return { tipo: "NEGADO", motivo: "Desconto inválido." };
  }

  // Limite ausente significa **sem teto**, e é o caso do gerente.
  if (tetoBps === undefined || solicitadoBps <= tetoBps) {
    return PERMITIDO;
  }

  return {
    tipo: "REQUER_SUPERVISOR",
    permissaoNecessaria: "venda:desconto_acima_limite",
    motivo: `Desconto acima do seu limite de ${formatarPercentual(tetoBps)} no ${alvo}.`,
  };
}

function avaliarValor(
  solicitado: Dinheiro,
  teto: Dinheiro | undefined,
  permissaoNecessaria: Permissao,
  motivo: (teto: string) => string,
): Decisao {
  if (solicitado.ehNegativo()) {
    return { tipo: "NEGADO", motivo: "Valor inválido." };
  }

  if (teto === undefined || solicitado.menorOuIgualA(teto)) {
    return PERMITIDO;
  }

  return {
    tipo: "REQUER_SUPERVISOR",
    permissaoNecessaria,
    motivo: motivo(teto.formatar()),
  };
}

function avaliarJanela(
  minutosDecorridos: number,
  janelaMinutos: number | undefined,
): Decisao {
  if (janelaMinutos === undefined || minutosDecorridos <= janelaMinutos) {
    return PERMITIDO;
  }

  return {
    tipo: "REQUER_SUPERVISOR",
    permissaoNecessaria: "venda:cancelar",
    motivo: `Só é possível cancelar até ${String(janelaMinutos)} minutos após a venda.`,
  };
}

/** `1500` → `"15%"`; `1550` → `"15,5%"`. Sem `Intl`, como o resto do domínio. */
function formatarPercentual(bps: number): string {
  const inteiro = Math.trunc(bps / 100);
  const fracao = bps % 100;

  if (fracao === 0) return `${String(inteiro)}%`;

  const decimais = String(fracao).padStart(2, "0").replace(/0$/, "");
  return `${String(inteiro)},${decimais}%`;
}

/**
 * Verifica se o supervisor pode liberar a operação que o operador pediu.
 *
 * A regra que evita o buraco óbvio: o supervisor precisa **da permissão que a
 * decisão exigiu** e, além disso, o próprio limite dele tem de comportar a
 * operação. Sem a segunda parte, dois operadores se autorizariam mutuamente
 * acima do teto dos dois.
 */
export function podeAutorizar(
  supervisor: Usuario,
  decisao: Extract<Decisao, { tipo: "REQUER_SUPERVISOR" }>,
  acao: AcaoSolicitada,
): boolean {
  if (!supervisor.temPermissao(decisao.permissaoNecessaria)) return false;

  return avaliar(supervisor, acao).tipo === "PERMITIDO";
}
