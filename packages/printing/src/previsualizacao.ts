/**
 * Bytes ESC/POS → o cupom como ele sai no papel.
 *
 * ### Por que isto existe
 *
 * Layout de cupom é onde os defeitos moram — coluna desalinhada, descrição
 * cortada, acento errado — e todos são **visuais**. Conferi-los lendo uma lista
 * de bytes é impraticável, e conferi-los na impressora exige impressora.
 *
 * Esta função fecha a lacuna: ela interpreta o mesmo fluxo que a impressora
 * receberia e devolve o texto resultante. O que ela cobre é exatamente o que dá
 * para cobrir sem hardware — alinhamento, quebra, acentuação, ordem dos
 * comandos, presença do pulso da gaveta.
 *
 * ### O que ela NÃO substitui
 *
 * Corte do papel, o pulso realmente abrir aquela gaveta, a margem física do
 * modelo e a interpretação que cada fabricante faz da CP860. Isso exige a
 * impressora na mesa, e está declarado assim de propósito: uma ferramenta que
 * se apresenta como equivalente ao teste real é pior que não ter ferramenta,
 * porque cria confiança onde não há cobertura.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type MarcaDeEstilo = "NEGRITO" | "DESTAQUE";

export interface LinhaDoCupom {
  readonly texto: string;
  readonly alinhamento: "ESQUERDA" | "CENTRO" | "DIREITA";
  readonly estilos: readonly MarcaDeEstilo[];
}

export interface CupomPrevisto {
  readonly linhas: readonly LinhaDoCupom[];
  /** Verdadeiro se o fluxo contém o pulso que abre a gaveta. */
  readonly abriuGaveta: boolean;
  readonly cortouPapel: boolean;
  /**
   * Comandos que o decodificador não conhece.
   *
   * Nunca deveria haver nenhum: o `Cupom` só emite o que está listado aqui. Um
   * comando desconhecido significa que alguém acrescentou um e esqueceu de
   * ensinar a pré-visualização — e o cupom passaria a ser conferido às cegas.
   */
  readonly comandosDesconhecidos: readonly string[];
}

/** Quantos bytes cada comando ocupa, contando o próprio prefixo. */
const TAMANHO_DO_COMANDO: Readonly<Record<string, number>> = {
  "27,64": 2, // ESC @  — iniciar
  "27,97": 3, // ESC a n — alinhamento
  "27,69": 3, // ESC E n — negrito
  "27,112": 5, // ESC p m t1 t2 — gaveta
  "29,33": 3, // GS ! n — destaque
  "29,86": 4, // GS V B n — corte
};

export function previsualizar(bytes: Uint8Array): CupomPrevisto {
  const linhas: LinhaDoCupom[] = [];
  const comandosDesconhecidos: string[] = [];

  let alinhamento: LinhaDoCupom["alinhamento"] = "ESQUERDA";
  let negrito = false;
  let destaque = false;
  let atual = "";
  let abriuGaveta = false;
  let cortouPapel = false;

  const fecharLinha = (): void => {
    const estilos: MarcaDeEstilo[] = [];
    if (negrito) estilos.push("NEGRITO");
    if (destaque) estilos.push("DESTAQUE");

    linhas.push({ texto: atual, alinhamento, estilos });
    atual = "";
  };

  let i = 0;

  while (i < bytes.length) {
    const byte = bytes[i] ?? 0;

    if (byte === LF) {
      fecharLinha();
      i += 1;
      continue;
    }

    if (byte !== ESC && byte !== GS) {
      atual += daImpressora(byte);
      i += 1;
      continue;
    }

    const chave = `${String(byte)},${String(bytes[i + 1] ?? 0)}`;
    const tamanho = TAMANHO_DO_COMANDO[chave];

    if (tamanho === undefined) {
      comandosDesconhecidos.push(chave);
      // Avança um byte só: sem saber o tamanho, pular às cegas embaralharia o
      // resto do cupom e esconderia o problema.
      i += 1;
      continue;
    }

    const parametro = bytes[i + 2] ?? 0;

    if (chave === "27,97") {
      alinhamento = parametro === 1 ? "CENTRO" : parametro === 2 ? "DIREITA" : "ESQUERDA";
    } else if (chave === "27,69") {
      negrito = parametro === 1;
    } else if (chave === "29,33") {
      destaque = parametro !== 0;
    } else if (chave === "27,112") {
      abriuGaveta = true;
    } else if (chave === "29,86") {
      cortouPapel = true;
    }

    i += tamanho;
  }

  // Conteúdo depois da última quebra ainda é uma linha impressa.
  if (atual !== "") fecharLinha();

  return { linhas, abriuGaveta, cortouPapel, comandosDesconhecidos };
}

/**
 * O cupom como texto corrido, pronto para conferência a olho.
 *
 * `largura` desenha a borda do papel, para o desalinhamento saltar aos olhos.
 */
export function comoTexto(bytes: Uint8Array, largura?: number): string {
  const { linhas } = previsualizar(bytes);

  const corpo = linhas.map((linha) => alinhar(linha, largura)).join("\n");

  if (largura === undefined) return corpo;

  const borda = "═".repeat(largura);

  return `╔${borda}╗\n${corpo
    .split("\n")
    .map((linha) => `║${linha.padEnd(largura)}║`)
    .join("\n")}\n╚${borda}╝`;
}

function alinhar(linha: LinhaDoCupom, largura: number | undefined): string {
  if (largura === undefined || linha.alinhamento === "ESQUERDA") return linha.texto;

  const folga = largura - linha.texto.length;
  if (folga <= 0) return linha.texto;

  return linha.alinhamento === "DIREITA"
    ? linha.texto.padStart(largura)
    : " ".repeat(Math.floor(folga / 2)) + linha.texto;
}

/**
 * Byte da impressora → caractere.
 *
 * A volta da CP860. Serve para conferir que "PÃO" foi mesmo codificado como
 * três bytes e volta como três letras — é o que prova que a coluna do preço
 * não desalinhou.
 */
function daImpressora(byte: number): string {
  if (byte < 0x80) return String.fromCodePoint(byte);

  return DE_CP860[byte] ?? "?";
}

const DE_CP860: Readonly<Record<number, string>> = {
  0x80: "Ç",
  0x81: "ü",
  0x82: "é",
  0x83: "â",
  0x84: "ã",
  0x85: "à",
  0x86: "Á",
  0x87: "ç",
  0x88: "ê",
  0x89: "Ê",
  0x8a: "è",
  0x8b: "Í",
  0x8c: "Ô",
  0x8d: "ì",
  0x8e: "Ã",
  0x8f: "Â",
  0x90: "É",
  0x91: "À",
  0x92: "È",
  0x93: "ô",
  0x94: "õ",
  0x95: "ò",
  0x96: "Ú",
  0x97: "ù",
  0x98: "Ì",
  0x99: "Õ",
  0x9a: "Ü",
  0x9b: "¢",
  0x9c: "£",
  0x9d: "Ù",
  0x9f: "Ó",
  0xa0: "á",
  0xa1: "í",
  0xa2: "ó",
  0xa3: "ú",
  0xa4: "ñ",
  0xa5: "Ñ",
  0xa6: "ª",
  0xa7: "º",
  0xa8: "¿",
  0xa9: "Ò",
};
