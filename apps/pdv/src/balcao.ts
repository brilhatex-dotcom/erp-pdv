import { ClienteAgente } from "@erp/agente-contrato";

/**
 * O Agente Local, visto de dentro da tela.
 *
 * ### Descoberto uma vez, não a cada chamada
 *
 * A tela pergunta ao Agente se ele existe na primeira vez que precisa dele e
 * guarda a resposta. Perguntar a cada bipada custaria uma ida à rede local por
 * item — e a resposta não muda no meio de um atendimento.
 *
 * ### Ausência de Agente não é erro
 *
 * Em desenvolvimento, em tablet, ou antes de o serviço subir, não há Agente.
 * A tela continua vendendo contra o servidor da loja: o que ela perde é
 * contingência e impressão, não a venda (princípio 1).
 *
 * ### O segredo vem do servidor da loja
 *
 * A PWA não pode carregá-lo embutido — o código do navegador é público. Ele é
 * entregue pelo servidor junto com a sessão, e o Agente confere. Enquanto a
 * rota que o entrega não existir, o valor vem da configuração de build, o que
 * basta para desenvolvimento e para o instalador de demonstração.
 */

const SEGREDO_PROVISORIO =
  (import.meta.env["VITE_SEGREDO_AGENTE"] as string | undefined) ??
  "agente-de-desenvolvimento";

let clienteMemorizado: ClienteAgente | undefined;
let disponibilidade: Promise<boolean> | undefined;

function cliente(): ClienteAgente {
  clienteMemorizado ??= new ClienteAgente({ segredo: SEGREDO_PROVISORIO });

  return clienteMemorizado;
}

/** O Agente desta estação, ou `undefined` quando não há um. */
export async function agente(): Promise<ClienteAgente | undefined> {
  disponibilidade ??= cliente().disponivel();

  return (await disponibilidade) ? cliente() : undefined;
}

/**
 * Substitui o cliente — só para teste.
 *
 * A alternativa seria injetar o cliente em cada tela que o usa, o que espalharia
 * um detalhe de infraestrutura por toda a interface para servir apenas ao teste.
 */
export function definirAgenteParaTeste(substituto: ClienteAgente | undefined): void {
  clienteMemorizado = substituto;
  disponibilidade =
    substituto === undefined ? Promise.resolve(false) : Promise.resolve(true);
}

/** Volta a descobrir o Agente na próxima chamada. */
export function esquecerAgente(): void {
  clienteMemorizado = undefined;
  disponibilidade = undefined;
}
