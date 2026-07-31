import { z } from "zod";

/**
 * Configuração do servidor, validada na **partida**.
 *
 * Falhar aqui é deliberado e é o comportamento certo: um servidor que sobe com
 * segredo faltando e só descobre no primeiro login falha na loja, com o caixa
 * aberto. Falhar na partida faz o problema aparecer na instalação, que é onde
 * alguém está olhando.
 */
const esquema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORTA: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Só `localhost` por padrão: expor a API na rede exige decisão explícita. */
  ENDERECO: z.string().default("127.0.0.1"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  /**
   * Segredo de assinatura do token de acesso.
   *
   * Mínimo de 32 caracteres porque HS256 com chave curta é quebrável por força
   * bruta — e uma chave fraca aqui vale por todas as sessões da loja. O
   * instalador gera uma aleatória; **nunca** existe valor padrão de fábrica.
   */
  SEGREDO_TOKEN: z.string().min(32, "SEGREDO_TOKEN precisa de pelo menos 32 caracteres"),

  /** Minutos de validade do token de acesso (ARQUITETURA.md §8.2). */
  MINUTOS_TOKEN_ACESSO: z.coerce.number().int().min(1).max(60).default(15),

  /** Origens autorizadas, separadas por vírgula. Vazio = mesma origem apenas. */
  ORIGENS_PERMITIDAS: z.string().default(""),
});

export type Ambiente = Readonly<z.infer<typeof esquema>> & {
  readonly origens: readonly string[];
  readonly ehProducao: boolean;
};

/**
 * Lê e valida o ambiente.
 *
 * Recebe a fonte por parâmetro em vez de ler `process.env` direto: é o que
 * torna a validação testável sem sujar o ambiente do processo de teste.
 */
export function carregarAmbiente(fonte: NodeJS.ProcessEnv = process.env): Ambiente {
  const resultado = esquema.safeParse(fonte);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((problema) => `  • ${problema.path.join(".")}: ${problema.message}`)
      .join("\n");

    throw new Error(`Configuração inválida:\n${problemas}`);
  }

  const dados = resultado.data;

  return {
    ...dados,
    origens: dados.ORIGENS_PERMITIDAS.split(",")
      .map((origem) => origem.trim())
      .filter((origem) => origem !== ""),
    ehProducao: dados.NODE_ENV === "production",
  };
}
