import {
  type DomainError,
  err,
  ErroValidacao,
  type Identificador,
  ok,
  type Result,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { ImagemParaGravar } from "../../portas/repositorios/RepositoriosBalcao.js";

/**
 * Resumo criptográfico do conteúdo.
 *
 * Porta porque o SHA-256 é do `node:crypto` (infraestrutura). Serve à
 * deduplicação: a mesma foto enviada de novo vira a mesma imagem, e o backup
 * não carrega cópias dela.
 */
export interface ResumoDeConteudo {
  sha256(conteudo: Uint8Array): string;
}

/**
 * Teto de 512 KiB por imagem.
 *
 * A tela reduz a foto antes de enviar (um botão de caixa não precisa de mais
 * que 256 px), então o teto só barra quem contornar a tela. Ele existe porque
 * cada imagem viaja dentro de **todo** backup: uma foto de 8 MB tirada do
 * celular, multiplicada pelo catálogo, transforma o backup de minutos em horas.
 */
export const TAMANHO_MAXIMO_IMAGEM = 512 * 1024;

export type TipoImagem = ImagemParaGravar["tipo"];

/**
 * Guarda uma imagem de produto, de categoria ou o logotipo.
 *
 * O tipo é decidido pelos **bytes**, e não pelo nome do arquivo nem pelo que o
 * navegador declarou: um `.png` que é na verdade um HTML seria servido de volta
 * para outros navegadores da loja, e a imagem viraria a porta de entrada de um
 * script.
 */
export class GuardarImagem {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly resumo: ResumoDeConteudo,
  ) {}

  async executar(conteudo: Uint8Array): Promise<Result<Identificador, DomainError>> {
    if (conteudo.length === 0) {
      return err(new ErroValidacao("IMAGEM_VAZIA", "O arquivo da imagem está vazio."));
    }

    if (conteudo.length > TAMANHO_MAXIMO_IMAGEM) {
      return err(
        new ErroValidacao(
          "IMAGEM_GRANDE",
          "A imagem é grande demais. Use uma foto de até 512 KB.",
          { bytes: conteudo.length },
        ),
      );
    }

    const tipo = detectarTipoImagem(conteudo);

    if (tipo === undefined) {
      return err(
        new ErroValidacao(
          "IMAGEM_FORMATO",
          "Formato não reconhecido. Use uma foto em JPG, PNG ou WebP.",
        ),
      );
    }

    const hash = this.resumo.sha256(conteudo);

    return this.unitOfWork.transacao(async (repositorios) => {
      const existente = await repositorios.imagens.porHash(hash);
      if (existente !== undefined) return ok(existente);

      const id = this.geradorId.proximo();
      await repositorios.imagens.salvar({ id, tipo, conteudo, hash });

      return ok(id);
    });
  }
}

/**
 * O tipo pela assinatura dos primeiros bytes — o "número mágico" de cada
 * formato. É o que o próprio navegador faz para decidir como exibir.
 */
export function detectarTipoImagem(conteudo: Uint8Array): TipoImagem | undefined {
  const comeca = (assinatura: readonly number[], deslocamento = 0): boolean =>
    assinatura.every((byte, indice) => conteudo[deslocamento + indice] === byte);

  if (comeca([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (comeca([0xff, 0xd8, 0xff])) return "image/jpeg";

  // WebP: "RIFF" + 4 bytes de tamanho + "WEBP".
  if (comeca([0x52, 0x49, 0x46, 0x46]) && comeca([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  return undefined;
}
