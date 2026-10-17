import { criarPrismaClient, HasherArgon2, montarRepositorios } from "@erp/database";
import {
  BYTES_ALEATORIOS_UUID_V7,
  CodigoBarras,
  ConfiguracaoLoja,
  Dinheiro,
  type Identificador,
  Matricula,
  montarUuidV7,
  MovimentoEstoque,
  Papel,
  papelPadrao,
  Produto,
  Quantidade,
  Usuario,
} from "@erp/domain";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { comBanco, nomeDoBanco, URL_BANCO, URL_BANCO_TREINO } from "./bancos.js";
import { LOJA } from "./loja.js";

/**
 * O preparo do teste no navegador — o `globalSetup` do Playwright.
 *
 * Roda **depois** de o servidor subir (o Playwright inicia o `webServer`
 * antes): por isso recria os bancos com `FORCE`, e o servidor, que só se
 * conecta na primeira consulta, nunca viu o banco de antes.
 *
 * A loja entra pelos repositórios, como no teste de integração do servidor:
 * o que se testa no navegador é o caixa, não o cadastro.
 */
export default async function preparar(): Promise<void> {
  await recriar(URL_BANCO);
  // O do treino só é criado e migrado: a loja de demonstração ele monta
  // sozinho, na primeira abertura do treino — que é parte do que se testa.
  await recriar(URL_BANCO_TREINO);
  await montarLoja();
}

async function recriar(url: string): Promise<void> {
  const nome = nomeDoBanco(url);
  const administrador = criarPrismaClient({ urlBanco: comBanco(url, () => "postgres") });

  try {
    await administrador.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`,
    );
    await administrador.$executeRawUnsafe(`CREATE DATABASE "${nome}"`);
  } finally {
    await administrador.$disconnect();
  }

  // De dentro do pacote de persistência: o `prisma` é dependência dele.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: fileURLToPath(new URL("../../../packages/database", import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

function novoId(): Identificador {
  return montarUuidV7(
    Date.now(),
    new Uint8Array(randomBytes(BYTES_ALEATORIOS_UUID_V7)),
  ).unwrap();
}

async function montarLoja(): Promise<void> {
  const prisma = criarPrismaClient({ urlBanco: URL_BANCO });
  const repositorios = montarRepositorios(prisma);
  const hasher = new HasherArgon2();

  try {
    let operadorId: Identificador | undefined;

    for (const pessoa of LOJA.pessoas) {
      const papel = Papel.criar(papelPadrao(pessoa.papel, novoId())).unwrap();
      await repositorios.papeis.salvar(papel);

      const usuario = Usuario.criar({
        id: novoId(),
        matricula: Matricula.criar(pessoa.matricula).unwrap(),
        nome: pessoa.nome,
        papel,
        hashPin: await hasher.hash(pessoa.pin),
        precisaTrocarCredencial: false,
      }).unwrap();
      await repositorios.usuarios.salvar(usuario);
      operadorId ??= usuario.id;
    }

    // Comprovante sob pedido: sem Agente, a impressão seria a do navegador,
    // e o teste esperaria por uma janela de impressão que não fecha sozinha.
    const configuracao = ConfiguracaoLoja.padrao(novoId(), "MISTO");
    configuracao.alterar({ impressaoComprovante: "SOB_PEDIDO" }).unwrap();
    await repositorios.configuracao.salvar(configuracao);

    for (const dados of LOJA.produtos) {
      const produto = Produto.criar({
        id: novoId(),
        sku: dados.sku,
        descricao: dados.descricao,
        tipo: dados.codigoBalanca === undefined ? "UNITARIO" : "PESAVEL",
        unidadeBase: dados.codigoBalanca === undefined ? "UN" : "KG",
        precoVenda: Dinheiro.deReais(dados.preco).unwrap(),
        custo: Dinheiro.deReais("1,00").unwrap(),
        codigoBarras:
          dados.codigoBarras === undefined
            ? undefined
            : CodigoBarras.criar(dados.codigoBarras).unwrap(),
        codigoBalanca: dados.codigoBalanca,
      }).unwrap();
      await repositorios.produtos.salvar(produto);

      await repositorios.estoque.registrar(
        MovimentoEstoque.criar({
          id: novoId(),
          produtoId: produto.id,
          tipo: "ENTRADA",
          quantidade: Quantidade.de("100", produto.unidadeBase.codigo).unwrap(),
          origem: { tipo: "MANUAL" },
          usuarioId: operadorId ?? novoId(),
          ocorridoEm: new Date(),
        }).unwrap(),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
