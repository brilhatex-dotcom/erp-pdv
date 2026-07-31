import type { Relogio } from "@erp/application";
import type { RespostaProntidao, RespostaSaude } from "@erp/contracts";
import type { FastifyInstance } from "fastify";

import type { Container } from "../../composicao/container.js";

/**
 * Saúde e prontidão.
 *
 * São as duas únicas rotas sem autenticação do servidor, e isso é decisão, não
 * omissão (ADR-0018): quem as consulta é o serviço do Windows, o instalador e o
 * monitor de rede, nenhum deles em condição de fazer login. Em troca, elas não
 * revelam nada — nem nome de banco, nem versão de dependência, nem mensagem de
 * erro. `versao` sai porque é a primeira pergunta de qualquer atendimento e não
 * ajuda quem ataca uma rede local à qual já teve acesso.
 */

export interface DependenciasSaude {
  readonly container: Container;
  readonly relogio: Relogio;
  readonly versao: string;
  /** Tempo de processo, em segundos. Injetável para o teste ser determinístico. */
  readonly tempoNoArSegundos: () => number;
}

export function registrarRotasDeSaude(
  app: FastifyInstance,
  dependencias: DependenciasSaude,
): void {
  /**
   * Vivacidade. **Não toca o banco** — de propósito.
   *
   * Se tocasse, uma indisponibilidade momentânea do PostgreSQL faria o
   * supervisor de serviço reiniciar a aplicação, trocando um problema que se
   * resolve em segundos por uma parada de verdade. Reiniciar processo saudável
   * é uma das formas mais comuns de transformar incidente pequeno em loja
   * parada.
   */
  app.get("/saude", (_requisicao, resposta) => {
    const corpo: RespostaSaude = {
      status: "ok",
      versao: dependencias.versao,
      agora: dependencias.relogio.agora().toISOString(),
      tempoNoArSegundos: dependencias.tempoNoArSegundos(),
    };

    return resposta.code(200).send(corpo);
  });

  /**
   * Prontidão. Verifica as dependências e responde **503 quando não está apto**.
   *
   * O status importa mais que o corpo: é por ele que o instalador decide se a
   * instalação terminou (RNF-09), o atualizador decide se faz rollback (§13.6) e
   * o PDV decide entrar em contingência (§12.1). Devolver 200 com
   * `pronto: false` faria os três acharem que está tudo bem.
   */
  app.get("/pronto", async (_requisicao, resposta) => {
    const banco = await dependencias.container.verificarBanco();

    const corpo: RespostaProntidao = {
      pronto: banco.ok,
      verificacoes: { banco },
    };

    return resposta.code(banco.ok ? 200 : 503).send(corpo);
  });
}
