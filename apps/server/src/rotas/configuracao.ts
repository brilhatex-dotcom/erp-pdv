import {
  type AlteracaoConfiguracaoLoja,
  gerarEtiquetaBalanca,
  interpretarCodigoBalanca,
  type LayoutBalanca,
  recursosDoSegmento,
  SEGMENTOS,
  validarLayoutBalanca,
} from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import {
  identificadorValidadoOpcional,
  recusar,
  usuarioAutenticado,
} from "../http/entrada.js";
import { responderErro } from "../http/erros.js";
import { apresentarConfiguracao } from "./pdv.js";

/**
 * Como a loja vende: segmento, recursos, regra de estoque, comprovante,
 * balança e logotipo.
 *
 * Gravar exige `config:empresa` — é do gerente. Ler exige só estar
 * autenticado: o caixa precisa saber, a cada abertura, se a loja usa fiado.
 */

const zLayout = z.object({
  prefixos: z
    .array(z.string().regex(/^\d{1,2}$/))
    .min(1)
    .max(5),
  tamanhoCodigoProduto: z.number().int().min(1).max(10),
  conteudo: z.enum(["PESO", "PRECO"]),
  casasDecimais: z.number().int().min(0).max(5),
});

const corpoAlteracao = z.object({
  segmento: z.enum(["PADARIA", "MERCADINHO", "FRUTARIA", "MISTO"]).optional(),
  recursos: z
    .array(z.enum(["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"]))
    .max(3)
    .optional(),
  vendaSemEstoque: z.enum(["PERMITIR", "AUTORIZAR", "BLOQUEAR"]).optional(),
  larguraCupom: z.union([z.literal(58), z.literal(80)]).optional(),
  impressaoComprovante: z.enum(["SEMPRE", "SOB_PEDIDO"]).optional(),
  layoutBalanca: zLayout.optional(),
  /** `null` tira o logotipo. */
  logoId: z.uuid().nullable().optional(),
});

const corpoTesteBalanca = z.object({
  layout: zLayout,
  /** Uma etiqueta de verdade, lida pelo leitor, para conferir o formato. */
  etiqueta: z.string().trim().max(20).optional(),
});

export function rotasDeConfiguracao(
  servidor: FastifyInstance,
  container: Container,
): void {
  const autenticado = exigirAutenticacao(container);
  const deGerente = {
    preHandler: [autenticado, exigirPermissao(container, "config:empresa")],
  };

  servidor.get(
    "/api/configuracao",
    { preHandler: [autenticado] },
    async (_requisicao, resposta) => {
      const { configuracao, gravada } = await container.obterConfiguracao.executar();

      return resposta.send({
        ...apresentarConfiguracao(configuracao),
        gravada,
        // O "usar o padrão do segmento" da tela: os recursos de fábrica de cada
        // um, para o gerente ver o que muda antes de aplicar.
        padroes: Object.fromEntries(
          SEGMENTOS.map((segmento) => [segmento, recursosDoSegmento(segmento)]),
        ),
      });
    },
  );

  servidor.put("/api/configuracao", deGerente, async (requisicao, resposta) => {
    const entrada = corpoAlteracao.safeParse(requisicao.body);
    if (!entrada.success) return recusar(resposta, "Confira os campos da configuração.");

    const usuarioId = usuarioAutenticado(requisicao);
    /* v8 ignore next -- inalcançável: o preHandler garante o autenticado */
    if (usuarioId === undefined) return resposta.status(401).send();

    const { logoId: logoBruto, ...resto } = entrada.data;
    const logoId =
      logoBruto === null ? null : identificadorValidadoOpcional(logoBruto ?? undefined);

    const alteracao: AlteracaoConfiguracaoLoja = { ...resto, logoId };

    const resultado = await container.definirConfiguracao.executar({
      usuarioId,
      alteracao,
    });
    if (resultado.isErr()) return responderErro(resposta, resultado.error);

    return resposta.send({
      ...apresentarConfiguracao(resultado.unwrap()),
      gravada: true,
    });
  });

  /**
   * Confere um formato de etiqueta antes de gravá-lo.
   *
   * Devolve uma etiqueta **de exemplo** gerada com o formato (código 12, 0,350
   * kg ou R$ 7,00) e, se o gerente bipou uma etiqueta da própria balança, o
   * que o sistema leu nela. Trocar de balança sem esta conferência é o defeito
   * que só aparece na primeira pesagem, com cliente na fila.
   */
  servidor.post(
    "/api/configuracao/balanca/testar",
    deGerente,
    async (requisicao, resposta) => {
      const entrada = corpoTesteBalanca.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Formato de etiqueta inválido.");

      const layout: LayoutBalanca = entrada.data.layout;
      const problemas = validarLayoutBalanca(layout);

      if (problemas.length > 0) {
        return resposta.status(400).send({
          erro: {
            codigo: "BALANCA_LAYOUT_INVALIDO",
            mensagem: "Confira o formato da etiqueta.",
            detalhes: {
              erros: problemas.map((erro) => ({
                codigo: erro.codigo,
                mensagem: erro.mensagem,
              })),
            },
          },
        });
      }

      const valorExemplo = layout.conteudo === "PESO" ? 350n : 700n;
      const exemplo = gerarEtiquetaBalanca(layout, "12", valorExemplo);

      const lida =
        entrada.data.etiqueta === undefined || entrada.data.etiqueta === ""
          ? undefined
          : interpretarCodigoBalanca(entrada.data.etiqueta, layout);

      return resposta.send({
        exemplo: exemplo.isOk()
          ? {
              etiqueta: exemplo.unwrap(),
              codigoProduto: "12",
              significado:
                layout.conteudo === "PESO"
                  ? "produto 12, 0,350 kg"
                  : "produto 12, R$ 7,00",
            }
          : undefined,
        leitura:
          lida === undefined
            ? undefined
            : lida.isErr()
              ? { valida: false, mensagem: lida.error.mensagem }
              : {
                  valida: true,
                  codigoProduto: lida.value.codigoProduto,
                  peso:
                    lida.value.peso === undefined
                      ? undefined
                      : {
                          milesimos: lida.value.peso.milesimos.toString(),
                          unidade: lida.value.peso.unidade.codigo,
                        },
                  preco: lida.value.preco?.centavos.toString(),
                },
      });
    },
  );
}
