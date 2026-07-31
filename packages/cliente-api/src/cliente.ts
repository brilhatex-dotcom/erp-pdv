/**
 * Cliente HTTP da retaguarda.
 *
 * Resolve dois problemas que, se ficassem espalhados pelas telas, apareceriam
 * como defeito no meio do expediente:
 *
 * 1. **Erro traduzido.** Toda tela recebe `ErroDaApi` com a mensagem que o
 *    domínio escreveu para o operador. Nenhuma tela vê status HTTP.
 * 2. **Renovação transparente.** Token de acesso vale 15 minutos; um gerente
 *    que fica 20 minutos numa tela de relatório não pode ser jogado para fora.
 *    O cliente renova e repete a requisição **uma vez**, sem que ele perceba.
 */

/** Erro já traduzido para quem está olhando a tela. */
export class ErroDaApi extends Error {
  constructor(
    readonly codigo: string,
    /** Escrita para o operador. É o que vai para a tela. */
    readonly mensagemAmigavel: string,
    readonly status: number,
    readonly detalhes?: Readonly<Record<string, unknown>>,
  ) {
    super(`${codigo}: ${mensagemAmigavel}`);
    this.name = "ErroDaApi";
  }

  /** Sessão perdida: o cliente precisa mandar o usuário para o login. */
  get exigeNovoLogin(): boolean {
    return this.status === 401;
  }
}

interface CorpoErro {
  readonly erro?: {
    readonly codigo?: string;
    readonly mensagem?: string;
    readonly detalhes?: Readonly<Record<string, unknown>>;
  };
}

export interface OpcoesRequisicao {
  readonly metodo?: "GET" | "POST" | "PUT" | "DELETE";
  readonly corpo?: unknown;
  readonly sinal?: AbortSignal;
}

/** Guarda o token em **memória**, nunca em `localStorage`. */
export class Sessao {
  #token: string | undefined;
  /** Avisado quando a sessão morre de vez. */
  #aoPerder: (() => void) | undefined;

  get token(): string | undefined {
    return this.#token;
  }

  definir(token: string | undefined): void {
    this.#token = token;
  }

  aoPerderSessao(ouvinte: () => void): void {
    this.#aoPerder = ouvinte;
  }

  perder(): void {
    this.#token = undefined;
    this.#aoPerder?.();
  }
}

/**
 * Cliente da API.
 *
 * O token fica em **memória**, e não em `localStorage`: qualquer XSS lê
 * `localStorage`, e um token roubado de lá vale até expirar. Em memória, ele
 * morre com a aba. O refresh vive num cookie `httpOnly`, que o JavaScript não
 * alcança nem para ler — é por isso que a renovação funciona mesmo com o token
 * fora do alcance da página.
 */
export class ClienteApi {
  #renovacaoEmCurso: Promise<boolean> | undefined;

  constructor(
    readonly sessao: Sessao,
    private readonly base = "",
    private readonly buscar: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async requisitar<T>(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
    const primeira = await this.#enviar(caminho, opcoes);

    // 401 na primeira tentativa é o caso normal do token vencido. Renovar e
    // repetir **uma vez** — repetir em laço transformaria sessão morta em
    // tempestade de requisições contra o servidor da loja.
    if (primeira.status === 401 && caminho !== "/api/acesso/renovar") {
      const renovou = await this.#renovar();

      if (renovou) {
        const segunda = await this.#enviar(caminho, opcoes);
        return this.#interpretar<T>(segunda);
      }

      this.sessao.perder();
    }

    return this.#interpretar<T>(primeira);
  }

  /**
   * Renova a sessão, sem disparar várias renovações ao mesmo tempo.
   *
   * Uma tela costuma fazer três requisições em paralelo; se as três vencerem
   * juntas, três renovações concorrentes chegariam ao servidor. A segunda
   * gastaria o refresh que a primeira acabou de emitir — e isso é exatamente o
   * padrão que o servidor trata como **roubo de token**, derrubando a sessão
   * inteira. A promessa compartilhada evita que o cliente ataque a si mesmo.
   */
  async #renovar(): Promise<boolean> {
    this.#renovacaoEmCurso ??= this.#executarRenovacao().finally(() => {
      this.#renovacaoEmCurso = undefined;
    });

    return this.#renovacaoEmCurso;
  }

  async #executarRenovacao(): Promise<boolean> {
    const resposta = await this.#enviar("/api/acesso/renovar", { metodo: "POST" });

    if (!resposta.ok) return false;

    const corpo = (await resposta.json()) as { token?: string };

    if (typeof corpo.token !== "string") return false;

    this.sessao.definir(corpo.token);
    return true;
  }

  async #enviar(caminho: string, opcoes: OpcoesRequisicao): Promise<Response> {
    const cabecalhos: Record<string, string> = {};
    const token = this.sessao.token;

    if (token !== undefined) cabecalhos["authorization"] = `Bearer ${token}`;
    if (opcoes.corpo !== undefined) cabecalhos["content-type"] = "application/json";

    return this.buscar(`${this.base}${caminho}`, {
      method: opcoes.metodo ?? "GET",
      headers: cabecalhos,
      // Sem isto o cookie do refresh não acompanha a requisição, e a renovação
      // falha em silêncio — o operador só veria o login reaparecer sozinho.
      credentials: "include",
      ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
      ...(opcoes.sinal === undefined ? {} : { signal: opcoes.sinal }),
    });
  }

  async #interpretar<T>(resposta: Response): Promise<T> {
    if (resposta.status === 204) return undefined as T;

    if (resposta.ok) return (await resposta.json()) as T;

    const corpo = await this.#lerErro(resposta);

    throw new ErroDaApi(
      corpo.erro?.codigo ?? "FALHA_DESCONHECIDA",
      corpo.erro?.mensagem ?? MENSAGEM_PADRAO,
      resposta.status,
      corpo.erro?.detalhes,
    );
  }

  /**
   * Lê o corpo de erro sem nunca lançar.
   *
   * Um 502 do proxy devolve HTML, não JSON. Deixar o `json()` estourar aqui
   * substituiria a mensagem útil por um `SyntaxError` que não diz nada a
   * ninguém — e o operador veria uma tela quebrada em vez de "tente de novo".
   */
  async #lerErro(resposta: Response): Promise<CorpoErro> {
    try {
      return (await resposta.json()) as CorpoErro;
    } catch {
      return {};
    }
  }
}

const MENSAGEM_PADRAO = "Não foi possível concluir a operação. Tente novamente.";

/**
 * Traduz qualquer falha em texto para a tela.
 *
 * Rede caída não produz `ErroDaApi` — produz `TypeError: Failed to fetch`, que
 * é incompreensível. Aqui vira uma frase que diz o que fazer.
 */
export function mensagemDe(erro: unknown): string {
  if (erro instanceof ErroDaApi) return erro.mensagemAmigavel;

  if (erro instanceof TypeError) {
    return "Sem conexão com o servidor da loja. Verifique a rede e tente de novo.";
  }

  return MENSAGEM_PADRAO;
}
