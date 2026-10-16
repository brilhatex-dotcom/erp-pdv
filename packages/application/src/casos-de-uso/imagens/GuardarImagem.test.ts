import { describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import {
  detectarTipoImagem,
  GuardarImagem,
  TAMANHO_MAXIMO_IMAGEM,
} from "./GuardarImagem.js";

/**
 * O resumo é falso de propósito: soma dos bytes em hexadecimal. O que se testa
 * aqui é o fluxo — recusar, deduplicar, gravar —, não o SHA-256 do Node.
 */
const resumoFalso = {
  sha256: (conteudo: Uint8Array): string =>
    conteudo.reduce((soma, byte) => soma + byte, 0).toString(16),
};

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 4, 5]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 6,
]);

function montar() {
  const ambiente = montarAmbiente();

  return {
    ...ambiente,
    guardar: new GuardarImagem(ambiente.unitOfWork, ambiente.geradorId, resumoFalso),
  };
}

describe("Guardar imagem", () => {
  it("🔑 grava a foto e devolve o identificador", async () => {
    const sistema = montar();

    const id = (await sistema.guardar.executar(PNG)).unwrap();

    expect(sistema.imagens.itens).toHaveLength(1);
    expect(sistema.imagens.itens[0]?.id.equals(id)).toBe(true);
    expect(sistema.imagens.itens[0]?.tipo).toBe("image/png");
  });

  it("🔑 a mesma foto enviada de novo é a mesma imagem — o backup não carrega cópia", async () => {
    const sistema = montar();

    const primeira = (await sistema.guardar.executar(PNG)).unwrap();
    const segunda = (await sistema.guardar.executar(PNG)).unwrap();

    expect(segunda.equals(primeira)).toBe(true);
    expect(sistema.imagens.itens).toHaveLength(1);
  });

  it("recusa arquivo vazio", async () => {
    const resultado = await montar().guardar.executar(new Uint8Array());

    expect(resultado.isErr() && resultado.error.codigo).toBe("IMAGEM_VAZIA");
  });

  it("recusa foto grande demais, com o tamanho que cabe", async () => {
    const grande = new Uint8Array(TAMANHO_MAXIMO_IMAGEM + 1);
    grande.set(PNG);

    const resultado = await montar().guardar.executar(grande);

    expect(resultado.isErr() && resultado.error.codigo).toBe("IMAGEM_GRANDE");
    expect(resultado.isErr() && resultado.error.mensagem).toContain("512 KB");
  });

  it("🔑 o tipo vem dos bytes: um HTML com nome de .png é recusado", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");

    const resultado = await montar().guardar.executar(html);

    expect(resultado.isErr() && resultado.error.codigo).toBe("IMAGEM_FORMATO");
  });
});

describe("Detecção do formato", () => {
  it("reconhece PNG, JPEG e WebP pela assinatura", () => {
    expect(detectarTipoImagem(PNG)).toBe("image/png");
    expect(detectarTipoImagem(JPEG)).toBe("image/jpeg");
    expect(detectarTipoImagem(WEBP)).toBe("image/webp");
  });

  it("RIFF que não é WebP (um WAV, por exemplo) não passa", () => {
    const wav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
    ]);

    expect(detectarTipoImagem(wav)).toBeUndefined();
  });

  it("arquivo curto demais não é nada", () => {
    expect(detectarTipoImagem(Uint8Array.from([0x89, 0x50]))).toBeUndefined();
  });
});
