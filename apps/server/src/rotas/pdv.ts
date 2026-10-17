import { maisVendidos, produtosDoBalcao } from "@erp/database";
import { type ConfiguracaoLoja, Dinheiro } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { INTEGRACOES } from "../composicao/integracoes.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { recusar, usuarioAutenticado } from "../http/entrada.js";

/**
 * O que a tela do caixa precisa para começar e para achar produto.
 *
 * Uma chamada de contexto ao abrir, em vez de cinco: o PDV liga de manhã com a
 * fila já formada, e cada ida ao servidor antes da primeira venda é espera.
 */

const consultaClientes = z.object({
  termo: z.string().trim().min(2).max(60),
});

const consultaProdutos = z.object({
  termo: z.string().trim().max(60).optional(),
  categoriaId: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(60).default(30),
});

/** Quantos botões rápidos cabem na tela de venda sem rolar. */
const TOTAL_BOTOES = 12;

/** Janela do "mais vendidos": um mês acompanha a sazonalidade sem esquecer o pão. */
const DIAS_MAIS_VENDIDOS = 30;

export function rotasDoPdv(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);
  const deVenda = {
    preHandler: [autenticado, exigirPermissao(container, "venda:criar")],
  };

  /**
   * Quem está no caixa, como a loja vende e o que está ligado.
   *
   * As permissões vão para a tela **esconder** o que o operador não pode — é
   * experiência, não segurança: cada rota confere de novo no servidor.
   */
  servidor.get(
    "/api/pdv/contexto",
    { preHandler: [autenticado] },
    async (requisicao, resposta) => {
      const usuarioId = usuarioAutenticado(requisicao);
      /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
      if (usuarioId === undefined) return resposta.status(401).send();

      const [usuario, empresa, { configuracao: loja, gravada }] = await Promise.all([
        container.leitura.usuarios.porId(usuarioId),
        container.leitura.empresa.atual(),
        container.obterConfiguracao.executar(),
      ]);

      /* v8 ignore next -- inalcançável: o token só existe para usuário cadastrado */
      if (usuario === undefined) return resposta.status(401).send();

      const { limites } = usuario.papel;

      return resposta.send({
        modo: container.modo,
        operador: {
          id: usuario.id.valor,
          nome: usuario.nome,
          matricula: usuario.matricula.valor,
          papel: usuario.papel.nome,
          permissoes: [...usuario.papel.permissoes].sort(),
          limites: {
            descontoMaximoItemBps: limites.descontoMaximoItemBps,
            descontoMaximoVendaBps: limites.descontoMaximoVendaBps,
          },
        },
        loja:
          empresa === undefined
            ? undefined
            : {
                nome: empresa.exibicao,
                endereco: empresa.endereco.linhaUnica(),
                telefone: empresa.telefone?.formatar(),
              },
        configuracao: { ...apresentarConfiguracao(loja), gravada },
        integracoes: INTEGRACOES,
      });
    },
  );

  /** Busca por nome, código ou categoria — o "procurar" do caixa. */
  servidor.get("/api/pdv/produtos", deVenda, async (requisicao, resposta) => {
    const consulta = consultaProdutos.safeParse(requisicao.query);
    if (!consulta.success) return recusar(resposta, "Busca inválida.");

    const { termo, categoriaId, limite } = consulta.data;

    if ((termo === undefined || termo === "") && categoriaId === undefined) {
      return recusar(resposta, "Digite parte do nome ou escolha uma categoria.");
    }

    const produtos = await produtosDoBalcao(container.prisma, {
      termo,
      categoriaId,
      limite,
    });

    return resposta.send({ produtos });
  });

  /**
   * Clientes para pôr na venda, com o fiado disponível.
   *
   * O operador não tem `financeiro:ver` e não deveria ver o extrato de
   * ninguém — mas precisa saber, com o cliente na frente, se o fiado cabe. A
   * resposta traz só o número que decide: quanto ainda pode ser vendido a
   * prazo. O documento sai mascarado: o nome identifica, e o CPF inteiro na
   * tela do caixa é dado pessoal exposto a quem está na fila (LGPD).
   */
  servidor.get(
    "/api/pdv/clientes",
    { preHandler: [autenticado, exigirPermissao(container, "cliente:consultar")] },
    async (requisicao, resposta) => {
      const consulta = consultaClientes.safeParse(requisicao.query);
      if (!consulta.success)
        return recusar(resposta, "Digite ao menos duas letras do nome.");

      const achados = await container.leitura.clientes.buscar({
        termo: consulta.data.termo,
        apenasAtivos: true,
        limite: 10,
      });

      const clientes = await Promise.all(
        achados.map(async (cliente) => {
          const emAberto = await container.leitura.titulos.emAbertoDaContraparte(
            cliente.id,
            "RECEBER",
          );
          const devido = emAberto.reduce(
            (soma, titulo) => soma + titulo.saldo.centavos,
            0n,
          );

          return {
            id: cliente.id.valor,
            nome: cliente.exibicao,
            documento: mascarar(cliente.documento?.valor),
            vendeAPrazo: cliente.vendeAPrazo,
            limiteCredito: cliente.limiteCredito.centavos.toString(),
            emAberto: devido.toString(),
            disponivel: cliente
              .creditoDisponivel(Dinheiro.deCentavos(devido).unwrap())
              .centavos.toString(),
          };
        }),
      );

      return resposta.send({ clientes });
    },
  );

  /**
   * As categorias e os botões rápidos.
   *
   * Botões: primeiro os que o gerente marcou, depois os mais vendidos do mês,
   * até encher a tela. Assim a loja recém-instalada já tem botões no segundo
   * dia, e o gerente que quer o pão sempre no primeiro botão consegue.
   */
  servidor.get("/api/pdv/atalhos", deVenda, async (_requisicao, resposta) => {
    const { configuracao } = await container.obterConfiguracao.executar();

    const categorias = (await container.leitura.categorias.listar(true)).map(
      (categoria) => ({
        id: categoria.id.valor,
        nome: categoria.nome,
        icone: categoria.icone,
        imagemId: categoria.imagemId?.valor,
      }),
    );

    if (!configuracao.temRecurso("BOTOES_RAPIDOS")) {
      return resposta.send({ categorias, botoes: [] });
    }

    const marcados = await produtosDoBalcao(container.prisma, {
      apenasBotaoRapido: true,
      limite: TOTAL_BOTOES,
    });

    const faltam = TOTAL_BOTOES - marcados.length;
    let botoes = marcados;

    if (faltam > 0) {
      const desde = new Date(
        container.relogio.agora().getTime() - DIAS_MAIS_VENDIDOS * 24 * 60 * 60 * 1000,
      );
      const ranking = await maisVendidos(container.prisma, {
        desde,
        limite: TOTAL_BOTOES,
      });
      const jaMarcados = new Set(marcados.map((produto) => produto.id));
      const ids = ranking
        .map((linha) => linha.produtoId)
        .filter((id) => !jaMarcados.has(id))
        .slice(0, faltam);

      if (ids.length > 0) {
        botoes = [
          ...marcados,
          ...(await produtosDoBalcao(container.prisma, { ids, limite: ids.length })),
        ];
      }
    }

    return resposta.send({ categorias, botoes });
  });
}

export function apresentarConfiguracao(
  configuracao: ConfiguracaoLoja,
): Record<string, unknown> {
  return {
    segmento: configuracao.segmento,
    recursos: configuracao.recursos,
    vendaSemEstoque: configuracao.vendaSemEstoque,
    larguraCupom: configuracao.larguraCupom,
    impressaoComprovante: configuracao.impressaoComprovante,
    layoutBalanca: {
      prefixos: configuracao.layoutBalanca.prefixos,
      tamanhoCodigoProduto: configuracao.layoutBalanca.tamanhoCodigoProduto,
      conteudo: configuracao.layoutBalanca.conteudo,
      casasDecimais: configuracao.layoutBalanca.casasDecimais,
    },
    logoId: configuracao.logoId?.valor,
  };
}

/**
 * `52998224725` → `***.982.247-**`; CNPJ mostra só a raiz do meio.
 *
 * O suficiente para o operador desempatar dois "José da Silva" pelo que o
 * cliente diz em voz alta, e nada que sirva a quem fotografa a tela.
 */
function mascarar(documento: string | undefined): string | undefined {
  if (documento === undefined) return undefined;

  if (documento.length === 11) {
    return `***.${documento.slice(3, 6)}.${documento.slice(6, 9)}-**`;
  }

  return `**.${documento.slice(2, 5)}.${documento.slice(5, 8)}/****-**`;
}
