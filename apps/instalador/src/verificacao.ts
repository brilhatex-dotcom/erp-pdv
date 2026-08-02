/**
 * Verificação de saúde depois de instalar.
 *
 * ### Por que o instalador confere em vez de só instalar
 *
 * Instalador que termina com "concluído" e deixa um sistema que não sobe é o
 * pior resultado possível: o lojista acredita que está pronto, descobre no dia
 * seguinte com a loja cheia, e o suporte começa sem saber o que foi feito.
 *
 * O papel do DevOps tem veto sobre "deploy sem verificação de saúde"
 * (CLAUDE.md §1). Aqui a verificação é parte da instalação, não um passo que
 * alguém lembra de fazer.
 *
 * ### As mensagens são para o lojista, não para o técnico
 *
 * "ECONNREFUSED 127.0.0.1:3000" não diz nada a quem está instalando. Cada
 * verificação devolve o que fazer, em português — porque quem lê está sozinho
 * na loja, sem ninguém para perguntar.
 */

export type ResultadoDaVerificacao =
  | { readonly tipo: "OK"; readonly nome: string; readonly detalhe?: string }
  | { readonly tipo: "FALHOU"; readonly nome: string; readonly comoResolver: string };

export interface Verificacao {
  readonly nome: string;
  executar(): Promise<ResultadoDaVerificacao>;
}

/**
 * Quanto esperar o servidor subir.
 *
 * Trinta segundos: numa máquina de 4 GB com antivírus varrendo o instalador
 * recém-escrito, o primeiro start é lento. Desistir antes produziria "falhou" num
 * sistema que subiria dois segundos depois — e o técnico reinstalaria à toa.
 */
export const ESPERA_MAXIMA_MS = 30_000;
const INTERVALO_MS = 500;

export interface DependenciasDaEspera {
  readonly buscar: (url: string) => Promise<{ readonly ok: boolean }>;
  readonly agora: () => number;
  readonly esperar: (ms: number) => Promise<void>;
}

/**
 * Espera o servidor responder em `/saude`.
 *
 * Tenta em laço porque o start não é instantâneo e o instalador não tem como
 * saber quando o processo terminou de abrir a porta. A alternativa — esperar um
 * tempo fixo — erra nos dois sentidos: curto demais falha em máquina lenta,
 * longo demais faz o técnico achar que travou.
 */
export async function esperarServidor(
  url: string,
  dependencias: DependenciasDaEspera,
  esperaMaximaMs = ESPERA_MAXIMA_MS,
): Promise<ResultadoDaVerificacao> {
  const limite = dependencias.agora() + esperaMaximaMs;

  for (;;) {
    const respondeu = await tentou(url, dependencias);

    if (respondeu) {
      return { tipo: "OK", nome: "Servidor", detalhe: "Respondeu em /saude." };
    }

    if (dependencias.agora() >= limite) {
      return {
        tipo: "FALHOU",
        nome: "Servidor",
        comoResolver:
          "O servidor não respondeu. Abra os Serviços do Windows e confira se " +
          '"ERP PDV — Servidor" está em execução. Se estiver parado, inicie-o e ' +
          "tente novamente.",
      };
    }

    await dependencias.esperar(INTERVALO_MS);
  }
}

async function tentou(url: string, dependencias: DependenciasDaEspera): Promise<boolean> {
  try {
    return (await dependencias.buscar(url)).ok;
  } catch {
    // Conexão recusada é o caso normal enquanto o serviço sobe. Só vira falha
    // quando o tempo acaba.
    return false;
  }
}

/**
 * Confere se a porta está livre **antes** de instalar.
 *
 * Descobrir o conflito depois significa desinstalar, escolher outra porta e
 * repetir tudo. Perguntar antes custa um segundo.
 */
export async function portaLivre(
  porta: number,
  tentarEscutar: (porta: number) => Promise<boolean>,
): Promise<ResultadoDaVerificacao> {
  const livre = await tentarEscutar(porta);

  return livre
    ? { tipo: "OK", nome: `Porta ${String(porta)}` }
    : {
        tipo: "FALHOU",
        nome: `Porta ${String(porta)}`,
        comoResolver:
          `A porta ${String(porta)} já está em uso por outro programa. ` +
          "Feche-o ou escolha outra porta na tela anterior.",
      };
}

/**
 * Espaço em disco.
 *
 * O PostgreSQL embarcado ocupa cerca de 200 MB, e o banco cresce com as vendas.
 * Instalar num disco quase cheio produz uma loja que para de vender no meio do
 * expediente — com o pior sintoma possível, porque o Postgres recusa escrita e
 * o operador vê erro técnico.
 */
export const ESPACO_MINIMO_BYTES = 2 * 1024 * 1024 * 1024;

export function espacoSuficiente(disponivelBytes: number): ResultadoDaVerificacao {
  if (disponivelBytes >= ESPACO_MINIMO_BYTES) {
    return {
      tipo: "OK",
      nome: "Espaço em disco",
      detalhe: `${gigabytes(disponivelBytes)} livres.`,
    };
  }

  return {
    tipo: "FALHOU",
    nome: "Espaço em disco",
    comoResolver:
      `São necessários ao menos ${gigabytes(ESPACO_MINIMO_BYTES)} livres e há ` +
      `${gigabytes(disponivelBytes)}. Libere espaço ou instale em outro disco.`,
  };
}

function gigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Junta os resultados numa resposta única, para o instalador decidir se seguiu. */
export function resumir(resultados: readonly ResultadoDaVerificacao[]): {
  readonly tudoCerto: boolean;
  readonly problemas: readonly string[];
} {
  const problemas = resultados
    .filter((resultado) => resultado.tipo === "FALHOU")
    .map((resultado) => `${resultado.nome}: ${resultado.comoResolver}`);

  return { tudoCerto: problemas.length === 0, problemas };
}
