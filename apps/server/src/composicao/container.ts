import type { GeradorId, Relogio, UnitOfWork } from "@erp/application";
import type { Verificacao } from "@erp/contracts";
import { criarPrismaClient, type PrismaClient, UnitOfWorkPrisma } from "@erp/database";

import { GeradorUuidV7 } from "./adaptadores/GeradorUuidV7.js";
import { RelogioSistema } from "./adaptadores/RelogioSistema.js";
import type { Ambiente } from "./ambiente.js";

/**
 * Composição — **o único lugar onde porta encontra adapter**.
 *
 * Todo o resto do sistema conhece apenas interfaces. Concentrar a montagem aqui
 * é o que permite ao CI provar que o domínio não conhece o Prisma: se a
 * escolha do adapter estivesse espalhada pelas rotas, a regra de arquitetura
 * seria só uma recomendação.
 */
export interface Container {
  readonly relogio: Relogio;
  readonly geradorId: GeradorId;
  readonly unitOfWork: UnitOfWork;

  /** Verifica se o banco responde. Usada por `/pronto`. */
  verificarBanco(): Promise<Verificacao>;

  /** Devolve as conexões. Chamada no encerramento gracioso. */
  encerrar(): Promise<void>;
}

/**
 * Teto da verificação de prontidão.
 *
 * Verificação sem tempo limite não é verificação: banco travado deixaria
 * `/pronto` pendurado, e quem consulta — instalador, atualizador, PDV
 * decidindo entrar em contingência — ficaria esperando em vez de receber
 * "não está pronto". Responder "não" rápido é mais útil que responder certo
 * devagar.
 */
const TEMPO_LIMITE_VERIFICACAO_MS = 2_000;

export function montarContainer(ambiente: Ambiente): Container {
  const prisma = criarPrismaClient({
    urlBanco: ambiente.urlBanco,
    registrarConsultas: ambiente.registrarConsultasSql,
  });

  return montarContainerCom(prisma);
}

/**
 * Monta o container sobre um cliente já existente.
 *
 * Existe separado para que o teste de integração use o cliente do banco de
 * teste sem passar por variável de ambiente.
 */
export function montarContainerCom(prisma: PrismaClient): Container {
  const relogio = new RelogioSistema();

  return {
    relogio,
    geradorId: new GeradorUuidV7(relogio),
    unitOfWork: new UnitOfWorkPrisma(prisma),

    async verificarBanco(): Promise<Verificacao> {
      const inicio = performance.now();

      try {
        await comTempoLimite(prisma.$queryRaw`SELECT 1`, TEMPO_LIMITE_VERIFICACAO_MS);
        return { ok: true, latenciaMs: decorridoMs(inicio) };
      } catch {
        // A causa vai para o log de quem chamou, junto da correlação da
        // requisição. Aqui só interessa o veredito.
        return { ok: false, latenciaMs: decorridoMs(inicio) };
      }
    },

    async encerrar(): Promise<void> {
      await prisma.$disconnect();
    },
  };
}

function decorridoMs(inicio: number): number {
  return Math.round(performance.now() - inicio);
}

/**
 * Desiste da promessa após o prazo.
 *
 * O temporizador é sempre limpo — deixá-lo pendente manteria o processo vivo
 * depois do `close()`, e o serviço do Windows demoraria a parar sem motivo
 * aparente.
 */
async function comTempoLimite<T>(promessa: PromiseLike<T>, prazoMs: number): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_resolver, rejeitar) => {
        temporizador = setTimeout(() => {
          rejeitar(new Error(`Tempo limite de ${String(prazoMs)} ms esgotado.`));
        }, prazoMs);
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}
