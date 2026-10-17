import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Tamanho e SHA-256 do arquivo, lendo aos pedaços.
 *
 * Aos pedaços porque a cópia de uma loja com anos de vendas passa de centenas
 * de megabytes, e ler tudo de uma vez disputaria a memória com o servidor do
 * caixa.
 */
export async function resumirArquivo(
  caminho: string,
): Promise<{ readonly tamanhoBytes: number; readonly sha256: string }> {
  const resumo = createHash("sha256");

  await pipeline(
    createReadStream(caminho),
    new Writable({
      write(pedaco: Buffer, _codificacao, pronto) {
        resumo.update(pedaco);
        pronto();
      },
    }),
  );

  const { size } = await stat(caminho);

  return { tamanhoBytes: size, sha256: resumo.digest("hex") };
}
