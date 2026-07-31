import { ErroNaoAutorizado, Identificador } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { emitirTokenAcesso, exigirAutenticacao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/** Nome do cookie do refresh. `__Host-` exige HTTPS, caminho `/` e sem domínio. */
const COOKIE_REFRESH = "erp_refresh";
const COOKIE_SESSAO = "erp_sessao";

const entradaLogin = z.object({
  matricula: z.string().min(1).max(6),
  segredo: z.string().min(1).max(200),
  contexto: z.enum(["PDV", "RETAGUARDA"]),
  dispositivoId: z.uuid(),
});

/**
 * Rotas de acesso.
 *
 * O refresh trafega em **cookie `httpOnly`**, nunca no corpo da resposta: um
 * refresh acessível por JavaScript é um refresh que qualquer XSS leva embora.
 * O token de acesso, curto, vai no corpo — o cliente o guarda em memória.
 */
export function rotasDeAcesso(servidor: FastifyInstance, container: Container): void {
  servidor.post("/api/acesso/login", async (requisicao, resposta) => {
    const entrada = entradaLogin.safeParse(requisicao.body);

    if (!entrada.success) {
      // Mensagem genérica: dizer qual campo falhou ajudaria a sondar o formato.
      await resposta.status(400).send({
        erro: { codigo: "REQUISICAO_INVALIDA", mensagem: "Informe matrícula e senha." },
      });
      return;
    }

    const dispositivoId = Identificador.criar(entrada.data.dispositivoId);

    /* v8 ignore next -- inalcançável: o Zod já validou o formato UUID */
    if (dispositivoId.isErr()) return responderErro(resposta, dispositivoId.error);

    const resultado = await container.autenticar.executar({
      matricula: entrada.data.matricula,
      segredo: entrada.data.segredo,
      contexto: entrada.data.contexto,
      dispositivoId: dispositivoId.unwrap(),
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    const { usuario, sessao, refreshEmClaro } = resultado.unwrap();

    const token = await emitirTokenAcesso(container, {
      usuarioId: usuario.id,
      sessaoId: sessao.id,
      contexto: sessao.contexto,
      matricula: usuario.matricula.valor,
    });

    definirCookies(resposta, container, sessao.id.valor, refreshEmClaro, sessao.expiraEm);

    return resposta.send({
      token,
      expiraEm: sessao.expiraEm.toISOString(),
      usuario: {
        id: usuario.id.valor,
        nome: usuario.nome,
        matricula: usuario.matricula.valor,
        papel: usuario.papel.codigo,
        permissoes: [...usuario.papel.permissoes],
        // O cliente precisa saber para forçar a tela de troca antes de operar.
        precisaTrocarCredencial: usuario.precisaTrocarCredencial,
      },
    });
  });

  servidor.post("/api/acesso/renovar", async (requisicao, resposta) => {
    const sessaoId = Identificador.criar(requisicao.cookies[COOKIE_SESSAO] ?? "");
    const refresh = requisicao.cookies[COOKIE_REFRESH];

    if (sessaoId.isErr() || refresh === undefined) {
      await resposta.status(401).send({
        erro: {
          codigo: "SESSAO_INVALIDA",
          mensagem: "Sua sessão expirou. Entre de novo.",
        },
      });
      return;
    }

    const resultado = await container.renovarSessao.executar({
      sessaoId: sessaoId.unwrap(),
      refreshEmClaro: refresh,
    });

    if (resultado.isErr()) {
      // Sessão morta: limpar o cookie evita o cliente insistir num refresh que
      // já foi revogado — e, no caso de reúso, insistir é o que derruba de novo.
      limparCookies(resposta, container);
      return responderErro(resposta, resultado.error);
    }

    const { usuario, sessao, refreshEmClaro } = resultado.unwrap();

    const token = await emitirTokenAcesso(container, {
      usuarioId: usuario.id,
      sessaoId: sessao.id,
      contexto: sessao.contexto,
      matricula: usuario.matricula.valor,
    });

    definirCookies(resposta, container, sessao.id.valor, refreshEmClaro, sessao.expiraEm);

    return resposta.send({ token, expiraEm: sessao.expiraEm.toISOString() });
  });

  servidor.post(
    "/api/acesso/sair",
    { preHandler: exigirAutenticacao(container) },
    async (requisicao, resposta) => {
      const autenticado = requisicao.autenticado;

      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (autenticado === undefined) return resposta.status(401).send();

      // Sair encerra **todas** as sessões do usuário, não só a deste
      // dispositivo: quem clica em sair num computador compartilhado espera
      // exatamente isso, e é o comportamento seguro por padrão.
      await container.leitura.sessoes.revogarDoUsuario(
        autenticado.usuarioId,
        container.relogio.agora(),
      );

      limparCookies(resposta, container);
      return resposta.status(204).send();
    },
  );

  servidor.get(
    "/api/acesso/eu",
    { preHandler: exigirAutenticacao(container) },
    async (requisicao, resposta) => {
      const autenticado = requisicao.autenticado;

      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (autenticado === undefined) return resposta.status(401).send();

      const usuario = await container.leitura.usuarios.porId(autenticado.usuarioId);

      if (usuario === undefined || !usuario.ativo) {
        return responderErro(
          resposta,
          new ErroNaoAutorizado("USUARIO_DESCONHECIDO", "Sessão inválida."),
        );
      }

      // As permissões vêm do banco, não do token: revogar um papel precisa
      // valer na requisição seguinte, não só quando o token expirar.
      return resposta.send({
        id: usuario.id.valor,
        nome: usuario.nome,
        matricula: usuario.matricula.valor,
        papel: usuario.papel.codigo,
        permissoes: [...usuario.papel.permissoes],
        precisaTrocarCredencial: usuario.precisaTrocarCredencial,
      });
    },
  );
}

function definirCookies(
  resposta: Parameters<typeof responderErro>[0],
  container: Container,
  sessaoId: string,
  refresh: string,
  expiraEm: Date,
): void {
  const opcoes = {
    httpOnly: true,
    // `Secure` só em produção: em desenvolvimento o servidor roda em HTTP e o
    // navegador descartaria o cookie silenciosamente.
    secure: container.ambiente.ehProducao,
    sameSite: "strict" as const,
    path: "/",
    expires: expiraEm,
  };

  void resposta.setCookie(COOKIE_SESSAO, sessaoId, opcoes);
  void resposta.setCookie(COOKIE_REFRESH, refresh, opcoes);
}

function limparCookies(
  resposta: Parameters<typeof responderErro>[0],
  container: Container,
): void {
  const opcoes = {
    httpOnly: true,
    secure: container.ambiente.ehProducao,
    sameSite: "strict" as const,
    path: "/",
  };

  void resposta.clearCookie(COOKIE_SESSAO, opcoes);
  void resposta.clearCookie(COOKIE_REFRESH, opcoes);
}
