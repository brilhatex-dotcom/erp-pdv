/**
 * Encerramento gracioso.
 *
 * O que está em jogo é concreto: o serviço é parado a cada atualização
 * (§13.5), e uma venda em curso interrompida no meio da transação é o pior
 * momento possível. A ordem abaixo é o que evita isso.
 *
 * 1. **Parar de aceitar** requisições novas e esperar as em curso terminarem.
 * 2. **Só então** devolver as conexões do banco.
 *
 * Inverter a ordem — fechar o banco primeiro — faria a requisição em curso
 * falhar com erro técnico, que é justamente o cenário a evitar. E não ter prazo
 * máximo faria uma conexão pendurada impedir a parada do serviço para sempre; o
 * atualizador desistiria e o cliente ficaria sem o servidor.
 */

export interface Registrador {
  info(objeto: Record<string, unknown>, mensagem: string): void;
  error(objeto: Record<string, unknown>, mensagem: string): void;
}

export interface OpcoesEncerramento {
  /** O servidor HTTP. Fechado primeiro. */
  readonly servidor: { close(): Promise<void> };
  /** As conexões. Fechadas depois. */
  readonly recursos: { encerrar(): Promise<void> };
  readonly tempoLimiteMs: number;
  readonly registrador: Registrador;
}

/**
 * Devolve a função de encerramento, garantidamente executada **uma vez**.
 *
 * Um `Ctrl+C` impaciente manda dois `SIGINT`; sem essa garantia, o segundo
 * fecharia o banco enquanto o primeiro ainda esperava as requisições em curso.
 */
export function criarEncerrador(opcoes: OpcoesEncerramento): () => Promise<void> {
  let emAndamento: Promise<void> | undefined;

  return () => {
    emAndamento ??= encerrar(opcoes);
    return emAndamento;
  };
}

async function encerrar(opcoes: OpcoesEncerramento): Promise<void> {
  opcoes.registrador.info({}, "encerrando o servidor");

  await comPrazo(
    () => opcoes.servidor.close(),
    opcoes.tempoLimiteMs,
    "servidor HTTP",
    opcoes.registrador,
  );

  await comPrazo(
    () => opcoes.recursos.encerrar(),
    opcoes.tempoLimiteMs,
    "conexões do banco",
    opcoes.registrador,
  );

  opcoes.registrador.info({}, "servidor encerrado");
}

/**
 * Executa o passo sem deixar que ele impeça o encerramento.
 *
 * Falha ou demora num passo é registrada e o encerramento continua. A
 * alternativa — propagar o erro — deixaria o processo vivo pela metade: sem
 * atender e sem liberar as conexões, que é o pior dos dois mundos.
 */
async function comPrazo(
  passo: () => Promise<void>,
  prazoMs: number,
  descricao: string,
  registrador: Registrador,
): Promise<void> {
  let temporizador: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      passo(),
      new Promise<never>((_resolver, rejeitar) => {
        temporizador = setTimeout(() => {
          rejeitar(new Error(`prazo de ${String(prazoMs)} ms esgotado`));
        }, prazoMs);
      }),
    ]);
  } catch (causa) {
    registrador.error(
      { passo: descricao, causa: causa instanceof Error ? causa.message : String(causa) },
      "falha ao encerrar; seguindo com os passos restantes",
    );
  } finally {
    clearTimeout(temporizador);
  }
}
