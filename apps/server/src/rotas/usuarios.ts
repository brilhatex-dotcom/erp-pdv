import { Identificador, type Usuario } from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Gestão de usuários.
 *
 * ### O tamanho da credencial é conferido aqui
 *
 * PIN de seis dígitos e senha de doze caracteres são regra de **fronteira**, não
 * de domínio: o domínio guarda um hash e não tem como saber o que ele hasheou.
 * Conferir aqui é o que impede um administrador de cadastrar alguém com PIN
 * "1234" — e o PIN fraco no balcão vale por todos os outros controles somados,
 * porque o ataque exige só presença física (ADR-0011).
 *
 * ### A credencial nunca volta na resposta
 *
 * Nem o hash. Uma tela que exibe o hash é uma tela que o coloca no cache do
 * navegador, no log do proxy e na captura de tela do suporte.
 */

const PAPEIS = [
  "OPERADOR_CAIXA",
  "SUPERVISOR",
  "ESTOQUISTA",
  "FINANCEIRO",
  "GERENTE",
  "CONTADOR",
  "ADMIN",
] as const;

/** Seis dígitos exatos — é o que a tela do balcão espera (ADR-0011). */
const zPin = z.string().regex(/^\d{6}$/, "O PIN tem 6 dígitos");

/**
 * Doze caracteres no mínimo.
 *
 * Comprimento, e não "uma maiúscula, um número e um símbolo": a regra de
 * composição produz `Senha@123` em toda instalação do país. Frase longa é mais
 * forte e mais fácil de lembrar.
 */
const zSenha = z.string().min(12, "A senha precisa de ao menos 12 caracteres").max(200);

const corpoCadastro = z.object({
  matricula: z.string().trim().min(1).max(20),
  nome: z.string().trim().min(1).max(120),
  papel: z.enum(PAPEIS),
  pin: zPin.optional(),
  senha: zSenha.optional(),
});

const corpoAlteracao = z.object({
  nome: z.string().trim().min(1).max(120),
  papel: z.enum(PAPEIS),
  ativo: z.boolean(),
});

const corpoCredencial = z.object({
  pin: zPin.optional(),
  senha: zSenha.optional(),
});

const corpoPrimeiroAdministrador = z.object({
  matricula: z.string().trim().min(1).max(20),
  nome: z.string().trim().min(1).max(120),
  senha: zSenha,
  pin: zPin.optional(),
});

export function rotasDeUsuarios(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);
  const podeGerir = {
    preHandler: [autenticado, exigirPermissao(container, "usuario:criar")],
  };

  // ── Configuração inicial ────────────────────────────────────────────────

  /**
   * A instalação ainda precisa do primeiro usuário?
   *
   * **Sem autenticação**, e tem que ser: é a pergunta que a tela de login faz
   * antes de existir alguém para autenticar. Não revela nada útil — quem tenta
   * um login numa instalação vazia descobre o mesmo na primeira tentativa.
   */
  servidor.get("/api/instalacao/situacao", async (_requisicao, resposta) => {
    const resultado = await container.instalacaoPrecisaConfiguracao.executar();

    /* v8 ignore next -- a consulta não tem caminho de erro de negócio */
    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.send({ precisaConfiguracao: resultado.unwrap() });
  });

  /**
   * Cria o primeiro administrador.
   *
   * Também sem autenticação, e protegida por algo melhor que uma senha: ela só
   * funciona **enquanto não existe nenhum usuário**. Depois do primeiro, recusa
   * para sempre. A porta se tranca sozinha, sem depender de ninguém lembrar.
   */
  servidor.post(
    "/api/instalacao/primeiro-administrador",
    async (requisicao, resposta) => {
      const entrada = corpoPrimeiroAdministrador.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, primeiroProblema(entrada.error));

      const resultado = await container.criarPrimeiroAdministrador.executar(entrada.data);

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentar(resultado.unwrap()));
    },
  );

  // ── Gestão ──────────────────────────────────────────────────────────────

  servidor.get("/api/usuarios", podeGerir, async (_requisicao, resposta) => {
    const usuarios = await container.leitura.usuarios.listar();

    return resposta.send({ itens: usuarios.map(apresentar) });
  });

  servidor.post("/api/usuarios", podeGerir, async (requisicao, resposta) => {
    const entrada = corpoCadastro.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, primeiroProblema(entrada.error));

    const resultado = await container.cadastrarUsuario.executar({
      matricula: entrada.data.matricula,
      nome: entrada.data.nome,
      papelCodigo: entrada.data.papel,
      pin: entrada.data.pin,
      senha: entrada.data.senha,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.status(201).send(apresentar(resultado.unwrap()));
  });

  servidor.put("/api/usuarios/:id", podeGerir, async (requisicao, resposta) => {
    const id = identificadorDaRota(requisicao);
    if (id === undefined) return recusar(resposta, "Usuário inválido.");

    const entrada = corpoAlteracao.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, primeiroProblema(entrada.error));

    const sessao = requisicao.autenticado;
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (sessao === undefined) return resposta.status(401).send();

    const resultado = await container.alterarUsuario.executar({
      id,
      nome: entrada.data.nome,
      papelCodigo: entrada.data.papel,
      ativo: entrada.data.ativo,
      // Quem executa vem do token, nunca do corpo: aceitá-lo do cliente
      // permitiria contornar a guarda de "não pode se desativar".
      executadoPor: sessao.usuarioId,
    });

    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.send(apresentar(resultado.unwrap()));
  });

  servidor.put(
    "/api/usuarios/:id/credencial",
    podeGerir,
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Usuário inválido.");

      const entrada = corpoCredencial.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, primeiroProblema(entrada.error));

      const sessao = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (sessao === undefined) return resposta.status(401).send();

      const resultado = await container.definirCredencial.executar({
        id,
        pin: entrada.data.pin,
        senha: entrada.data.senha,
        propria: sessao.usuarioId.equals(id),
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(204).send();
    },
  );

  /**
   * Troca da própria credencial.
   *
   * Rota separada, **sem** `usuario:criar`: quem foi obrigado a trocar a senha
   * no primeiro acesso é justamente quem não tem permissão administrativa. Sem
   * isto, o operador de caixa não conseguiria cumprir a exigência que o próprio
   * sistema criou.
   */
  servidor.put(
    "/api/acesso/minha-credencial",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const entrada = corpoCredencial.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, primeiroProblema(entrada.error));

      const sessao = requisicao.autenticado;
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (sessao === undefined) return resposta.status(401).send();

      const resultado = await container.definirCredencial.executar({
        id: sessao.usuarioId,
        pin: entrada.data.pin,
        senha: entrada.data.senha,
        propria: true,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(204).send();
    },
  );
}

/**
 * Usuário → JSON.
 *
 * Sem hash, sem contagem de tentativas, sem nada que sirva a quem não deveria
 * estar olhando. O que a tela precisa é quem é, o que pode e se está de pé.
 */
function apresentar(usuario: Usuario): Record<string, unknown> {
  return {
    id: usuario.id.valor,
    matricula: usuario.matricula.valor,
    nome: usuario.nome,
    papel: usuario.papel.codigo,
    ativo: usuario.ativo,
    precisaTrocarCredencial: usuario.precisaTrocarCredencial,
    temPin: usuario.hashPin !== undefined,
    temSenha: usuario.hashSenha !== undefined,
  };
}

function identificadorDaRota(requisicao: FastifyRequest): Identificador | undefined {
  const id = (requisicao.params as { id?: string }).id;
  /* v8 ignore next -- inalcançável: a rota só casa com o parâmetro presente */
  if (id === undefined) return undefined;

  const identificador = Identificador.criar(id);
  return identificador.isErr() ? undefined : identificador.unwrap();
}

/**
 * A primeira mensagem do Zod, e não um "requisição inválida" genérico.
 *
 * "O PIN tem 6 dígitos" diz ao administrador o que corrigir; "requisição
 * inválida" o faz tentar de novo às cegas e depois ligar para o suporte.
 */
function primeiroProblema(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Dados inválidos.";
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
