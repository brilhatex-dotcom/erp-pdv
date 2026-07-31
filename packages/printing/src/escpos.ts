/**
 * Comandos ESC/POS.
 *
 * O pacote inteiro é **puro**: monta bytes e devolve. Nada aqui abre porta,
 * arquivo ou socket — quem entrega ao equipamento é a ponte de hardware do
 * Electron. É essa separação que permite testar o cupom de uma padaria inteira
 * sem impressora nenhuma, comparando bytes, e é onde os defeitos de layout
 * realmente moram.
 *
 * O padrão é dos anos 80 e não vai mudar: a impressora recebe um fluxo de bytes
 * onde caracteres imprimíveis são texto e sequências iniciadas por `ESC` (0x1B)
 * ou `GS` (0x1D) são comandos.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Largura útil em colunas, para papel de 80 mm com fonte A. */
export const COLUNAS_80MM = 48;
/** Papel de 58 mm — comum em maquininha e em impressora compacta. */
export const COLUNAS_58MM = 32;

export type Alinhamento = "ESQUERDA" | "CENTRO" | "DIREITA";

/**
 * Acumula bytes de um cupom.
 *
 * Encadeável de propósito: o layout do cupom lê como o cupom impresso, de cima
 * para baixo. Um construtor que exigisse montar um array de comandos primeiro
 * esconderia a ordem, que é justamente o que se confere ao revisar um layout.
 */
export class Cupom {
  readonly #bytes: number[] = [];
  readonly #colunas: number;

  constructor(colunas: number = COLUNAS_80MM) {
    this.#colunas = colunas;
  }

  get colunas(): number {
    return this.#colunas;
  }

  /** `ESC @` — devolve a impressora ao estado conhecido. */
  iniciar(): this {
    return this.#comando(ESC, 0x40);
  }

  alinhar(onde: Alinhamento): this {
    const codigo = onde === "ESQUERDA" ? 0 : onde === "CENTRO" ? 1 : 2;
    return this.#comando(ESC, 0x61, codigo);
  }

  negrito(ligado: boolean): this {
    return this.#comando(ESC, 0x45, ligado ? 1 : 0);
  }

  /**
   * Dobra a altura e a largura.
   *
   * É o que torna o total legível a um metro de distância — o cliente confere o
   * valor sem pegar o cupom da mão do operador.
   */
  destaque(ligado: boolean): this {
    return this.#comando(GS, 0x21, ligado ? 0x11 : 0x00);
  }

  texto(conteudo: string): this {
    this.#bytes.push(...paraBytesDaImpressora(conteudo));
    return this;
  }

  linha(conteudo = ""): this {
    return this.texto(conteudo).quebrar();
  }

  quebrar(quantas = 1): this {
    for (let i = 0; i < quantas; i += 1) this.#bytes.push(LF);
    return this;
  }

  /**
   * Rótulo à esquerda, valor à direita, pontos no meio.
   *
   * Sem o preenchimento, o olho perde a linha em cupom de trinta itens — e é
   * exatamente onde o cliente confere se o preço bateu com a etiqueta.
   */
  entreExtremos(rotulo: string, valor: string, preenchimento = " "): this {
    const folga = this.#colunas - rotulo.length - valor.length;

    if (folga <= 0) {
      // Não cabe na mesma linha: o valor vai para a seguinte, alinhado à
      // direita. Cortar o rótulo esconderia justamente a descrição do produto.
      return this.linha(rotulo.slice(0, this.#colunas).trimEnd()).linha(
        valor.padStart(this.#colunas),
      );
    }

    return this.linha(rotulo + preenchimento.repeat(folga) + valor);
  }

  /**
   * Texto que não cabe numa linha, quebrado **entre palavras**.
   *
   * A impressora quebra sozinha ao chegar na borda, mas quebra no meio da
   * palavra: "REFRIGERAN" / "TE COLA 2L". Funciona e fica feio — e o cliente
   * lê a descrição do que levou nessa linha. Palavra maior que a largura (um
   * código de barras digitado como descrição) ainda quebra na borda, porque não
   * há onde separar.
   */
  paragrafo(conteudo: string): this {
    let atual = "";

    for (const palavra of conteudo.split(" ")) {
      if (atual === "") {
        atual = palavra;
        continue;
      }

      if (atual.length + 1 + palavra.length <= this.#colunas) {
        atual += ` ${palavra}`;
        continue;
      }

      this.linha(atual);
      atual = palavra;
    }

    return this.linha(atual);
  }

  separador(caractere = "-"): this {
    return this.linha(caractere.repeat(this.#colunas));
  }

  /** Corta o papel deixando margem para a mão pegar o cupom. */
  cortar(): this {
    return this.quebrar(4).#comando(GS, 0x56, 0x42, 0x00);
  }

  /**
   * Pulso que abre a gaveta.
   *
   * A gaveta é ligada **na impressora**, não no computador: é assim que o
   * equipamento de balcão é montado no Brasil inteiro. Por isso abrir a gaveta
   * é um comando de impressão, e não uma porta separada.
   *
   * `pino` 0 é o conector padrão; algumas gavetas usam o 1.
   */
  abrirGaveta(pino: 0 | 1 = 0): this {
    return this.#comando(ESC, 0x70, pino, 0x19, 0xfa);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }

  #comando(...bytes: readonly number[]): this {
    this.#bytes.push(...bytes);
    return this;
  }
}

/**
 * Texto → bytes da impressora, em **CP860 (Português)**.
 *
 * Impressora térmica não fala UTF-8. Mandar UTF-8 cru faz "ç" virar dois
 * caracteres estranhos e desalinhar a coluna inteira do cupom — o defeito
 * aparece em todo cupom com "Ação" ou "Pão", que é praticamente todo cupom de
 * padaria.
 *
 * Caractere fora da tabela vira o equivalente sem acento, e só então `?`.
 * Perder o acento é aceitável; perder o alinhamento da coluna de preço não.
 */
export function paraBytesDaImpressora(texto: string): number[] {
  const bytes: number[] = [];

  for (const caractere of texto) {
    const codigo = caractere.codePointAt(0) ?? 0x3f;

    if (codigo < 0x80) {
      bytes.push(codigo);
      continue;
    }

    const emCp860 = CP860[caractere];
    if (emCp860 !== undefined) {
      bytes.push(emCp860);
      continue;
    }

    const semAcento = SEM_ACENTO[caractere];
    bytes.push(semAcento === undefined ? 0x3f : (semAcento.codePointAt(0) ?? 0x3f));
  }

  return bytes;
}

/**
 * Tabela CP860 — só os caracteres que o português usa.
 *
 * A tabela completa tem 128 posições, mas metade é desenho de caixa que nenhum
 * cupom emite. Listar apenas o que aparece em nome de produto e em endereço
 * mantém a tabela conferível a olho.
 */
const CP860: Readonly<Record<string, number>> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ã: 0x84,
  à: 0x85,
  Á: 0x86,
  ç: 0x87,
  ê: 0x88,
  Ê: 0x89,
  è: 0x8a,
  Í: 0x8b,
  Ô: 0x8c,
  ì: 0x8d,
  Ã: 0x8e,
  Â: 0x8f,
  É: 0x90,
  À: 0x91,
  È: 0x92,
  ô: 0x93,
  õ: 0x94,
  ò: 0x95,
  Ú: 0x96,
  ù: 0x97,
  Ì: 0x98,
  Õ: 0x99,
  Ü: 0x9a,
  "¢": 0x9b,
  "£": 0x9c,
  Ù: 0x9d,
  Ó: 0x9f,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  "¿": 0xa8,
  Ò: 0xa9,
};

/** Último recurso: mantém a coluna, perde o acento. */
const SEM_ACENTO: Readonly<Record<string, string>> = {
  ä: "a",
  ë: "e",
  ï: "i",
  ö: "o",
  å: "a",
  Å: "A",
  Ä: "A",
  Ë: "E",
  Ï: "I",
  Ö: "O",
  ø: "o",
  Ø: "O",
  î: "i",
  Î: "I",
  û: "u",
  Û: "U",
  "€": "E",
  "–": "-",
  "—": "-",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "…": ".",
};
