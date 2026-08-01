import { readFileSync } from "node:fs";

import { z } from "zod";

/**
 * Configuração do Agente Local.
 *
 * Vive num arquivo JSON ao lado do executável, e **não** no banco: a estação
 * precisa saber qual é a impressora dela antes de conseguir falar com o
 * servidor — e é exatamente quando o servidor não responde que o operador mais
 * precisa do cupom.
 *
 * Validada na abertura, com Zod, como toda fronteira (CLAUDE.md §6). Arquivo
 * corrompido não pode virar `undefined` silencioso três telas adiante.
 *
 * **O segredo é a única coisa sem padrão seguro.** Tudo aqui degrada para um
 * valor razoável quando falta; o segredo não pode — Agente que aceita segredo
 * vazio é Agente sem a terceira camada de defesa (`seguranca.ts`). Sem ele, o
 * processo se recusa a subir, e é o instalador que o grava.
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
  /** Tela cheia sem barra — vale para a casca de quiosque, quando usada. */
  quiosque: z.boolean().default(true),
  /** Onde ficam a fila de vendas e o catálogo replicado. */
  pastaDados: z.string().min(1).default("./dados"),
  /**
   * Origens autorizadas a falar com o Agente.
   *
   * É o endereço do servidor da loja, de onde a PWA é servida. Lista vazia
   * significa que só programa local — sem `Origin` — consegue conversar.
   */
  origensPermitidas: z.array(z.string().min(1)).default([]),
  /**
   * Segredo de emparelhamento, gravado na instalação.
   *
   * O padrão é vazio para que a leitura continue degradando como o resto — mas
   * `carregarConfiguracao` **recusa** subir com ele vazio ou curto. Interpretar
   * é tolerante; carregar é estrito, e a distinção é de propósito: um arquivo
   * com uma vírgula a mais não pode derrubar a estação, e um Agente sem segredo
   * não pode existir.
   */
  segredo: z.string().default(""),
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

/**
 * Lê a configuração do arquivo apontado pela variável de ambiente.
 *
 * Falha ao ler é **fatal aqui**, ao contrário do resto: sem configuração não há
 * segredo, e sem segredo o Agente não pode subir. Melhor não abrir e deixar o
 * rastro no log do serviço do que abrir com uma porta destrancada.
 */
export const TAMANHO_MINIMO_SEGREDO = 16;

export function carregarConfiguracao(caminho: string | undefined): ConfiguracaoDaEstacao {
  if (caminho === undefined) {
    throw new Error("Defina ERP_AGENTE_CONFIG com o caminho da configuração.");
  }

  const { configuracao, aviso } = interpretarConfiguracao(readFileSync(caminho, "utf8"));

  if (aviso !== undefined) throw new Error(aviso);

  if (configuracao.segredo.length < TAMANHO_MINIMO_SEGREDO) {
    throw new Error(
      `O segredo do agente precisa de ao menos ${String(TAMANHO_MINIMO_SEGREDO)} caracteres.`,
    );
  }

  return configuracao;
}
