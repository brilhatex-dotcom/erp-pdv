import { ErroValidacao } from "./DomainError.js";
import { err, ok, type Result } from "./Result.js";
import type { ValueObject } from "./ValueObject.js";

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bytes aleatórios exigidos pelo UUIDv7: 12 bits de `rand_a` + 62 de `rand_b`. */
export const BYTES_ALEATORIOS_UUID_V7 = 10;

/**
 * Identificador de entidade — **UUIDv7**.
 *
 * Duas propriedades resolvem problemas concretos deste sistema:
 *
 * 1. **Gerado no cliente, sem servidor.** O PDV precisa criar uma venda estando
 *    offline (ARQUITETURA.md §12). Com auto-incremento isso é impossível: o
 *    número só existe depois do `INSERT`, e duas estações offline gerariam o
 *    mesmo.
 * 2. **Ordenável por tempo.** Ao contrário do UUIDv4, o v7 começa pelo instante
 *    de criação. Isso preserva a localidade de índice no PostgreSQL — inserções
 *    novas vão para o fim do B-tree em vez de espalhar páginas, que é o motivo
 *    de bases com UUIDv4 sofrerem com fragmentação de índice.
 */
export class Identificador implements ValueObject<Identificador> {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  static criar(valor: string): Result<Identificador, ErroValidacao> {
    const normalizado = valor.trim().toLowerCase();

    if (normalizado === "") {
      return err(new ErroValidacao("ID_VAZIO", "Identificador não informado."));
    }

    if (!FORMATO_UUID.test(normalizado)) {
      return err(
        new ErroValidacao("ID_FORMATO_INVALIDO", "Identificador inválido.", {
          valorRecebido: valor,
        }),
      );
    }

    return ok(new Identificador(normalizado));
  }

  get valor(): string {
    return this.#valor;
  }

  /** Versão declarada no UUID. `7` para os gerados por este sistema. */
  get versao(): number {
    return Number.parseInt(this.#valor.charAt(14), 16);
  }

  /**
   * Instante de criação embutido no UUIDv7, em milissegundos.
   *
   * Permite ordenar e diagnosticar sem consultar coluna de data — útil no
   * suporte remoto, quando só se tem o identificador de uma venda.
   *
   * Devolve `undefined` para UUID de outra versão, que não carrega tempo.
   */
  get criadoEmMilissegundos(): number | undefined {
    if (this.versao !== 7) return undefined;

    const hexTempo = this.#valor.slice(0, 8) + this.#valor.slice(9, 13);
    return Number.parseInt(hexTempo, 16);
  }

  equals(outro: Identificador): boolean {
    return this.#valor === outro.#valor;
  }

  toString(): string {
    return this.#valor;
  }

  toJSON(): string {
    return this.#valor;
  }
}

/**
 * Monta um UUIDv7 a partir do instante e de bytes aleatórios.
 *
 * **Função pura, e é essa a razão de ela existir assim.** O domínio não lê
 * relógio nem sorteia número: quem chama fornece os dois. Isso mantém
 * `@erp/domain` sem dependência de runtime (princípio 2 do CLAUDE.md) e, na
 * prática, torna a geração testável de forma determinística — não há como
 * escrever um teste confiável sobre uma função que consulta `Date.now()` por
 * conta própria.
 *
 * O adapter `GeradorId` é quem fornece relógio e entropia reais.
 *
 * Estrutura (RFC 9562): 48 bits de timestamp · 4 de versão · 12 de `rand_a` ·
 * 2 de variante · 62 de `rand_b`.
 */
export function montarUuidV7(
  milissegundos: number,
  aleatorios: Uint8Array,
): Result<Identificador, ErroValidacao> {
  if (!Number.isSafeInteger(milissegundos) || milissegundos < 0) {
    return err(
      new ErroValidacao("UUID_TEMPO_INVALIDO", "Instante inválido para identificador.", {
        milissegundos,
      }),
    );
  }

  // 48 bits comportam datas até o ano 10889; acima disso o timestamp truncaria.
  if (milissegundos > 0xff_ff_ff_ff_ff_ff) {
    return err(
      new ErroValidacao("UUID_TEMPO_FORA_DO_LIMITE", "Instante fora do limite.", {
        milissegundos,
      }),
    );
  }

  if (aleatorios.length < BYTES_ALEATORIOS_UUID_V7) {
    return err(
      new ErroValidacao(
        "UUID_ALEATORIOS_INSUFICIENTES",
        "Entropia insuficiente para gerar identificador.",
        { recebidos: aleatorios.length, necessarios: BYTES_ALEATORIOS_UUID_V7 },
      ),
    );
  }

  const bytes = new Uint8Array(16);

  // `set` e `DataView` em vez de indexação: sob `noUncheckedIndexedAccess` a
  // leitura por índice seria tipada como possivelmente ausente, obrigando a um
  // valor padrão que nunca ocorre — ramo intestável (ver Etapa 1).
  bytes.set(aleatorios.subarray(0, BYTES_ALEATORIOS_UUID_V7), 6);

  const vista = new DataView(bytes.buffer);

  // 48 bits de tempo, big-endian.
  const tempo = BigInt(milissegundos);
  for (let posicao = 0; posicao < 6; posicao += 1) {
    vista.setUint8(posicao, Number((tempo >> BigInt(8 * (5 - posicao))) & 0xffn));
  }

  // Versão 7 nos 4 bits altos do byte 6.
  vista.setUint8(6, (vista.getUint8(6) & 0x0f) | 0x70);
  // Variante RFC (10xx) nos 2 bits altos do byte 8.
  vista.setUint8(8, (vista.getUint8(8) & 0x3f) | 0x80);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

  return Identificador.criar(uuid);
}
