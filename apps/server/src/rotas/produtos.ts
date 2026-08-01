import { Identificador, type Produto } from "@erp/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import {
  autenticadoTem,
  exigirAutenticacao,
  exigirPermissao,
} from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * Rotas do catálogo de produtos.
 *
 * ### O custo é decidido por campo, não por rota
 *
 * `produto:ver_custo` é conferido **no servidor**, item a item. Esconder o
 * custo só na interface seria acordo de cavalheiros: quem abrir a aba de rede
 * do navegador veria a margem da loja inteira. Negar a rota inteira também não
 * serve — o operador precisa consultar preço.
 *
 * O mesmo cuidado vale na gravação: quem não pode ver o custo não o recebe no
 * formulário, logo não o devolve. Se a alteração tratasse "ausente" como zero,
 * o custo de todo produto que ele editasse iria a zero, levando junto a margem
 * de todo relatório.
 *
 * ### Preço tem rota própria
 *
 * O supervisor tem `produto:alterar_preco` e **não** tem `produto:editar` — é
 * ele quem acerta a etiqueta divergente com o cliente na frente. Dar-lhe o
 * formulário inteiro para trocar um número significaria dar-lhe permissão de
 * mexer em tudo.
 */

const zTexto = (max: number) => z.string().trim().min(1).max(max);

/** Centavos em texto — dinheiro nunca atravessa a fronteira como `number`. */
const zCentavos = z.string().regex(/^\d{1,15}$/, "valor inválido");

const zUnidade = z.enum([
  "UN",
  "PC",
  "CX",
  "FD",
  "PCT",
  "DZ",
  "KG",
  "G",
  "L",
  "ML",
  "M",
  "M2",
  "M3",
  "SC",
]);

const zReferencia = z.object({
  tipo: z.enum(["EAN", "FABRICANTE", "ORIGINAL", "SIMILAR", "INTERNO", "FORNECEDOR"]),
  valor: zTexto(60),
});

const zEmbalagem = z.object({
  unidade: zUnidade,
  /** Inteiro em texto: `bigint` não existe em JSON, e embalagem não tem fração. */
  fator: z.string().regex(/^\d{1,9}$/, "fator inválido"),
  codigoBarras: zTexto(14).optional(),
});

const camposProduto = {
  sku: zTexto(30),
  descricao: zTexto(120),
  descricaoPdv: zTexto(40).optional(),
  precoVenda: zCentavos,
  custo: zCentavos.optional(),
  codigoBarras: zTexto(14).optional(),
  codigoBalanca: z
    .string()
    .regex(/^\d{1,7}$/)
    .optional(),
  categoriaId: z.uuid().optional(),
  referencias: z.array(zReferencia).max(50).optional(),
  embalagens: z.array(zEmbalagem).max(10).optional(),
};

const corpoCadastro = z.object({
  ...camposProduto,
  tipo: z.enum(["UNITARIO", "PESAVEL"]),
  unidadeBase: zUnidade,
});

/**
 * Tipo e unidade base **não** entram na alteração.
 *
 * O produto já tem saldo de estoque e itens de venda naquela unidade; trocá-la
 * reinterpretaria o histórico sem converter nada — o inventário passaria a
 * mostrar 300 quilos onde havia 300 unidades.
 */
const corpoAlteracao = z.object({ ...camposProduto, ativo: z.boolean() });

const corpoPreco = z.object({ precoVenda: zCentavos });

const consultaBusca = z.object({
  termo: z.string().max(120).optional(),
  apenasAtivos: z.enum(["true", "false"]).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(20),
});

const consultaCodigo = z.object({ codigo: z.string().min(1).max(60) });

export function rotasDeProdutos(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);

  const protegida = (permissao: Parameters<typeof exigirPermissao>[1]) => ({
    preHandler: [autenticado, exigirPermissao(container, permissao)],
  });

  /**
   * Consulta por código — a rota mais percorrida do sistema.
   *
   * É a bipada do balcão: igualdade sobre coluna indexada, com meta de 100 ms
   * sobre 50 mil SKUs (RNF-02). A busca por texto da retaguarda é outra rota,
   * de propósito.
   */
  servidor.get(
    "/api/produtos/buscar",
    protegida("venda:criar"),
    async (requisicao, resposta) => {
      const entrada = consultaCodigo.safeParse(requisicao.query);
      if (!entrada.success) return recusar(resposta, "Informe o código do produto.");

      const produto = await container.leitura.produtos.porCodigo(entrada.data.codigo);

      if (produto === undefined) {
        return naoEncontrado(resposta, "Produto não encontrado. Confira o código.");
      }

      return resposta.send(await apresentar(container, requisicao, produto));
    },
  );

  /**
   * Lista da retaguarda.
   *
   * Exige **apenas autenticação**. Toda tela que mexe em produto precisa da
   * lista, e descrição e preço estão impressos na etiqueta da gôndola — não são
   * segredo. O que é sensível, o custo, continua atrás de `produto:ver_custo`,
   * campo a campo.
   */
  servidor.get(
    "/api/produtos",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const consulta = consultaBusca.safeParse(requisicao.query);
      if (!consulta.success) return recusar(resposta, "Consulta inválida.");

      const achados = await container.leitura.produtos.buscar({
        termo: consulta.data.termo,
        apenasAtivos: consulta.data.apenasAtivos !== "false",
        limite: consulta.data.limite,
      });

      const podeVerCusto = await autenticadoTem(
        container,
        requisicao,
        "produto:ver_custo",
      );

      return resposta.send({
        itens: achados.map((produto) => apresentarProduto(produto, podeVerCusto)),
      });
    },
  );

  servidor.get(
    "/api/produtos/:id",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Produto inválido.");

      const produto = await container.leitura.produtos.porId(id);
      if (produto === undefined)
        return naoEncontrado(resposta, "Produto não encontrado.");

      return resposta.send(await apresentar(container, requisicao, produto));
    },
  );

  servidor.post(
    "/api/produtos",
    protegida("produto:criar"),
    async (requisicao, resposta) => {
      const entrada = corpoCadastro.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Confira os campos do produto.");

      const categoriaId = interpretarCategoria(entrada.data.categoriaId);
      if (categoriaId === "INVALIDA") return recusar(resposta, "Categoria inválida.");

      // Quem não pode ver o custo também não o define: aceitar o número que ele
      // mandou seria confiar num campo que a tela dele nem mostra.
      const podeVerCusto = await autenticadoTem(
        container,
        requisicao,
        "produto:ver_custo",
      );

      const resultado = await container.cadastrarProduto.executar({
        sku: entrada.data.sku,
        descricao: entrada.data.descricao,
        descricaoPdv: entrada.data.descricaoPdv,
        tipo: entrada.data.tipo,
        unidadeBase: entrada.data.unidadeBase,
        precoVenda: BigInt(entrada.data.precoVenda),
        custo: podeVerCusto ? centavosOpcionais(entrada.data.custo) : undefined,
        codigoBarras: entrada.data.codigoBarras,
        codigoBalanca: entrada.data.codigoBalanca,
        categoriaId,
        referencias: entrada.data.referencias,
        embalagens: interpretarEmbalagens(entrada.data.embalagens),
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta
        .status(201)
        .send(apresentarProduto(resultado.unwrap(), podeVerCusto));
    },
  );

  servidor.put(
    "/api/produtos/:id",
    protegida("produto:editar"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Produto inválido.");

      const entrada = corpoAlteracao.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Confira os campos do produto.");

      const categoriaId = interpretarCategoria(entrada.data.categoriaId);
      if (categoriaId === "INVALIDA") return recusar(resposta, "Categoria inválida.");

      const podeVerCusto = await autenticadoTem(
        container,
        requisicao,
        "produto:ver_custo",
      );

      const resultado = await container.alterarProduto.executar({
        id,
        sku: entrada.data.sku,
        descricao: entrada.data.descricao,
        descricaoPdv: entrada.data.descricaoPdv,
        precoVenda: BigInt(entrada.data.precoVenda),
        // `undefined` significa "mantenha o que está lá".
        custo: podeVerCusto ? centavosOpcionais(entrada.data.custo) : undefined,
        codigoBarras: entrada.data.codigoBarras,
        codigoBalanca: entrada.data.codigoBalanca,
        categoriaId,
        referencias: entrada.data.referencias,
        embalagens: interpretarEmbalagens(entrada.data.embalagens),
        ativo: entrada.data.ativo,
        podeAlterarPreco: await autenticadoTem(
          container,
          requisicao,
          "produto:alterar_preco",
        ),
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentarProduto(resultado.unwrap(), podeVerCusto));
    },
  );

  servidor.put(
    "/api/produtos/:id/preco",
    protegida("produto:alterar_preco"),
    async (requisicao, resposta) => {
      const id = identificadorDaRota(requisicao);
      if (id === undefined) return recusar(resposta, "Produto inválido.");

      const entrada = corpoPreco.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Informe o novo preço.");

      const resultado = await container.alterarPrecoDoProduto.executar({
        id,
        precoVenda: BigInt(entrada.data.precoVenda),
      });

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(await apresentar(container, requisicao, resultado.unwrap()));
    },
  );
}

// ── Apresentação ─────────────────────────────────────────────────────────

async function apresentar(
  container: Container,
  requisicao: FastifyRequest,
  produto: Produto,
): Promise<Record<string, unknown>> {
  return apresentarProduto(
    produto,
    await autenticadoTem(container, requisicao, "produto:ver_custo"),
  );
}

function apresentarProduto(
  produto: Produto,
  podeVerCusto: boolean,
): Record<string, unknown> {
  return {
    id: produto.id.valor,
    sku: produto.sku,
    descricao: produto.descricao,
    descricaoPdv: produto.descricaoPdv,
    tipo: produto.tipo,
    unidade: produto.unidadeBase.codigo,
    // Centavos em texto: `number` perderia precisão em valores grandes, e é
    // dinheiro que está atravessando a fronteira.
    precoVenda: produto.precoVenda.centavos.toString(),
    ...(podeVerCusto ? { custo: produto.custo.centavos.toString() } : {}),
    codigoBarras: produto.codigoBarras?.valor,
    codigoBalanca: produto.codigoBalanca,
    categoriaId: produto.categoriaId?.valor,
    referencias: produto.referencias.map((referencia) => ({
      tipo: referencia.tipo,
      valor: referencia.valor,
    })),
    embalagens: produto.embalagens.map((embalagem) => ({
      unidade: embalagem.unidade.codigo,
      fator: embalagem.fator.toString(),
      codigoBarras: embalagem.codigoBarras?.valor,
    })),
    ativo: produto.ativo,
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

function interpretarCategoria(
  bruta: string | undefined,
): Identificador | undefined | "INVALIDA" {
  if (bruta === undefined) return undefined;

  const identificador = Identificador.criar(bruta);
  return identificador.isErr() ? "INVALIDA" : identificador.unwrap();
}

function centavosOpcionais(bruto: string | undefined): bigint | undefined {
  return bruto === undefined ? undefined : BigInt(bruto);
}

/** Fator vem em texto e vira `bigint` aqui, na fronteira — não no domínio. */
function interpretarEmbalagens(
  brutas: readonly z.infer<typeof zEmbalagem>[] | undefined,
): readonly EmbalagemNaFronteira[] | undefined {
  return brutas?.map((bruta) => ({
    unidade: bruta.unidade,
    fator: BigInt(bruta.fator),
    codigoBarras: bruta.codigoBarras,
  }));
}

interface EmbalagemNaFronteira {
  readonly unidade: z.infer<typeof zUnidade>;
  readonly fator: bigint;
  readonly codigoBarras: string | undefined;
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}

function naoEncontrado(resposta: FastifyReply, mensagem: string) {
  return resposta
    .status(404)
    .send({ erro: { codigo: "PRODUTO_NAO_ENCONTRADO", mensagem } });
}
