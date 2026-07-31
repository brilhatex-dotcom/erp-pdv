import {
  type Categoria,
  type Cliente,
  Documento,
  type Fornecedor,
  Identificador,
} from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Rotas dos cadastros de apoio: categoria, cliente e fornecedor.
 *
 * ### Alteração é o estado completo, não o campo isolado
 *
 * `PUT` com o registro inteiro, e não `PATCH` campo a campo. A tela de cadastro
 * é um formulário que o usuário abre, edita e salva — mandar só o que mudou
 * exigiria que o cliente controlasse o que está sujo, e o primeiro erro nesse
 * controle apaga um campo sem ninguém perceber. O estado completo também torna
 * a operação idempotente: reenviar o mesmo formulário duas vezes, porque a rede
 * demorou, produz o mesmo registro.
 *
 * ### O limite de crédito é decisão de quem responde pelo dinheiro
 *
 * O balcão pode cadastrar cliente — quem pede fiado quase nunca está cadastrado,
 * e exigir supervisor nesse momento para a venda. Mas **definir o teto do
 * fiado** exige `cliente:definir_limite`, verificado aqui, no servidor. Sem essa
 * separação, qualquer operador se autorizaria a vender a prazo sem limite.
 */

const zTexto = (max: number) => z.string().trim().min(1).max(max);

/** Centavos em texto — dinheiro nunca atravessa a fronteira como `number`. */
const zCentavos = z.string().regex(/^\d{1,15}$/, "valor inválido");

const zEndereco = z.object({
  logradouro: zTexto(120),
  numero: zTexto(10),
  complemento: zTexto(60).optional(),
  bairro: zTexto(60),
  municipio: zTexto(60),
  codigoMunicipioIbge: z
    .string()
    .regex(/^\d{7}$/)
    .optional(),
  uf: z.string().length(2),
  cep: z.string().regex(/^\d{8}$/, "CEP deve ter 8 dígitos"),
});

const corpoCategoria = z.object({ nome: zTexto(60) });
const corpoCategoriaAlteracao = corpoCategoria.extend({ ativa: z.boolean() });

const camposCliente = {
  nome: zTexto(120),
  apelido: zTexto(60).optional(),
  documento: zTexto(18).optional(),
  inscricaoEstadual: zTexto(20).optional(),
  telefone: zTexto(20).optional(),
  email: zTexto(160).optional(),
  endereco: zEndereco.optional(),
  limiteCredito: zCentavos.optional(),
  observacao: zTexto(500).optional(),
};

const corpoCliente = z.object({
  ...camposCliente,
  tipoPessoa: z.enum(["FISICA", "JURIDICA"]),
});

const corpoClienteAlteracao = z.object({ ...camposCliente, ativo: z.boolean() });

const camposFornecedor = {
  razaoSocial: zTexto(120),
  nomeFantasia: zTexto(60).optional(),
  /** Obrigatório: fornecedor sem documento não fecha com nota de entrada. */
  documento: zTexto(18),
  inscricaoEstadual: zTexto(20).optional(),
  telefone: zTexto(20).optional(),
  email: zTexto(160).optional(),
  endereco: zEndereco.optional(),
  prazoEntregaDias: z.number().int().min(0).max(365).optional(),
  observacao: zTexto(500).optional(),
};

const corpoFornecedor = z.object(camposFornecedor);
const corpoFornecedorAlteracao = z.object({ ...camposFornecedor, ativo: z.boolean() });

const consultaBusca = z.object({
  termo: z.string().max(120).optional(),
  apenasAtivos: z.enum(["true", "false"]).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(20),
});

export function rotasDeCadastros(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);

  const protegida = (permissao: Parameters<typeof exigirPermissao>[1]) => ({
    preHandler: [autenticado, exigirPermissao(container, permissao)],
  });

  // ── Categoria ───────────────────────────────────────────────────────────

  /**
   * Listar categorias exige **apenas autenticação**.
   *
   * Nome de categoria não é dado sensível, e toda tela que mexe em produto
   * precisa da lista para preencher um seletor. Criar uma permissão só para
   * isto significaria concedê-la a todos os papéis — permissão que todo mundo
   * tem não decide nada e só faz o administrador se perguntar o que ela é.
   * Criar e alterar continuam atrás de `categoria:gerenciar`.
   */
  servidor.get(
    "/api/categorias",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const apenasAtivas =
        (requisicao.query as { apenasAtivas?: string }).apenasAtivas !== "false";

      const lista = await container.leitura.categorias.listar(apenasAtivas);

      return resposta.send({ itens: lista.map(apresentarCategoria) });
    },
  );

  servidor.post(
    "/api/categorias",
    protegida("categoria:gerenciar"),
    async (requisicao, resposta) => {
      const entrada = corpoCategoria.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o nome da categoria.");

      const resultado = await container.cadastrarCategoria.executar(entrada.data);
      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentarCategoria(resultado.unwrap()));
    },
  );

  servidor.put(
    "/api/categorias/:id",
    protegida("categoria:gerenciar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Categoria inválida.");

      const entrada = corpoCategoriaAlteracao.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o nome da categoria.");

      const resultado = await container.alterarCategoria.executar({
        id,
        nome: entrada.data.nome,
        ativa: entrada.data.ativa,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarCategoria(resultado.unwrap()));
    },
  );

  // ── Cliente ─────────────────────────────────────────────────────────────

  servidor.get(
    "/api/clientes",
    protegida("cliente:consultar"),
    async (requisicao, resposta) => {
      const consulta = consultaBusca.safeParse(requisicao.query);
      if (!consulta.success) return recusar(resposta, "Consulta inválida.");

      const achados = await container.leitura.clientes.buscar({
        termo: consulta.data.termo,
        apenasAtivos: consulta.data.apenasAtivos !== "false",
        limite: consulta.data.limite,
      });

      return resposta.send({ itens: achados.map(apresentarCliente) });
    },
  );

  servidor.get(
    "/api/clientes/:id",
    protegida("cliente:consultar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Cliente inválido.");

      const cliente = await container.leitura.clientes.porId(id);
      if (cliente === undefined) return naoEncontrado(resposta, "Cliente");

      return resposta.send(apresentarCliente(cliente));
    },
  );

  /**
   * Consulta por documento.
   *
   * Existe como rota própria porque é o que a tela chama **antes** de cadastrar:
   * é o que impede o mesmo CPF de entrar duas vezes e dividir o histórico de
   * compra entre dois registros que ninguém junta depois.
   */
  servidor.get(
    "/api/clientes/por-documento/:documento",
    protegida("cliente:consultar"),
    async (requisicao, resposta) => {
      /* v8 ignore next -- inalcançável: a rota só casa com o parâmetro presente */
      const bruto = (requisicao.params as { documento?: string }).documento ?? "";
      const documento = Documento.criar(bruto);

      if (documento.isErr()) return recusar(resposta, "Documento inválido.");

      const cliente = await container.leitura.clientes.porDocumento(documento.unwrap());
      if (cliente === undefined) return naoEncontrado(resposta, "Cliente");

      return resposta.send(apresentarCliente(cliente));
    },
  );

  servidor.post(
    "/api/clientes",
    protegida("cliente:cadastrar"),
    async (requisicao, resposta) => {
      const entrada = corpoCliente.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe ao menos o nome.");

      const limite = await limiteAutorizado(container, requisicao, entrada.data);
      if (limite === "NEGADO") return semPermissaoParaLimite(resposta);

      const resultado = await container.cadastrarCliente.executar({
        ...entrada.data,
        limiteCreditoCentavos: limite,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentarCliente(resultado.unwrap()));
    },
  );

  servidor.put(
    "/api/clientes/:id",
    protegida("cliente:editar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Cliente inválido.");

      const entrada = corpoClienteAlteracao.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe ao menos o nome.");

      const limite = await limiteAutorizado(container, requisicao, entrada.data);
      if (limite === "NEGADO") return semPermissaoParaLimite(resposta);

      const resultado = await container.alterarCliente.executar({
        ...entrada.data,
        id,
        limiteCreditoCentavos: limite,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarCliente(resultado.unwrap()));
    },
  );

  // ── Fornecedor ──────────────────────────────────────────────────────────

  servidor.get(
    "/api/fornecedores",
    protegida("fornecedor:consultar"),
    async (requisicao, resposta) => {
      const consulta = consultaBusca.safeParse(requisicao.query);
      if (!consulta.success) return recusar(resposta, "Consulta inválida.");

      const achados = await container.leitura.fornecedores.buscar({
        termo: consulta.data.termo,
        apenasAtivos: consulta.data.apenasAtivos !== "false",
        limite: consulta.data.limite,
      });

      return resposta.send({ itens: achados.map(apresentarFornecedor) });
    },
  );

  servidor.get(
    "/api/fornecedores/:id",
    protegida("fornecedor:consultar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Fornecedor inválido.");

      const fornecedor = await container.leitura.fornecedores.porId(id);
      if (fornecedor === undefined) return naoEncontrado(resposta, "Fornecedor");

      return resposta.send(apresentarFornecedor(fornecedor));
    },
  );

  servidor.post(
    "/api/fornecedores",
    protegida("fornecedor:cadastrar"),
    async (requisicao, resposta) => {
      const entrada = corpoFornecedor.safeParse(requisicao.body);
      if (!entrada.success) {
        return recusar(resposta, "Informe a razão social e o documento.");
      }

      const resultado = await container.cadastrarFornecedor.executar(entrada.data);
      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send(apresentarFornecedor(resultado.unwrap()));
    },
  );

  servidor.put(
    "/api/fornecedores/:id",
    protegida("fornecedor:editar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Fornecedor inválido.");

      const entrada = corpoFornecedorAlteracao.safeParse(requisicao.body);
      if (!entrada.success) {
        return recusar(resposta, "Informe a razão social e o documento.");
      }

      const resultado = await container.alterarFornecedor.executar({
        ...entrada.data,
        id,
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarFornecedor(resultado.unwrap()));
    },
  );
}

/**
 * Decide o limite de crédito que será gravado.
 *
 * Devolve `"NEGADO"` quando o corpo traz limite acima de zero e o autenticado
 * não tem `cliente:definir_limite`. Zero e ausente passam sempre: cadastrar um
 * cliente que **não** compra a prazo é operação de balcão.
 */
async function limiteAutorizado(
  container: Container,
  requisicao: FastifyRequest,
  corpo: { readonly limiteCredito?: string | undefined },
): Promise<bigint | undefined | "NEGADO"> {
  if (corpo.limiteCredito === undefined) return undefined;

  const centavos = BigInt(corpo.limiteCredito);
  if (centavos === 0n) return 0n;

  const sessao = requisicao.autenticado;
  /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
  if (sessao === undefined) return "NEGADO";

  const usuario = await container.leitura.usuarios.porId(sessao.usuarioId);

  return usuario?.temPermissao("cliente:definir_limite") === true ? centavos : "NEGADO";
}

function semPermissaoParaLimite(resposta: FastifyReply) {
  return resposta.status(403).send({
    erro: {
      codigo: "SEM_PERMISSAO_LIMITE_CREDITO",
      mensagem: "Somente o gerente pode definir limite de crédito. Chame o supervisor.",
    },
  });
}

// ── Apresentação ─────────────────────────────────────────────────────────

function apresentarCategoria(categoria: Categoria): Record<string, unknown> {
  return { id: categoria.id.valor, nome: categoria.nome, ativa: categoria.ativa };
}

function apresentarCliente(cliente: Cliente): Record<string, unknown> {
  return {
    id: cliente.id.valor,
    nome: cliente.nome,
    apelido: cliente.apelido,
    exibicao: cliente.exibicao,
    tipoPessoa: cliente.tipoPessoa,
    documento: cliente.documento?.valor,
    inscricaoEstadual: cliente.inscricaoEstadual?.valor,
    telefone: cliente.telefone?.digitos,
    email: cliente.email?.valor,
    endereco: apresentarEndereco(cliente.endereco),
    // Centavos em texto, como todo dinheiro que cruza a fronteira.
    limiteCredito: cliente.limiteCredito.centavos.toString(),
    vendeAPrazo: cliente.vendeAPrazo,
    observacao: cliente.observacao,
    ativo: cliente.ativo,
  };
}

function apresentarFornecedor(fornecedor: Fornecedor): Record<string, unknown> {
  return {
    id: fornecedor.id.valor,
    razaoSocial: fornecedor.razaoSocial,
    nomeFantasia: fornecedor.nomeFantasia,
    exibicao: fornecedor.exibicao,
    documento: fornecedor.documento.valor,
    inscricaoEstadual: fornecedor.inscricaoEstadual?.valor,
    telefone: fornecedor.telefone?.digitos,
    email: fornecedor.email?.valor,
    endereco: apresentarEndereco(fornecedor.endereco),
    prazoEntregaDias: fornecedor.prazoEntregaDias,
    observacao: fornecedor.observacao,
    ativo: fornecedor.ativo,
  };
}

function apresentarEndereco(
  endereco: Cliente["endereco"],
): Record<string, unknown> | undefined {
  if (endereco === undefined) return undefined;

  return {
    logradouro: endereco.logradouro,
    numero: endereco.numero,
    complemento: endereco.complemento,
    bairro: endereco.bairro,
    municipio: endereco.municipio,
    codigoMunicipioIbge: endereco.codigoMunicipioIbge,
    uf: endereco.uf,
    cep: endereco.cep,
  };
}

// ── Auxiliares ───────────────────────────────────────────────────────────

function identificadorDaRota(requisicao: FastifyRequest): Identificador | undefined {
  const id = (requisicao.params as { id?: string }).id;
  /* v8 ignore next -- inalcançável: a rota só casa com o parâmetro presente */
  if (id === undefined) return undefined;

  const identificador = Identificador.criar(id);
  return identificador.isErr() ? undefined : identificador.unwrap();
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}

function naoEncontrado(resposta: FastifyReply, oQue: string) {
  return resposta.status(404).send({
    erro: { codigo: "NAO_ENCONTRADO", mensagem: `${oQue} não encontrado.` },
  });
}
