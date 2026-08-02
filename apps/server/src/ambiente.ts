import { existsSync } from "node:fs";

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
  /**
   * Teto de requisições por minuto, por origem.
   *
   * Generoso de propósito: uma estação de PDV com fila faz uma requisição por
   * bipada, e um operador rápido passa de um item por segundo. Um limite
   * apertado aqui não protege de nada e trava a venda no horário de pico — o
   * ataque que importa é contra o login, e esse tem limite próprio.
   */
  LIMITE_REQUISICOES_MINUTO: z.coerce.number().int().min(10).default(600),
  /**
   * Teto de tentativas de login por minuto, por origem.
   *
   * Aqui a rédea é curta: cada tentativa consome CPU do Argon2id na mesma
   * máquina que roda o caixa, e sem este limite o custo do hash vira a arma do
   * atacante. Dez por minuto é folgado para quem erra o PIN e proibitivo para
   * quem varre matrículas.
   */
  LIMITE_LOGIN_MINUTO: z.coerce.number().int().min(1).default(10),
  ORIGENS_PERMITIDAS: z.string().default(""),
  /**
   * Onde estão as telas construídas.
   *
   * Vazio significa **não servir**: é o caso do desenvolvimento, em que o Vite
   * entrega as telas com recarga a quente, e o caso do teste, que não precisa
   * delas. O instalador preenche as duas com os caminhos de dentro da pasta
   * instalada.
   *
   * Sem isto o service worker do PDV nunca registra, porque ele exige mesma
   * origem — a PWA existiria no código e não no navegador (ADR-0023).
   */
  PASTA_PDV: z.string().default(""),
  PASTA_RETAGUARDA: z.string().default(""),
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
/**
 * Carrega o `.env` gravado ao lado do servidor, se existir.
 *
 * ### Por que o servidor lê o arquivo, e não quem o inicia
 *
 * O instalador grava `servidor/.env` com a senha do banco e o segredo de token
 * (ver `configuracao.ts` do instalador), mas **o Node não lê `.env` sozinho** —
 * é preciso `--env-file` na linha de comando. O serviço do Windows sobe com
 * `node index.js` e mais nada, então sem esta chamada a instalação inteira
 * subiria sem configuração: o serviço morre na partida e a verificação final
 * diz "o sistema não respondeu", sem nunca apontar a causa.
 *
 * Fazer isso aqui, e não no lançador, é o que garante o mesmo comportamento
 * quando o técnico roda `node index.js` à mão para diagnosticar — que é
 * exatamente o momento em que ninguém quer descobrir uma diferença.
 *
 * ### O ambiente real ganha do arquivo
 *
 * É a semântica do `process.loadEnvFile`: variável já definida não é
 * sobrescrita. Isso mantém contêiner e CI no comando, e evita que um `.env`
 * esquecido numa pasta de trabalho passe por cima da configuração de verdade.
 */
export function carregarArquivoDeAmbiente(
  caminho: string,
  existe: (caminho: string) => boolean = existsSync,
  carregar: (caminho: string) => void = (alvo) => {
    process.loadEnvFile(alvo);
  },
): boolean {
  if (!existe(caminho)) return false;

  carregar(caminho);

  return true;
}

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
