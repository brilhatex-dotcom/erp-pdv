/**
 * Cliente HTTP e sessão — a ponte entre as telas e a API.
 *
 * Vive num pacote, e não dentro de uma aplicação, porque **duas** aplicações
 * precisam dele: a retaguarda e o PDV. Duplicá-lo faria a renovação de token
 * divergir entre as duas — e divergência em renovação de sessão aparece como
 * "o PDV desloga sozinho", que é o defeito mais caro de diagnosticar.
 *
 * Não conhece o domínio: fala em DTO e transporte. Quem traduz para regra de
 * negócio é o servidor.
 */
export {
  ClienteApi,
  ErroDaApi,
  mensagemDe,
  type OpcoesRequisicao,
  Sessao,
} from "./cliente.js";
export {
  identificadorDoDispositivo,
  ProvedorSessao,
  type PropsProvedorSessao,
  useSessao,
  type UsuarioLogado,
  type ValorSessao,
} from "./ContextoSessao.js";
