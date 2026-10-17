import type { DadosCupom } from "@erp/printing";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { Comprovante, VendaNoFio } from "../api/tipos.js";
import { agente } from "../balcao.js";
import { descreverPagamento } from "../formas.js";

/**
 * O comprovante sai pelo Agente Local quando ele existe, e pelo navegador
 * quando não.
 *
 * Os dois partem da **mesma resposta** do servidor (`/comprovante`), que já
 * vem marcada como não fiscal. Formatar duas vezes, uma para cada caminho, é
 * como um dos dois passaria a mostrar um total diferente.
 *
 * Imprimir **nunca** é erro de venda: a venda já está gravada quando isto
 * roda. Qualquer problema volta como aviso para a tela, nunca como exceção.
 *
 * ### A gaveta
 *
 * Abre quando entrou dinheiro — e só uma vez por venda. A loja que imprime sob
 * pedido abre a gaveta sem papel (`abrirGaveta`), e o comprovante pedido
 * depois não a abre de novo; a segunda via nunca abre, porque é papel, não
 * dinheiro.
 */

const COLUNAS = { 58: 32, 80: 48 } as const;

export type ResultadoImpressao =
  | { readonly via: "AGENTE"; readonly aviso?: string | undefined }
  | { readonly via: "NAVEGADOR"; readonly comprovante: Comprovante }
  | { readonly via: "FALHOU"; readonly aviso: string };

export async function imprimirComprovante(
  api: ApiDoBalcao,
  vendaId: string,
  opcoes: { readonly segundaVia: boolean; readonly abrirGaveta: boolean },
): Promise<ResultadoImpressao> {
  let comprovante: Comprovante;

  try {
    comprovante = await api.comprovante(vendaId);
  } catch {
    return {
      via: "FALHOU",
      aviso: "Comprovante não impresso. A venda foi registrada normalmente.",
    };
  }

  const ponte = await agente();

  if (ponte === undefined) return { via: "NAVEGADOR", comprovante };

  const aviso = await ponte.imprimirCupom({
    cupom: paraCupom(comprovante, opcoes.segundaVia),
    houveDinheiro:
      opcoes.abrirGaveta && !opcoes.segundaVia && teveDinheiro(comprovante.venda),
    colunas: COLUNAS[comprovante.larguraCupom],
  });

  return { via: "AGENTE", aviso };
}

/**
 * O comprovante da venda feita sem conexão — montado na própria estação.
 *
 * Sem servidor não há `/comprovante`, e é justamente quando a gaveta mais
 * precisa abrir: a venda em dinheiro acontece do mesmo jeito. O papel sai sem
 * número (quem numera é o servidor, quando a venda chega) e marcado como venda
 * sem conexão.
 */
export async function imprimirSemConexao(
  venda: VendaNoFio,
  dados: {
    readonly loja: string | undefined;
    readonly operador: string;
    readonly larguraCupom: 58 | 80;
    readonly treinamento: boolean;
    readonly abrirGaveta: boolean;
  },
): Promise<ResultadoImpressao> {
  const ponte = await agente();

  if (ponte === undefined) {
    return {
      via: "FALHOU",
      aviso:
        "Sem conexão e sem impressora nesta estação. A venda foi registrada normalmente.",
    };
  }

  const aviso = await ponte.imprimirCupom({
    cupom: {
      loja: { nome: dados.loja ?? "COMPROVANTE DE VENDA" },
      numero: 0,
      emitidoEm: new Date(venda.finalizadaEm ?? Date.now()),
      operador: dados.operador,
      itens: itensDoCupom(venda),
      subtotal: venda.subtotal,
      descontoTotal: venda.descontoTotal,
      total: venda.total,
      pagamentos: pagamentosDoCupom(venda),
      troco: venda.troco,
      avisos: [...(dados.treinamento ? [TREINAMENTO] : []), "VENDA SEM CONEXAO"],
      semValorFiscal: true,
    },
    houveDinheiro: dados.abrirGaveta && teveDinheiro(venda),
    colunas: COLUNAS[dados.larguraCupom],
  });

  return { via: "AGENTE", aviso };
}

/**
 * Abre a gaveta sem imprimir.
 *
 * Para a venda em dinheiro da loja que imprime sob pedido, e para a devolução
 * em dinheiro. Sem Agente não há gaveta para abrir, e isso não é aviso: é o
 * computador sem gaveta.
 */
export async function abrirGaveta(): Promise<string | undefined> {
  const ponte = await agente();

  return ponte?.abrirGaveta();
}

export function teveDinheiro(venda: VendaNoFio): boolean {
  return venda.pagamentos.some((pagamento) => pagamento.forma === "DINHEIRO");
}

const TREINAMENTO = "TREINAMENTO - SEM VALOR";

/** Os avisos que vão no alto do papel. */
export function avisosDoComprovante(
  comprovante: Comprovante,
  segundaVia: boolean,
): readonly string[] {
  return [
    ...(comprovante.treinamento ? [TREINAMENTO] : []),
    ...(comprovante.venda.status === "CANCELADA" ? ["VENDA CANCELADA"] : []),
    ...(segundaVia ? ["SEGUNDA VIA"] : []),
  ];
}

export function paraCupom(comprovante: Comprovante, segundaVia: boolean): DadosCupom {
  const { venda, loja } = comprovante;

  return {
    loja: {
      nome: loja?.nome ?? "COMPROVANTE DE VENDA",
      endereco: loja?.endereco,
      documento: loja?.cnpj,
    },
    numero: venda.numero,
    emitidoEm: new Date(venda.finalizadaEm ?? comprovante.emitidoEm),
    operador: comprovante.operadorNome,
    itens: itensDoCupom(venda),
    subtotal: venda.subtotal,
    descontoTotal: venda.descontoTotal,
    total: venda.total,
    pagamentos: pagamentosDoCupom(venda),
    troco: venda.troco,
    cliente: comprovante.clienteNome,
    avisos: avisosDoComprovante(comprovante, segundaVia),
    semValorFiscal: true,
  };
}

function itensDoCupom(venda: VendaNoFio): DadosCupom["itens"] {
  return venda.itens.map((item) => ({
    numero: item.numero,
    descricao: item.descricao,
    quantidade: item.quantidade.milesimos,
    unidade: item.quantidade.unidade.toLowerCase(),
    precoUnitario: item.precoUnitario,
    total: item.total,
  }));
}

function pagamentosDoCupom(venda: VendaNoFio): DadosCupom["pagamentos"] {
  return venda.pagamentos.map((pagamento) => ({
    descricao: descreverPagamento(pagamento.forma, pagamento.confirmacao),
    valor: pagamento.valor,
  }));
}
