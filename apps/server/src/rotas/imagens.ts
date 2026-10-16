import { imagemParaServir } from "@erp/database";
import type { Permissao } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { autenticadoTem, exigirAutenticacao } from "../http/autenticacao.js";
import { identificadorDaRota, recusar } from "../http/entrada.js";
import { responderErro } from "../http/erros.js";

/**
 * Fotos de produto, de categoria e o logotipo.
 *
 * ### Ler é público; gravar, não
 *
 * A tela mostra a foto com `<img src>`, que não manda o token de acesso. E a
 * foto do pão não é segredo — está na vitrine. O identificador é um UUIDv7
 * com 74 bits aleatórios: ninguém lista as imagens da loja chutando endereço.
 *
 * ### A resposta não deixa a imagem virar página
 *
 * O tipo foi decidido pelos bytes na gravação, e a resposta proíbe o navegador
 * de adivinhar outro (`nosniff`) e de executar qualquer coisa
 * (`default-src 'none'`). Um arquivo que passasse por imagem não vira script
 * servido pela própria loja.
 */

/**
 * 512 KiB de foto viram ~683 KiB em base64, mais o envelope JSON. O teto da
 * rota fica acima disso e muito abaixo do que derrubaria o servidor.
 */
const TETO_DO_CORPO = 800 * 1024;

const corpoImagem = z.object({ conteudo: z.base64().max(TETO_DO_CORPO) });

/** Quem cadastra produto, categoria ou mexe na configuração pode mandar foto. */
const QUEM_ENVIA: readonly Permissao[] = [
  "produto:criar",
  "produto:editar",
  "categoria:gerenciar",
  "config:empresa",
];

export function rotasDeImagens(servidor: FastifyInstance, container: Container): void {
  servidor.get("/api/imagens/:id", async (requisicao, resposta) => {
    const id = identificadorDaRota(requisicao);
    if (id === undefined) return recusar(resposta, "Imagem inválida.");

    const imagem = await imagemParaServir(container.prisma, id.valor);

    if (imagem === undefined) {
      return resposta.status(404).send({
        erro: { codigo: "IMAGEM_NAO_ENCONTRADA", mensagem: "Imagem não encontrada." },
      });
    }

    return (
      resposta
        .header("content-type", imagem.tipo)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'")
        // O conteúdo de um identificador nunca muda: a foto nova é outra imagem.
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(Buffer.from(imagem.conteudo))
    );
  });

  servidor.post(
    "/api/imagens",
    { preHandler: [exigirAutenticacao(container)], bodyLimit: TETO_DO_CORPO + 1024 },
    async (requisicao, resposta) => {
      let pode = false;
      for (const permissao of QUEM_ENVIA) {
        if (await autenticadoTem(container, requisicao, permissao)) {
          pode = true;
          break;
        }
      }

      if (!pode) {
        return resposta.status(403).send({
          erro: {
            codigo: "OPERACAO_NEGADA",
            mensagem: "Você não tem permissão para enviar imagens.",
          },
        });
      }

      const entrada = corpoImagem.safeParse(requisicao.body);
      if (!entrada.success) return recusar(resposta, "Envie a foto em JPG, PNG ou WebP.");

      const resultado = await container.guardarImagem.executar(
        new Uint8Array(Buffer.from(entrada.data.conteudo, "base64")),
      );

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.status(201).send({ id: resultado.unwrap().valor });
    },
  );
}
