import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Gera os ícones do PWA sem dependência externa.
 *
 * ### Por que gerar, e não versionar um PNG pronto
 *
 * O ícone definitivo é decisão de marca, e ela ainda não existe. O que não pode
 * faltar é a **instalabilidade**: sem 192 e 512, o navegador recusa instalar a
 * PWA e o lojista nunca vê o "adicionar à tela inicial". Um ícone provisório
 * gerado por script destrava isso hoje e é substituível por um arquivo de
 * design amanhã, sem mexer em código nenhum — basta trocar os PNG.
 *
 * ### Por que PNG escrito à mão
 *
 * Converter SVG para PNG exigiria `sharp` ou `canvas`, que trazem binário
 * nativo para dentro do repositório e do instalador. Para quatro retângulos, o
 * formato PNG cru custa cinquenta linhas e zero dependência — e o papel do
 * DevOps tem veto sobre dependência nova sem justificativa (CLAUDE.md §1).
 *
 * Uso: `node scripts/gerar-icones.mjs`
 */

/** Aproximação sRGB de `--color-acao`, o azul do design system. */
const AZUL = [26, 95, 208];
const BRANCO = [255, 255, 255];

/**
 * Desenha um cupom estilizado: retângulo claro com listras, sobre o azul.
 *
 * Sem letra: renderizar tipografia à mão exigiria embutir uma fonte, e um "P"
 * mal desenhado comunica menos que uma forma reconhecível de longe — que é como
 * um ícone é visto na barra de tarefas.
 *
 * `margem` é a fração das bordas deixada livre. Ícone maskable precisa de 20%
 * porque o sistema operacional recorta o formato que quiser (círculo no
 * Android, quadrado arredondado no Windows), e desenho colado na borda é
 * desenho cortado.
 */
function desenhar(lado, margem) {
  const pixels = Buffer.alloc(lado * lado * 3);

  const pintar = (x, y, [r, g, b]) => {
    const i = (y * lado + x) * 3;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  };

  for (let y = 0; y < lado; y += 1) {
    for (let x = 0; x < lado; x += 1) pintar(x, y, AZUL);
  }

  const borda = Math.round(lado * margem);
  const largura = lado - borda * 2;
  const alturaCupom = Math.round(largura * 1.15);
  const topo = Math.round((lado - alturaCupom) / 2);

  for (let y = topo; y < topo + alturaCupom && y < lado; y += 1) {
    for (let x = borda; x < borda + largura; x += 1) pintar(x, y, BRANCO);
  }

  // Três listras: o suficiente para ler "cupom" e não virar borrão em 48px.
  const espessura = Math.max(1, Math.round(alturaCupom * 0.09));
  const recuo = Math.round(largura * 0.18);

  for (const fracao of [0.25, 0.45, 0.65]) {
    const inicio = topo + Math.round(alturaCupom * fracao);

    for (let y = inicio; y < inicio + espessura && y < lado; y += 1) {
      for (let x = borda + recuo; x < borda + largura - recuo; x += 1) {
        pintar(x, y, AZUL);
      }
    }
  }

  return pixels;
}

/** Bloco PNG: tamanho, tipo, dados e CRC-32, nessa ordem — é o que a spec pede. */
function bloco(tipo, dados) {
  const cabecalho = Buffer.alloc(4);
  cabecalho.writeUInt32BE(dados.length);

  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));

  return Buffer.concat([cabecalho, corpo, crc]);
}

const TABELA_CRC = Array.from({ length: 256 }, (_, indice) => {
  let valor = indice;

  for (let bit = 0; bit < 8; bit += 1) {
    valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
  }

  return valor >>> 0;
});

function crc32(dados) {
  let acumulado = 0xffffffff;

  for (const byte of dados) {
    acumulado = TABELA_CRC[(acumulado ^ byte) & 0xff] ^ (acumulado >>> 8);
  }

  return (acumulado ^ 0xffffffff) >>> 0;
}

function montarPng(lado, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 2; // cor verdadeira, sem alfa
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro padrão
  ihdr[12] = 0; // sem entrelaçamento

  // Cada linha começa com o byte de filtro. Zero = "sem filtro": o desenho é de
  // blocos sólidos, então o deflate já comprime bem sem predição.
  const comFiltro = Buffer.alloc(lado * (lado * 3 + 1));

  for (let y = 0; y < lado; y += 1) {
    comFiltro[y * (lado * 3 + 1)] = 0;
    pixels.copy(comFiltro, y * (lado * 3 + 1) + 1, y * lado * 3, (y + 1) * lado * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(comFiltro, { level: 9 })),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

const destino = fileURLToPath(new URL("../public/icones", import.meta.url));
mkdirSync(destino, { recursive: true });

for (const { arquivo, lado, margem } of [
  { arquivo: "icone-192.png", lado: 192, margem: 0.22 },
  { arquivo: "icone-512.png", lado: 512, margem: 0.22 },
  // 30% de margem: o recorte maskable come até 20% de cada lado.
  { arquivo: "icone-maskable-512.png", lado: 512, margem: 0.3 },
]) {
  writeFileSync(`${destino}/${arquivo}`, montarPng(lado, desenhar(lado, margem)));
  process.stdout.write(`${arquivo}\n`);
}
