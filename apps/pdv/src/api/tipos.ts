/**
 * O que a API do balcão devolve, como chega no fio.
 *
 * Dinheiro e quantidade são **texto de inteiros** (centavos e milésimos): é
 * assim que o servidor manda, e a tela só os formata. Nenhuma conta de
 * negócio é refeita aqui — total, desconto rateado e troco vêm prontos.
 */

export interface QuantidadeNoFio {
  readonly milesimos: string;
  readonly unidade: string;
}

export interface ItemNoFio {
  readonly numero: number;
  readonly produtoId: string;
  readonly descricao: string;
  readonly quantidade: QuantidadeNoFio;
  readonly precoUnitario: string;
  readonly totalBruto: string;
  readonly desconto: string;
  readonly descontoRateado: string;
  readonly total: string;
}

export type ConfirmacaoNoFio = "MANUAL" | "INTEGRACAO" | "SIMULADA";

export interface PagamentoNoFio {
  readonly indice: number;
  readonly forma: string;
  readonly descricao: string;
  readonly valor: string;
  readonly parcelas: number;
  readonly autorizacao?: string | undefined;
  readonly confirmacao: ConfirmacaoNoFio;
}

export interface VendaNoFio {
  readonly id: string;
  readonly numero: number;
  readonly status: "ABERTA" | "FINALIZADA" | "CANCELADA";
  readonly estacaoId: string;
  readonly operadorId: string;
  readonly clienteId?: string | undefined;
  readonly abertaEm: string;
  readonly finalizadaEm?: string | undefined;
  readonly subtotal: string;
  readonly descontoItens: string;
  readonly descontoVenda: string;
  readonly descontoTotal: string;
  readonly total: string;
  readonly totalPago: string;
  readonly faltaPagar: string;
  readonly troco: string;
  readonly suspensao?:
    { readonly em: string; readonly rotulo?: string | undefined } | undefined;
  readonly cancelamento?: { readonly em: string; readonly motivo: string } | undefined;
  readonly itens: readonly ItemNoFio[];
  readonly pagamentos: readonly PagamentoNoFio[];
}

export interface RespostaItem {
  readonly item: ItemNoFio;
  readonly somado: boolean;
  readonly venda: VendaNoFio;
}

export interface RespostaPagamento {
  readonly pagamento: PagamentoNoFio;
  readonly faltaPagar: string;
  readonly troco: string;
  readonly venda: VendaNoFio;
}

export interface RespostaCancelamento {
  readonly venda: VendaNoFio;
  readonly estornada: boolean;
  readonly estornos: readonly { readonly forma: string; readonly valor: string }[];
}

export type Recurso = "VENDA_POR_PESO" | "FIADO" | "BOTOES_RAPIDOS";

export interface ConfiguracaoNoFio {
  readonly segmento: "PADARIA" | "MERCADINHO" | "FRUTARIA" | "MISTO";
  readonly recursos: readonly Recurso[];
  readonly vendaSemEstoque: "PERMITIR" | "AUTORIZAR" | "BLOQUEAR";
  readonly larguraCupom: 58 | 80;
  readonly impressaoComprovante: "SEMPRE" | "SOB_PEDIDO";
  readonly logoId?: string | undefined;
  readonly gravada: boolean;
}

export interface IntegracaoNoFio {
  readonly codigo: string;
  readonly nome: string;
  readonly situacao: "DISPONIVEL" | "EM_CONFIGURACAO" | "NAO_IMPLEMENTADA";
  readonly explicacao: string;
}

export interface ContextoDoPdv {
  readonly modo: "REAL" | "TREINAMENTO";
  readonly operador: {
    readonly id: string;
    readonly nome: string;
    readonly matricula: string;
    readonly papel: string;
    readonly permissoes: readonly string[];
    readonly limites: {
      readonly descontoMaximoItemBps?: number | undefined;
      readonly descontoMaximoVendaBps?: number | undefined;
    };
  };
  readonly loja?:
    | {
        readonly nome: string;
        readonly endereco: string;
        readonly telefone?: string | undefined;
      }
    | undefined;
  readonly configuracao: ConfiguracaoNoFio;
  readonly integracoes: readonly IntegracaoNoFio[];
}

export interface ProdutoDoBalcao {
  readonly id: string;
  readonly sku: string;
  readonly descricao: string;
  readonly descricaoCompleta: string;
  readonly tipo: "UNITARIO" | "PESAVEL";
  readonly unidade: string;
  readonly precoVenda: string;
  readonly codigoBarras?: string | undefined;
  readonly categoriaId?: string | undefined;
  readonly imagemId?: string | undefined;
  readonly botaoRapido: boolean;
  readonly saldo?: string | undefined;
}

export interface CategoriaDoBalcao {
  readonly id: string;
  readonly nome: string;
  readonly icone?: string | undefined;
  readonly imagemId?: string | undefined;
}

export interface Atalhos {
  readonly categorias: readonly CategoriaDoBalcao[];
  readonly botoes: readonly ProdutoDoBalcao[];
}

export interface ClienteDoBalcao {
  readonly id: string;
  readonly nome: string;
  readonly documento?: string | undefined;
  readonly vendeAPrazo: boolean;
  readonly limiteCredito: string;
  readonly emAberto: string;
  readonly disponivel: string;
}

/** O produto que o servidor devolve junto com `PRODUTO_EXIGE_PESO`. */
export interface ProdutoQuePedePeso {
  readonly id: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly precoVenda: string;
  readonly unidade: string;
}

export interface Comprovante {
  readonly aviso: string;
  readonly treinamento: boolean;
  readonly larguraCupom: 58 | 80;
  readonly logoId?: string | undefined;
  readonly loja?:
    | {
        readonly nome: string;
        readonly razaoSocial: string;
        readonly cnpj: string;
        readonly endereco: string;
        readonly telefone?: string | undefined;
      }
    | undefined;
  readonly operadorNome: string;
  readonly clienteNome?: string | undefined;
  readonly emitidoEm: string;
  readonly venda: VendaNoFio;
}

export interface VendaRecente extends VendaNoFio {
  readonly operadorNome: string;
  readonly clienteNome?: string | undefined;
}

export interface DevolucoesDaVenda {
  readonly venda: VendaNoFio;
  readonly devolucoes: readonly {
    readonly id: string;
    readonly formaReembolso: string;
    readonly motivo: string;
    readonly ocorridaEm: string;
    readonly valorTotal: string;
  }[];
  readonly restante: readonly {
    readonly numeroItem: number;
    readonly milesimos: string;
    readonly unidade: string;
  }[];
}

export interface CaixaAberto {
  readonly id: string;
  readonly estacaoId: string;
  readonly fundoTroco: string;
  readonly totalVendido: string;
  readonly quantidadeVendas: number;
  readonly abertaEm: string;
}

export interface Conferencia {
  readonly fundoTroco: string;
  readonly recebidoEmDinheiro: string;
  readonly trocoDevolvido: string;
  readonly suprimentos: string;
  readonly sangrias: string;
  readonly esperadoEmDinheiro: string;
  readonly contadoEmDinheiro: string;
  readonly divergenciaEmDinheiro: string;
  readonly totalVendido: string;
  readonly totalAReceber: string;
  readonly quantidadeVendas: number;
  readonly descontos: string;
  readonly cancelamentos: { readonly quantidade: number; readonly total: string };
  readonly devolucoes: { readonly quantidade: number; readonly total: string };
  readonly devolvidoEmDinheiro: string;
  readonly porForma: readonly {
    readonly forma: string;
    readonly esperado: string;
    readonly contado?: string | undefined;
    readonly divergencia?: string | undefined;
  }[];
}

/** Matrícula e PIN de quem libera, digitados no próprio caixa. */
export interface CredencialSupervisor {
  readonly matricula: string;
  readonly pin: string;
}
