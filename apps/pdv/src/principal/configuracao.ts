import { z } from "zod";

/**
 * Configuração da estação.
 *
 * Vive num arquivo JSON ao lado do executável, e **não** no banco: a estação
 * precisa saber qual é a impressora dela antes de conseguir falar com o
 * servidor — e é exatamente quando o servidor não responde que o operador mais
 * precisa do cupom.
 *
 * Validada na abertura, com Zod, como toda fronteira (CLAUDE.md §6). Arquivo
 * corrompido não pode virar `undefined` silencioso três telas adiante.
 */

const esquemaImpressora = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("REDE"),
    host: z.string().min(1),
    porta: z.number().int().min(1).max(65_535).optional(),
  }),
  z.object({ tipo: z.literal("ARQUIVO"), caminho: z.string().min(1) }),
  z.object({ tipo: z.literal("NENHUMA") }),
]);

export const esquemaConfiguracao = z.object({
  /** Endereço do servidor da loja. */
  api: z.url().default("http://localhost:3000"),
  /**
   * Impressora ausente é o **padrão**, não um erro.
   *
   * A estação recém-instalada ainda não foi configurada, e ela precisa vender
   * nesse estado. Exigir impressora para abrir o PDV inverteria a prioridade:
   * o cupom serve à venda, não o contrário.
   */
  impressora: esquemaImpressora.default({ tipo: "NENHUMA" }),
  /** 48 para papel de 80 mm; 32 para 58 mm. */
  colunas: z.number().int().min(24).max(96).default(48),
  /** Tela cheia sem barra — o balcão não navega em outra coisa. */
  quiosque: z.boolean().default(true),
});

/**
 * O tipo sai do esquema, não o contrário.
 *
 * Declarar a forma à mão e validar contra ela deixaria os dois divergirem no
 * primeiro campo novo — e a divergência aparece como campo lido `undefined` em
 * produção, não como erro de compilação.
 */
export type ConfiguracaoDaEstacao = z.infer<typeof esquemaConfiguracao>;

/**
 * Lê a configuração de um texto JSON.
 *
 * Texto ausente ou inválido devolve o padrão, **com o aviso**. A alternativa —
 * recusar-se a abrir — deixaria a loja sem caixa por causa de uma vírgula a
 * mais num arquivo que ninguém sabe editar.
 */
export function interpretarConfiguracao(bruto: string | undefined): {
  readonly configuracao: ConfiguracaoDaEstacao;
  readonly aviso?: string;
} {
  if (bruto === undefined || bruto.trim() === "") {
    return { configuracao: esquemaConfiguracao.parse({}) };
  }

  let json: unknown;

  try {
    json = JSON.parse(bruto);
  } catch {
    return {
      configuracao: esquemaConfiguracao.parse({}),
      aviso: "Configuração inválida (JSON malformado). Usando os padrões.",
    };
  }

  const lida = esquemaConfiguracao.safeParse(json);

  if (!lida.success) {
    // O caminho do primeiro problema basta: quem edita este arquivo à mão
    // conserta um campo por vez, e listar cinco erros de uma vez não ajuda a
    // achar o primeiro. Um `safeParse` que falha sempre traz ao menos um
    // problema, por isso não há caso "sem caminho" a tratar.
    const onde = lida.error.issues.map((problema) => problema.path.join(".")).join(", ");

    return {
      configuracao: esquemaConfiguracao.parse({}),
      aviso: `Configuração inválida (${onde}). Usando os padrões.`,
    };
  }

  return { configuracao: lida.data };
}
