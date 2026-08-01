import type { ClienteApi } from "@erp/cliente-api";

import type { VendaNoAgente } from "@erp/agente-contrato";

import { agente } from "./balcao.js";

/**
 * A venda que sobrevive à queda do servidor.
 *
 * ### O que conta como queda
 *
 * **Só falha de transporte.** `fetch` que rejeita, tempo esgotado, 502, 503,
 * 504. Um 400 é o servidor dizendo que a venda está errada, e um 401 é sessão
 * expirada: cair para a fila nesses casos gravaria localmente uma venda que o
 * servidor vai recusar na importação — e o operador só descobriria no dia
 * seguinte, com o cliente longe.
 *
 * Distinguir as duas coisas é a decisão inteira deste arquivo. Errar para o
 * lado permissivo enche a fila de lixo; errar para o lado restritivo para a
 * venda quando ela poderia continuar.
 *
 * ### Uma vez offline, offline até o fim da venda
 *
 * Metade dos itens no servidor e metade na fila produziria duas vendas parciais,
 * nenhuma das duas cobrável. Assim que um item cai para o caminho local, a
 * venda inteira segue por ele.
 */

export type Origem = "SERVIDOR" | "FILA";

/** O que a tela mostra, venha de onde vier. */
export interface VendaVisivel {
  readonly id: string;
  readonly numero?: number | undefined;
  readonly total: string;
  readonly faltaPagar: string;
  readonly itens: readonly {
    readonly numero: number;
    readonly descricao: string;
    readonly quantidade: { readonly milesimos: string; readonly unidade: string };
    readonly precoUnitario: string;
    readonly total: string;
  }[];
}

export class VendaIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "VendaIndisponivel";
  }
}

/**
 * Verdadeiro quando a falha é de transporte, e não do servidor recusando.
 *
 * `TypeError` é o que `fetch` lança quando não conseguiu falar com ninguém —
 * cabo solto, servidor desligado, DNS. Os 5xx aqui são os que significam
 * "tente de novo": 500 é defeito de programação no servidor, e reenviar não
 * resolve nem melhora.
 */
export function ehQuedaDeServidor(causa: unknown): boolean {
  if (causa instanceof TypeError) return true;

  const status = (causa as { readonly status?: unknown }).status;

  return status === 502 || status === 503 || status === 504;
}

export interface ContextoVenda {
  readonly cliente: ClienteApi;
  readonly estacaoId: string;
  readonly operadorId: string;
}

/**
 * Bipa um item, caindo para a fila se o servidor não responder.
 *
 * Devolve a venda e por onde ela seguiu. Quem chama guarda a origem e usa a
 * mesma daí em diante.
 */
export async function biparItem(
  contexto: ContextoVenda,
  origem: Origem,
  vendaAberta: VendaVisivel | undefined,
  codigo: string,
): Promise<{ readonly venda: VendaVisivel; readonly origem: Origem }> {
  if (origem === "FILA") {
    return { venda: await biparNaFila(contexto, vendaAberta, codigo), origem: "FILA" };
  }

  try {
    const aberta =
      vendaAberta ??
      (await contexto.cliente.requisitar<VendaVisivel>("/api/vendas", {
        metodo: "POST",
        corpo: { estacaoId: contexto.estacaoId },
      }));

    const atualizada = await contexto.cliente.requisitar<{ venda: VendaVisivel }>(
      `/api/vendas/${aberta.id}/itens`,
      { metodo: "POST", corpo: { codigo } },
    );

    return { venda: atualizada.venda, origem: "SERVIDOR" };
  } catch (causa) {
    if (!ehQuedaDeServidor(causa)) throw causa;

    // O servidor sumiu. Se já havia itens registrados nele, eles ficaram lá —
    // e a venda local recomeça do zero, com os itens rebipados. Tentar migrar a
    // venda parcial exigiria que a estação conhecesse o estado do servidor
    // justamente quando não consegue falar com ele.
    return { venda: await biparNaFila(contexto, undefined, codigo), origem: "FILA" };
  }
}

async function biparNaFila(
  contexto: ContextoVenda,
  vendaAberta: VendaVisivel | undefined,
  codigo: string,
): Promise<VendaVisivel> {
  const ponte = await agente();

  if (ponte === undefined) {
    // Navegador, sem processo principal: não há fila. É o único caso em que a
    // venda realmente para, e ele não existe na estação instalada — onde a
    // ponte sempre existe. A frase é a mesma que `mensagemDe` usa para rede
    // caída: para o operador, é a mesma situação.
    throw new VendaIndisponivel(
      "Sem conexão com o servidor da loja. Verifique a rede e tente de novo.",
    );
  }

  if (vendaAberta === undefined) {
    // Não há verificação de retorno: o cliente do Agente já lança
    // `AgenteIndisponivel` quando a chamada falha, e conferir de novo aqui
    // seria um ramo que nenhum teste consegue alcançar.
    await ponte.iniciarVenda({
      estacaoId: contexto.estacaoId,
      operadorId: contexto.operadorId,
    });
  }

  const resultado = await ponte.adicionarItem(codigo);

  if (resultado.tipo === "ERRO") throw new VendaIndisponivel(resultado.mensagem);

  return comoVisivel(resultado.venda);
}

/**
 * Registra um pagamento.
 *
 * Não cai para a fila: se a venda começou no servidor, o pagamento vai para o
 * servidor. Uma venda cujos itens estão lá e cujo pagamento ficou aqui não
 * fecharia em lugar nenhum.
 */
export async function pagar(
  contexto: ContextoVenda,
  origem: Origem,
  vendaId: string,
  forma: string,
  valor: string,
): Promise<{ readonly faltaPagar: string }> {
  if (origem === "SERVIDOR") {
    return contexto.cliente.requisitar<{ faltaPagar: string }>(
      `/api/vendas/${vendaId}/pagamentos`,
      { metodo: "POST", corpo: { forma, valor } },
    );
  }

  const ponte = await agente();

  if (ponte === undefined) throw new VendaIndisponivel("Contingência indisponível.");

  const resultado = await ponte.registrarPagamento(forma, valor);

  if (resultado.tipo === "ERRO") throw new VendaIndisponivel(resultado.mensagem);

  return { faltaPagar: resultado.faltaPagar };
}

/** Fecha a venda. Na fila, retorna só depois de o disco ter confirmado. */
export async function finalizar(
  contexto: ContextoVenda,
  origem: Origem,
  vendaId: string,
): Promise<{ readonly troco: string }> {
  if (origem === "SERVIDOR") {
    return contexto.cliente.requisitar<{ troco: string }>(
      `/api/vendas/${vendaId}/finalizar`,
      { metodo: "POST", corpo: {} },
    );
  }

  const ponte = await agente();

  if (ponte === undefined) throw new VendaIndisponivel("Contingência indisponível.");

  const resultado = await ponte.finalizar();

  if (resultado.tipo === "ERRO") throw new VendaIndisponivel(resultado.mensagem);

  return { troco: resultado.troco };
}

function comoVisivel(venda: VendaNoAgente): VendaVisivel {
  return {
    id: venda.id,
    numero: undefined,
    total: venda.total,
    faltaPagar: venda.faltaPagar,
    itens: venda.itens,
  };
}
