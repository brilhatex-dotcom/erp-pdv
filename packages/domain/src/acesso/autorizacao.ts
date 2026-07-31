import type { Dinheiro } from "../valores/Dinheiro.js";

import type { Permissao } from "./Permissao.js";
import type { Usuario } from "./Usuario.js";

/**
 * A decisão de autorização (ARQUITETURA.md §9.1 e §9.4).
 *
 * Três resultados, não dois. O terceiro é o que faz este modelo servir a uma
 * loja de verdade: **ultrapassar um limite não bloqueia, escala.** Bloquear puro
 * faz a equipe procurar contorno — vender por fora, pedir o login do gerente,
 * anotar num caderno — e a operação continua acontecendo, agora sem rastro.
 * Autorizar-e-registrar preserva a venda e a prova.
 *
 * É função pura, e não método do usuário, porque a decisão depende de três
 * coisas — quem, o quê e quanto — e nenhuma delas pertence às outras duas.
 * Mantê-la aqui também garante um lugar só onde a regra vive: é este arquivo que
 * o decorador `ComAutorizacao` chama no servidor (§9.5), e é ele que o teste
 * exercita.
 */

export type Decisao = "PERMITIDO" | "REQUER_SUPERVISOR" | "NEGADO";

/**
 * Quanto a operação pede, quando o "quanto" importa.
 *
 * `SIMPLES` é a maioria: abrir caixa, criar venda, cadastrar produto — ou pode
 * ou não pode. As demais carregam a grandeza que o limite do papel mede.
 */
export type Alcada =
  | { readonly tipo: "SIMPLES" }
  | { readonly tipo: "DESCONTO_ITEM"; readonly centesimosDePorCento: number }
  | { readonly tipo: "DESCONTO_VENDA"; readonly centesimosDePorCento: number }
  | { readonly tipo: "SANGRIA"; readonly valor: Dinheiro }
  | { readonly tipo: "ESTORNO_DINHEIRO"; readonly valor: Dinheiro }
  | { readonly tipo: "CANCELAR_VENDA"; readonly minutosDesdeFinalizacao: number };

export const ALCADA_SIMPLES: Alcada = { tipo: "SIMPLES" };

export interface Pedido {
  readonly usuario: Usuario;
  readonly permissao: Permissao;
  readonly alcada?: Alcada;
  readonly agora: Date;
}

/**
 * Decide se a operação acontece, escala ou é negada.
 *
 * A ordem das verificações é deliberada e vai do mais forte para o mais fraco:
 * conta imprestável, permissão ausente e só então alçada. Ela evita a resposta
 * enganosa "peça autorização do supervisor" para quem está com a conta
 * bloqueada — o supervisor viria, autorizaria, e continuaria não funcionando.
 */
export function decidir(pedido: Pedido): Decisao {
  const { usuario, permissao, agora } = pedido;

  if (!usuario.ativo || usuario.estaBloqueado(agora)) {
    return "NEGADO";
  }

  if (!usuario.temPermissao(permissao)) {
    return "NEGADO";
  }

  return cabeNaAlcada(usuario, pedido.alcada ?? ALCADA_SIMPLES)
    ? "PERMITIDO"
    : "REQUER_SUPERVISOR";
}

function cabeNaAlcada(usuario: Usuario, alcada: Alcada): boolean {
  const limites = usuario.limites;

  switch (alcada.tipo) {
    case "SIMPLES":
      return true;
    case "DESCONTO_ITEM":
      return limites.cobreDescontoEmItem(alcada.centesimosDePorCento);
    case "DESCONTO_VENDA":
      return limites.cobreDescontoNaVenda(alcada.centesimosDePorCento);
    case "SANGRIA":
      return limites.cobreSangria(alcada.valor);
    case "ESTORNO_DINHEIRO":
      return limites.cobreEstornoEmDinheiro(alcada.valor);
    case "CANCELAR_VENDA":
      return limites.cobreCancelamentoApos(alcada.minutosDesdeFinalizacao);
  }
}

/**
 * O supervisor tem alçada para autorizar o que foi escalado?
 *
 * Verificação separada porque o fluxo tem **duas** pessoas, e confundi-las é o
 * defeito que anula o controle: quem autoriza precisa de alçada para o valor
 * pedido, não apenas de um papel mais alto. Um supervisor autorizando uma sangria
 * de R$ 900 quando o próprio limite é R$ 500 seria o controle contornando a si
 * mesmo — e a auditoria registraria a aprovação como legítima.
 */
export function podeAutorizar(pedido: Pedido): boolean {
  return decidir(pedido) === "PERMITIDO";
}
