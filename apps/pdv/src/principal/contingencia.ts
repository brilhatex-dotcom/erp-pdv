import { LAYOUT_BALANCA_PADRAO } from "@erp/domain";

import { FilaDeVendas } from "./armazenamento-local/filaDeVendas.js";
import {
  type CatalogoEmDisco,
  ReplicaCatalogo,
} from "./armazenamento-local/replicaCatalogo.js";
import type { Contingencia } from "./ponte-ipc.js";
import {
  type EnvioDeVendas,
  type EstadoConexao,
  type ResumoSincronizacao,
  Sincronizador,
} from "./sincronizacao/sincronizador.js";
import { VendaLocal } from "./venda-local/vendaLocal.js";

/**
 * Monta a contingência e a mantém viva.
 *
 * Até aqui, fila, réplica e sincronizador eram três bibliotecas testadas e
 * ligadas a nada: nenhuma delas era instanciada em lugar nenhum do produto.
 * Este arquivo é o que as transforma em comportamento.
 *
 * ### O relógio não é agressivo
 *
 * A tentativa periódica usa o recuo que o próprio `Sincronizador` calcula — de
 * um segundo até um minuto. Um intervalo fixo curto gastaria a rede da loja
 * para colher o mesmo erro, e é a mesma rede pela qual o outro caixa está
 * tentando vender.
 *
 * ### O catálogo é baixado, nunca exigido
 *
 * Falha ao baixar não impede o caixa de abrir: sem réplica o PDV volta a
 * depender do servidor — degradado, mas de pé (princípio 1). Recusar-se a abrir
 * por causa de um catálogo velho deixaria a loja sem caixa justamente no dia em
 * que a rede está ruim.
 */

const NOME_FILA = "vendas-pendentes.jsonl";
const NOME_CATALOGO = "catalogo.json";

export interface OpcoesContingencia {
  /** Pasta de dados da estação — `app.getPath("userData")` no Electron. */
  readonly pasta: string;
  readonly api: string;
  /** Injetado para o teste não depender de rede nem de `globalThis.fetch`. */
  readonly buscar?: typeof fetch;
  readonly novoId?: () => string;
  readonly registrar?: (mensagem: string) => void;
}

export interface ContingenciaViva extends Contingencia {
  /** Baixa o catálogo do servidor e regrava a réplica. */
  atualizarCatalogo(): Promise<boolean>;
  /** Liga o relógio de sincronização. Devolve como desligá-lo. */
  iniciarRelogio(): () => void;
  readonly fila: FilaDeVendas;
  readonly replica: ReplicaCatalogo;
}

export function montarContingencia(opcoes: OpcoesContingencia): ContingenciaViva {
  const registrar = opcoes.registrar ?? ((): void => undefined);
  const buscar = opcoes.buscar ?? globalThis.fetch.bind(globalThis);
  const novoId = opcoes.novoId ?? ((): string => globalThis.crypto.randomUUID());

  const fila = new FilaDeVendas(caminho(opcoes.pasta, NOME_FILA));
  const replica = new ReplicaCatalogo();

  replica.carregarDe(caminho(opcoes.pasta, NOME_CATALOGO));

  const vendaLocal = new VendaLocal({
    replica,
    fila,
    layoutBalanca: LAYOUT_BALANCA_PADRAO,
    novoId,
  });

  const sincronizador = new Sincronizador({
    fila,
    envio: envioHttp(opcoes.api, buscar),
    registrar,
  });

  return {
    fila,
    replica,

    estado: (): EstadoConexao => sincronizador.estado(),
    iniciar: (estacaoId, operadorId) => vendaLocal.iniciar(estacaoId, operadorId),
    adicionarItem: (codigo) => vendaLocal.adicionarItem(codigo),
    registrarPagamento: (forma, valor) => vendaLocal.registrarPagamento(forma, valor),
    finalizar: () => vendaLocal.finalizar(),
    cancelar: () => {
      vendaLocal.cancelar();
    },
    sincronizar: async (): Promise<ResumoSincronizacao> => sincronizador.sincronizar(),

    atualizarCatalogo: async (): Promise<boolean> => {
      try {
        const resposta = await buscar(`${opcoes.api}/api/catalogo/replica`);

        if (!resposta.ok) {
          registrar(
            `Catálogo não atualizado: servidor respondeu ${String(resposta.status)}.`,
          );
          return false;
        }

        const catalogo = (await resposta.json()) as CatalogoEmDisco;

        if (!Array.isArray(catalogo.produtos)) {
          registrar("Catálogo não atualizado: resposta em formato inesperado.");
          return false;
        }

        replica.gravarEm(caminho(opcoes.pasta, NOME_CATALOGO), catalogo);
        return true;
      } catch (causa) {
        // Rede fora é o caso normal desta função, não uma excepcionalidade.
        registrar(`Catálogo não atualizado: ${String(causa)}`);
        return false;
      }
    },

    iniciarRelogio: (): (() => void) => {
      let cancelado = false;
      // Lido por função, e não direto: a variável só é invertida pela função
      // devolvida lá embaixo, e o compilador — que a analisa antes de existir —
      // trataria a segunda verificação como morta. Ela não é: o cancelamento
      // acontece justamente enquanto o `await` está pendente.
      const foiCancelado = (): boolean => cancelado;
      let agendamento: ReturnType<typeof setTimeout> | undefined;

      const rodar = async (): Promise<void> => {
        if (foiCancelado()) return;

        try {
          await sincronizador.sincronizar();
        } catch (causa) {
          registrar(`Sincronização falhou: ${String(causa)}`);
        }

        if (foiCancelado()) return;

        agendamento = setTimeout(() => void rodar(), sincronizador.proximaTentativaEmMs);
        // `unref` para o relógio não segurar o processo aberto no fechamento:
        // sem isto o PDV levaria até um minuto para encerrar, e o operador
        // clicaria no X uma segunda vez.
        agendamento.unref();
      };

      void rodar();

      return (): void => {
        cancelado = true;
        if (agendamento !== undefined) clearTimeout(agendamento);
      };
    },
  };
}

/**
 * Envia uma venda da fila ao servidor.
 *
 * A distinção entre `RECUSADA` e `INDISPONIVEL` é o que decide se a venda sai
 * da fila ou espera: recusa por regra de negócio não melhora com o tempo, e
 * mantê-la faria a estação tentar para sempre. Rede e 5xx, ao contrário,
 * melhoram sozinhos.
 */
function envioHttp(api: string, buscar: typeof fetch): EnvioDeVendas {
  return {
    enviar: async (venda) => {
      let resposta: Response;

      try {
        resposta = await buscar(`${api}/api/sincronizacao/vendas`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chave: venda.id,
            estacaoId: venda.estacaoId,
            registradaEm: venda.registradaEm,
            itens: venda.itens,
            pagamentos: venda.pagamentos,
          }),
        });
      } catch (causa) {
        return { tipo: "INDISPONIVEL", motivo: String(causa) };
      }

      if (resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as {
          readonly jaExistia?: boolean;
        };

        return corpo.jaExistia === true ? { tipo: "JA_EXISTIA" } : { tipo: "ACEITA" };
      }

      // 5xx é o servidor tropeçando; 4xx é ele dizendo que a venda está errada.
      // Reenviar a segunda categoria é insistir no que nunca vai passar.
      return resposta.status >= 500
        ? {
            tipo: "INDISPONIVEL",
            motivo: `servidor respondeu ${String(resposta.status)}`,
          }
        : { tipo: "RECUSADA", motivo: `servidor respondeu ${String(resposta.status)}` };
    },
  };
}

function caminho(pasta: string, nome: string): string {
  // Concatenação simples em vez de `node:path`: a pasta vem do Electron, não do
  // usuário, e o separador de barra funciona nos três sistemas.
  return `${pasta.replace(/[/\\]$/, "")}/${nome}`;
}
