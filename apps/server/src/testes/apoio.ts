import {
  HasherArgon2,
  PapelRepositorioPrisma,
  UsuarioRepositorioPrisma,
} from "@erp/database";
import {
  CodigoBarras,
  type CodigoPapelPadrao,
  Dinheiro,
  Identificador,
  Matricula,
  Papel,
  papelPadrao,
  type Permissao,
  Produto,
  Usuario,
} from "@erp/domain";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

import { carregarAmbiente } from "../ambiente.js";
import { type Container, montarContainer } from "../composicao/container.js";
import { montarServidor } from "../servidor.js";

/**
 * Banco próprio da suíte do servidor.
 *
 * Separado do banco do pacote de persistência de propósito: o Turbo roda os
 * pacotes **em paralelo**, e as duas suítes truncam tabelas entre casos. Com um
 * banco só, uma apagava os dados da outra no meio da execução — e a falha
 * aparecia de forma intermitente, que é o pior tipo de teste vermelho.
 */
const URL_PADRAO = "postgresql://erp:erp_dev_only@localhost:55432/erp_teste_api";

export function urlBancoDeTeste(): string {
  return process.env["DATABASE_URL_TESTE_API"] ?? URL_PADRAO;
}

/**
 * Sobe o servidor real contra o Postgres real.
 *
 * Sem `listen`: o `inject` do Fastify percorre a pilha inteira — middlewares,
 * validação, tratador de erro — sem precisar de porta livre. É o teste do
 * transporte de verdade, não de um simulacro dele.
 */
export async function montarServidorDeTeste(
  sobrescritas: Record<string, string> = {},
): Promise<{
  readonly servidor: FastifyInstance;
  readonly container: Container;
}> {
  const ambiente = carregarAmbiente({
    NODE_ENV: "test",
    DATABASE_URL: urlBancoDeTeste(),
    SEGREDO_TOKEN: "segredo-de-teste-com-mais-de-32-caracteres",
    ORIGENS_PERMITIDAS: "http://localhost:5173",
    // A suíte autentica dezenas de vezes por minuto; uma loja de verdade, não.
    // O limite continua valendo em produção e tem teste próprio — travá-lo aqui
    // só mediria a velocidade do Vitest.
    LIMITE_LOGIN_MINUTO: "1000",
    ...sobrescritas,
  });

  const container = montarContainer(ambiente);

  return { servidor: await montarServidor(container), container };
}

/**
 * Aplica as migrações no banco de teste.
 *
 * Roda **de dentro do pacote de persistência**: o `prisma` é dependência dele,
 * e invocá-lo daqui encontraria o binário só por acaso, dependendo de como o
 * pnpm resolveu a árvore naquele dia.
 */
export function prepararBanco(): void {
  const pacoteBanco = fileURLToPath(
    new URL("../../../../packages/database", import.meta.url),
  );

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: pacoteBanco,
    env: { ...process.env, DATABASE_URL: urlBancoDeTeste() },
    stdio: "pipe",
  });
}

export async function limparBanco(container: Container): Promise<void> {
  await container.prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "vendas_importadas",
      "eventos_outbox", "pagamentos", "venda_itens", "vendas",
      "recebimentos_caixa", "movimentos_caixa", "sessoes_caixa",
      "saldos_estoque", "movimentos_estoque", "embalagens",
      "referencias_produto", "produtos",
      "sessoes_acesso", "estacoes_permitidas", "usuarios",
      "permissoes_papel", "papeis",
      "categorias", "clientes", "fornecedores"
    RESTART IDENTITY CASCADE
  `);
}

let contador = 0;
export function proximoId(): Identificador {
  contador += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-c${contador.toString().padStart(11, "0")}`,
  ).unwrap();
}

/**
 * Cadastra um usuário com PIN de verdade, passando pelo Argon2id.
 *
 * O hasher real é usado de propósito nesta suíte: é o único ponto onde a
 * integração entre o algoritmo e o formato guardado no banco é exercitada.
 */
export async function cadastrarUsuario(
  container: Container,
  dados: {
    readonly matricula: string;
    readonly nome: string;
    readonly papel: CodigoPapelPadrao;
    readonly pin: string;
    readonly senha?: string;
  },
): Promise<Usuario> {
  const hasher = new HasherArgon2();
  const papeis = new PapelRepositorioPrisma(container.prisma);

  const existente = await papeis.porCodigo(dados.papel);
  const papel = existente ?? Papel.criar(papelPadrao(dados.papel, proximoId())).unwrap();
  if (existente === undefined) await papeis.salvar(papel);

  const usuario = Usuario.criar({
    id: proximoId(),
    matricula: Matricula.criar(dados.matricula).unwrap(),
    nome: dados.nome,
    papel,
    hashPin: await hasher.hash(dados.pin),
    hashSenha: dados.senha === undefined ? undefined : await hasher.hash(dados.senha),
    precisaTrocarCredencial: false,
  }).unwrap();

  await new UsuarioRepositorioPrisma(container.prisma).salvar(usuario);

  return usuario;
}

export async function cadastrarProduto(container: Container): Promise<Produto> {
  const produto = Produto.criar({
    id: proximoId(),
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    descricaoPdv: "REFRI COLA 2L",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: Dinheiro.deReais("9,90").unwrap(),
    custo: Dinheiro.deReais("6,50").unwrap(),
    codigoBarras: CodigoBarras.criar("7891000315507").unwrap(),
  }).unwrap();

  await container.leitura.produtos.salvar(produto);

  return produto;
}

/** Faz login e devolve o token e os cookies, como um cliente faria. */
export async function logar(
  servidor: FastifyInstance,
  matricula: string,
  segredo: string,
  contexto: "PDV" | "RETAGUARDA" = "PDV",
): Promise<{
  readonly token: string;
  readonly cookies: string;
  readonly corpo: Record<string, unknown>;
}> {
  const resposta = await servidor.inject({
    method: "POST",
    url: "/api/acesso/login",
    payload: {
      matricula,
      segredo,
      contexto,
      dispositivoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
    },
  });

  const corpo = resposta.json<Record<string, unknown>>();
  const token = corpo["token"];

  return {
    token: typeof token === "string" ? token : "",
    cookies: resposta.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    corpo,
  };
}

/**
 * Cadastra um usuário com papel **feito na hora**, com as permissões pedidas.
 *
 * Existe porque nem toda combinação que uma loja monta está entre os papéis de
 * fábrica — e é justamente a combinação incomum que revela buraco de
 * autorização: quem edita produto sem poder ver custo, por exemplo.
 */
export async function cadastrarUsuarioComPermissoes(
  container: Container,
  dados: {
    readonly matricula: string;
    readonly nome: string;
    readonly pin: string;
    readonly permissoes: readonly Permissao[];
  },
): Promise<Usuario> {
  const papel = Papel.criar({
    id: proximoId(),
    codigo: `TESTE_${dados.matricula}`,
    nome: `Papel de ${dados.nome}`,
    permissoes: dados.permissoes,
    limites: {},
    padrao: false,
  }).unwrap();

  await new PapelRepositorioPrisma(container.prisma).salvar(papel);

  const usuario = Usuario.criar({
    id: proximoId(),
    matricula: Matricula.criar(dados.matricula).unwrap(),
    nome: dados.nome,
    papel,
    hashPin: await new HasherArgon2().hash(dados.pin),
    precisaTrocarCredencial: false,
  }).unwrap();

  await new UsuarioRepositorioPrisma(container.prisma).salvar(usuario);

  return usuario;
}
