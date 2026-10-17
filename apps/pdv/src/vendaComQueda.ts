import type { VendaNoAgente } from "@erp/agente-contrato";

import type { ApiDoBalcao } from "./api/servidor.js";
import type {
  CredencialSupervisor,
  ItemNoFio,
  PagamentoNoFio,
  QuantidadeNoFio,
  VendaNoFio,
} from "./api/tipos.js";
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
 * ### Uma vez offline, offline até o fim da venda
 *
 * Metade dos itens no servidor e metade na fila produziria duas vendas
 * parciais, nenhuma cobrável. Assim que um item cai para o caminho local, a
 * venda inteira segue por ele.
 *
 * ### O que a fila faz e o que não faz
 *
 * Bipar, receber, concluir e desistir. Desconto, cliente, guardar e
 * devolução dependem do servidor — a tela desliga esses botões e diz por quê,
 * em vez de deixar o operador descobrir na hora de apertar.
 */

export type Origem = "SERVIDOR" | "FILA";

export class VendaIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "VendaIndisponivel";
  }
}

const SEM_CONEXAO =
  "Sem conexão com o servidor da loja. Verifique a rede e tente de novo.";

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
  readonly api: ApiDoBalcao;
  readonly estacaoId: string;
  readonly operadorId: string;
}

export interface Leitura {
  readonly codigo: string;
  /** Peso digitado, com unidade. */
  readonly quantidade?: QuantidadeNoFio | undefined;
  /** O "3 ×": milésimos na unidade do produto. */
  readonly multiplicador?: string | undefined;
  readonly supervisor?: CredencialSupervisor | undefined;
}

export interface Bipado {
  readonly venda: VendaNoFio;
  readonly origem: Origem;
  /** O item que a leitura criou ou engordou. Ausente na fila. */
  readonly item?: ItemNoFio | undefined;
  readonly somado: boolean;
}

/**
 * Bipa um item, caindo para a fila se o servidor não responder.
 *
 * Quem chama guarda a origem devolvida e usa a mesma daí em diante.
 *
 * `aoAbrir` avisa da venda assim que o servidor a cria — **antes** do item. Se
 * o item for recusado (código errado, sem estoque), a venda aberta continua
 * sendo a da tela, e a próxima bipada entra nela em vez de abrir outra: sem
 * isso, cada código digitado errado deixaria uma venda vazia esquecida no
 * caixa.
 */
export async function biparItem(
  contexto: ContextoVenda,
  origem: Origem,
  vendaAberta: VendaNoFio | undefined,
  leitura: Leitura,
  aoAbrir?: (venda: VendaNoFio) => void,
): Promise<Bipado> {
  if (origem === "FILA") {
    return {
      venda: await biparNaFila(contexto, vendaAberta, leitura),
      origem,
      somado: false,
    };
  }

  try {
    let aberta = vendaAberta;

    if (aberta === undefined) {
      aberta = await contexto.api.iniciarVenda(contexto.estacaoId);
      aoAbrir?.(aberta);
    }

    const resposta = await contexto.api.adicionarItem(aberta.id, {
      codigo: leitura.codigo,
      quantidade:
        leitura.quantidade ??
        (leitura.multiplicador === undefined
          ? undefined
          : { milesimos: leitura.multiplicador }),
      supervisor: leitura.supervisor,
    });

    return {
      venda: resposta.venda,
      origem: "SERVIDOR",
      item: resposta.item,
      somado: resposta.somado,
    };
  } catch (causa) {
    if (!ehQuedaDeServidor(causa)) throw causa;

    // O servidor sumiu. Se já havia itens registrados nele, eles ficaram lá —
    // e a venda local recomeça do zero, com os itens rebipados. Tentar migrar a
    // venda parcial exigiria que a estação conhecesse o estado do servidor
    // justamente quando não consegue falar com ele.
    return {
      venda: await biparNaFila(contexto, undefined, leitura),
      origem: "FILA",
      somado: false,
    };
  }
}

/** Quantas vezes bipar na fila, que só sabe receber um código de cada vez. */
function vezesNaFila(leitura: Leitura): number {
  if (leitura.quantidade !== undefined) {
    throw new VendaIndisponivel(
      "Sem conexão com o servidor, o peso digitado não entra. Use a etiqueta da balança.",
    );
  }

  if (leitura.multiplicador === undefined) return 1;

  const milesimos = BigInt(leitura.multiplicador);

  if (milesimos % 1000n !== 0n || milesimos > 99_000n) {
    throw new VendaIndisponivel(
      "Sem conexão com o servidor, a quantidade precisa ser inteira e até 99. Bipe item a item.",
    );
  }

  return Number(milesimos / 1000n);
}

async function biparNaFila(
  contexto: ContextoVenda,
  vendaAberta: VendaNoFio | undefined,
  leitura: Leitura,
): Promise<VendaNoFio> {
  const vezes = vezesNaFila(leitura);
  const ponte = await agente();

  // Navegador, sem processo principal: não há fila. É o único caso em que a
  // venda realmente para, e ele não existe na estação instalada.
  if (ponte === undefined) throw new VendaIndisponivel(SEM_CONEXAO);

  if (vendaAberta === undefined) {
    await ponte.iniciarVenda({
      estacaoId: contexto.estacaoId,
      operadorId: contexto.operadorId,
    });
  }

  let resultado = await ponte.adicionarItem(leitura.codigo);
  for (let vez = 1; vez < vezes && resultado.tipo === "OK"; vez += 1) {
    resultado = await ponte.adicionarItem(leitura.codigo);
  }

  if (resultado.tipo === "ERRO") throw new VendaIndisponivel(resultado.mensagem);

  return daFila(resultado.venda, vendaAberta?.pagamentos ?? []);
}

export interface Pagando {
  readonly forma: string;
  /** Rótulo para a lista da tela e o comprovante. */
  readonly descricao: string;
  readonly valor: string;
  readonly chave: string;
  readonly parcelas?: number | undefined;
  readonly autorizacao?: string | undefined;
  readonly confirmacao?: "MANUAL" | "SIMULADA" | undefined;
  readonly supervisor?: CredencialSupervisor | undefined;
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
  venda: VendaNoFio,
  pagamento: Pagando,
): Promise<VendaNoFio> {
  if (origem === "SERVIDOR") {
    const resposta = await contexto.api.registrarPagamento(venda.id, {
      forma: pagamento.forma,
      valor: pagamento.valor,
      parcelas: pagamento.parcelas,
      autorizacao: pagamento.autorizacao,
      confirmacao: pagamento.confirmacao,
      chave: pagamento.chave,
      supervisor: pagamento.supervisor,
    });

    return resposta.venda;
  }

  const ponte = await agente();
  if (ponte === undefined) throw new VendaIndisponivel(SEM_CONEXAO);

  const resultado = await ponte.registrarPagamento(pagamento.forma, pagamento.valor);
  if (resultado.tipo === "ERRO") throw new VendaIndisponivel(resultado.mensagem);

  const pagamentos: PagamentoNoFio[] = [
    ...venda.pagamentos,
    {
      indice: venda.pagamentos.length,
      forma: pagamento.forma,
      descricao: pagamento.descricao,
      valor: pagamento.valor,
      parcelas: pagamento.parcelas ?? 1,
      autorizacao: pagamento.autorizacao,
      confirmacao: "MANUAL",
    },
  ];

  return {
    ...venda,
    faltaPagar: resultado.faltaPagar,
    ...pagosETroco(venda.total, pagamentos),
  };
}

/**
 * Fecha a venda. Na fila, retorna só depois de o disco ter confirmado.
 *
 * Devolve a venda como ficou; o troco vem nela.
 */
export async function finalizar(
  contexto: ContextoVenda,
  origem: Origem,
  venda: VendaNoFio,
  crediario?: { readonly parcelas: number },
): Promise<VendaNoFio> {
  if (origem === "SERVIDOR") return contexto.api.finalizar(venda.id, crediario);

  const ponte = await agente();
  if (ponte === undefined) throw new VendaIndisponivel(SEM_CONEXAO);

  const resultado = await ponte.finalizar();
  if (resultado.tipo === "ERRO") throw new VendaIndisponivel(resultado.mensagem);

  return { ...venda, status: "FINALIZADA", faltaPagar: "0", troco: resultado.troco };
}

/** Desiste da venda na fila — nada foi gravado, nada sobra. */
export async function descartarNaFila(): Promise<void> {
  const ponte = await agente();
  await ponte?.cancelar();
}

/**
 * A venda da fila no formato da tela.
 *
 * Sem número — numerar é do servidor, e duas estações isoladas escolhendo
 * sozinhas produziriam duas vendas 47 no mesmo dia — e sem desconto, que a
 * fila não aplica.
 */
function daFila(venda: VendaNoAgente, pagamentos: readonly PagamentoNoFio[]): VendaNoFio {
  return {
    id: venda.id,
    numero: 0,
    status: "ABERTA",
    estacaoId: "",
    operadorId: "",
    abertaEm: new Date().toISOString(),
    subtotal: venda.total,
    descontoItens: "0",
    descontoVenda: "0",
    descontoTotal: "0",
    total: venda.total,
    faltaPagar: venda.faltaPagar,
    ...pagosETroco(venda.total, pagamentos),
    itens: venda.itens.map((item) => ({
      numero: item.numero,
      produtoId: "",
      descricao: item.descricao,
      quantidade: item.quantidade,
      precoUnitario: item.precoUnitario,
      totalBruto: item.total,
      desconto: "0",
      descontoRateado: "0",
      total: item.total,
    })),
    pagamentos,
  };
}

/** Só para exibir a venda offline: o troco que vale é o que a fila devolve ao concluir. */
function pagosETroco(
  total: string,
  pagamentos: readonly PagamentoNoFio[],
): {
  readonly totalPago: string;
  readonly troco: string;
  readonly pagamentos: readonly PagamentoNoFio[];
} {
  const pago = pagamentos.reduce((soma, pagamento) => soma + BigInt(pagamento.valor), 0n);
  const sobra = pago - BigInt(total);

  return {
    totalPago: pago.toString(),
    troco: (sobra > 0n ? sobra : 0n).toString(),
    pagamentos,
  };
}
