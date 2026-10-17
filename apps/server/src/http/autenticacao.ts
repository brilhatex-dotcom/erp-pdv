import {
  type AcaoSolicitada,
  type ContextoSessao,
  ErroNaoAutorizado,
  type Identificador,
  Identificador as Id,
  type Permissao,
} from "@erp/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";

import type { Container } from "../composicao/container.js";

import { responderErro } from "./erros.js";

/** Quem está por trás da requisição, depois do token conferido. */
export interface Autenticado {
  readonly usuarioId: Identificador;
  readonly sessaoId: Identificador;
  readonly contexto: ContextoSessao;
  readonly matricula: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido pelo `exigirAutenticacao`. Ausente em rota pública. */
    autenticado?: Autenticado;
  }
}

/**
 * Quem emitiu o token — e, com isso, para qual banco ele vale.
 *
 * O treinamento emite com outro nome (ADR-0026): o segredo de assinatura é o
 * mesmo, e sem esta diferença o token do "Operador de treino" abriria as rotas
 * do banco da loja. Com ela, a conferência recusa o token do outro modo como
 * recusaria um adulterado.
 */
function emissor(container: Container): string {
  return container.modo === "TREINAMENTO" ? "erp-pdv-treinamento" : "erp-pdv";
}

/**
 * Emite o token de acesso.
 *
 * Curto (15 min por padrão) e **auto-contido**: carrega usuário, sessão e
 * contexto, de modo que a maioria das requisições não consulta o banco só para
 * saber quem está falando. É o que mantém o PDV dentro da meta de resposta.
 *
 * O que ele **não** carrega são as permissões. Elas ficam no banco de propósito:
 * revogar um papel precisa valer na requisição seguinte, não só quando o token
 * expirar — e um token com 15 minutos de permissões velhas é 15 minutos de
 * acesso que o gerente acha que já tirou.
 */
export async function emitirTokenAcesso(
  container: Container,
  dados: Autenticado,
): Promise<string> {
  const segredo = new TextEncoder().encode(container.ambiente.SEGREDO_TOKEN);
  const agora = container.relogio.agora();
  const expiraEm = new Date(
    agora.getTime() + container.ambiente.MINUTOS_TOKEN_ACESSO * 60_000,
  );

  return new SignJWT({
    sid: dados.sessaoId.valor,
    ctx: dados.contexto,
    mat: dados.matricula,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(emissor(container))
    .setSubject(dados.usuarioId.valor)
    .setIssuedAt(Math.floor(agora.getTime() / 1000))
    .setExpirationTime(Math.floor(expiraEm.getTime() / 1000))
    .sign(segredo);
}

/**
 * Exige token válido.
 *
 * Devolve 401 em qualquer falha, sem distinguir token ausente de token
 * adulterado na mensagem — a distinção existe só no `codigo`, para o cliente
 * decidir entre renovar e reautenticar.
 */
export function exigirAutenticacao(container: Container) {
  const segredo = new TextEncoder().encode(container.ambiente.SEGREDO_TOKEN);
  const deQuem = emissor(container);

  return async function autenticar(
    requisicao: FastifyRequest,
    resposta: FastifyReply,
  ): Promise<void> {
    const cabecalho = requisicao.headers.authorization;

    if (cabecalho === undefined || !cabecalho.startsWith("Bearer ")) {
      await responderErro(
        resposta,
        new ErroNaoAutorizado("TOKEN_AUSENTE", "Sessão não encontrada. Entre de novo."),
      );
      return;
    }

    try {
      const { payload } = await jwtVerify(cabecalho.slice("Bearer ".length), segredo, {
        issuer: deQuem,
      });

      const usuarioId = Id.criar(String(payload.sub));
      const sessaoId = Id.criar(String(payload["sid"]));

      if (usuarioId.isErr() || sessaoId.isErr()) {
        throw new Error("identificadores inválidos no token");
      }

      requisicao.autenticado = {
        usuarioId: usuarioId.unwrap(),
        sessaoId: sessaoId.unwrap(),
        contexto: payload["ctx"] as ContextoSessao,
        matricula: String(payload["mat"]),
      };
    } catch {
      // Assinatura inválida, expirado ou malformado — todos 401. Distinguir
      // ajudaria mais quem está forjando token do que quem está operando.
      await responderErro(
        resposta,
        new ErroNaoAutorizado("TOKEN_INVALIDO", "Sua sessão expirou. Entre de novo."),
      );
      return;
    }

    // No treino, o token sozinho não basta: "recomeçar" apaga as pessoas e as
    // sessões, e o token emitido antes ainda valeria por minutos para alguém
    // que não existe mais — a outra estação que treinava veria erro em vez de
    // voltar à entrada. Uma consulta a mais por requisição, e só no treino.
    if (container.modo === "TREINAMENTO") {
      const sessao = await container.leitura.sessoes.porId(
        requisicao.autenticado.sessaoId,
      );

      if (sessao?.estaValida(container.relogio.agora()) !== true) {
        await responderErro(
          resposta,
          new ErroNaoAutorizado("SESSAO_INVALIDA", "Sua sessão expirou. Entre de novo."),
        );
      }
    }
  };
}

/**
 * Exige uma permissão, **no servidor**.
 *
 * A interface esconde o que o usuário não pode fazer — isso é experiência, não
 * segurança. A decisão real acontece aqui, e um cliente adulterado não contorna
 * nada (ARQUITETURA.md §9.5).
 */
export function exigirPermissao(container: Container, permissao: Permissao) {
  return async function autorizar(
    requisicao: FastifyRequest,
    resposta: FastifyReply,
  ): Promise<void> {
    const autenticado = requisicao.autenticado;

    /* v8 ignore start -- inalcançável: sempre encadeado após exigirAutenticacao */
    if (autenticado === undefined) {
      await responderErro(
        resposta,
        new ErroNaoAutorizado("TOKEN_AUSENTE", "Sessão não encontrada. Entre de novo."),
      );
      return;
    }
    /* v8 ignore stop */

    const acao: AcaoSolicitada = { tipo: "PERMISSAO", permissao };

    const decisao = await container.unitOfWork.transacao(async (repositorios) =>
      container.autorizarOperacao.executar(repositorios, {
        solicitanteId: autenticado.usuarioId,
        acao,
        descricao: `${requisicao.method} ${requisicao.url}`,
      }),
    );

    if (decisao.isErr()) {
      await responderErro(resposta, decisao.error);
    }
  };
}

/**
 * Responde se o autenticado tem uma permissão — sem recusar a requisição.
 *
 * Serve à decisão **por campo**, que é diferente da decisão por rota. Esconder
 * o custo só na interface seria acordo de cavalheiros: quem abrir a aba de rede
 * do navegador veria a margem da loja inteira. Já negar a rota impediria o
 * operador de consultar o preço, que é justamente o que ele precisa fazer.
 */
export async function autenticadoTem(
  container: Container,
  requisicao: FastifyRequest,
  permissao: Permissao,
): Promise<boolean> {
  const autenticado = requisicao.autenticado;
  /* v8 ignore next -- inalcançável: sempre chamado após exigirAutenticacao */
  if (autenticado === undefined) return false;

  const usuario = await container.leitura.usuarios.porId(autenticado.usuarioId);

  return usuario?.temPermissao(permissao) === true;
}
