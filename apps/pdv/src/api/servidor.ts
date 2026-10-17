import type { ClienteApi } from "@erp/cliente-api";

import type {
  Atalhos,
  CaixaAberto,
  ClienteDoBalcao,
  Comprovante,
  Conferencia,
  ContextoDoPdv,
  CredencialSupervisor,
  DevolucoesDaVenda,
  ProdutoDoBalcao,
  QuantidadeNoFio,
  RespostaCancelamento,
  RespostaItem,
  RespostaPagamento,
  VendaNoFio,
  VendaRecente,
} from "./tipos.js";

/**
 * As chamadas do balcão ao servidor da loja, uma por operação.
 *
 * Finas de propósito: montam o caminho e o corpo e devolvem o que veio. Erro
 * chega como `ErroDaApi`, já com a mensagem escrita para o operador — e com o
 * código que diz à tela quando abrir o modal do supervisor.
 *
 * Não sabem em qual banco estão: no modo treinamento (ADR-0026), quem leva as
 * chamadas para `/treino` é o cliente da API, montado para o modo inteiro.
 */
export class ApiDoBalcao {
  constructor(private readonly cliente: ClienteApi) {}

  #get<T>(caminho: string): Promise<T> {
    return this.cliente.requisitar<T>(caminho);
  }

  #enviar<T>(
    caminho: string,
    corpo: unknown,
    metodo: "POST" | "PUT" = "POST",
  ): Promise<T> {
    return this.cliente.requisitar<T>(caminho, { metodo, corpo });
  }

  // ── Contexto ──────────────────────────────────────────────────────────

  contexto(): Promise<ContextoDoPdv> {
    return this.#get("/api/pdv/contexto");
  }

  atalhos(): Promise<Atalhos> {
    return this.#get("/api/pdv/atalhos");
  }

  async buscarProdutos(filtro: {
    readonly termo?: string;
    readonly categoriaId?: string;
  }): Promise<readonly ProdutoDoBalcao[]> {
    const parametros = new URLSearchParams();
    if (filtro.termo !== undefined) parametros.set("termo", filtro.termo);
    if (filtro.categoriaId !== undefined)
      parametros.set("categoriaId", filtro.categoriaId);

    const resposta = await this.#get<{ produtos: readonly ProdutoDoBalcao[] }>(
      `/api/pdv/produtos?${parametros.toString()}`,
    );

    return resposta.produtos;
  }

  async buscarClientes(termo: string): Promise<readonly ClienteDoBalcao[]> {
    const resposta = await this.#get<{ clientes: readonly ClienteDoBalcao[] }>(
      `/api/pdv/clientes?termo=${encodeURIComponent(termo)}`,
    );

    return resposta.clientes;
  }

  // ── Caixa ─────────────────────────────────────────────────────────────

  /** `undefined` quando a estação ainda não abriu o caixa (204). */
  caixaAberto(estacaoId: string): Promise<CaixaAberto | undefined> {
    return this.#get(`/api/caixa/aberto?estacaoId=${estacaoId}`);
  }

  abrirCaixa(estacaoId: string, fundoTroco: string): Promise<CaixaAberto> {
    return this.#enviar("/api/caixa/abrir", { estacaoId, fundoTroco });
  }

  movimentarCaixa(
    tipo: "sangria" | "suprimento",
    dados: {
      readonly estacaoId: string;
      readonly valor: string;
      readonly motivo: string;
      readonly supervisor?: CredencialSupervisor | undefined;
    },
  ): Promise<unknown> {
    return this.#enviar(`/api/caixa/${tipo}`, dados);
  }

  fecharCaixa(dados: {
    readonly estacaoId: string;
    readonly contadoEmDinheiro: string;
    readonly vendasPendentes: number;
  }): Promise<Conferencia> {
    return this.#enviar("/api/caixa/fechar", dados);
  }

  // ── Venda ─────────────────────────────────────────────────────────────

  iniciarVenda(estacaoId: string): Promise<VendaNoFio> {
    return this.#enviar("/api/vendas", { estacaoId });
  }

  venda(id: string): Promise<VendaNoFio> {
    return this.#get(`/api/vendas/${id}`);
  }

  async abertas(estacaoId: string): Promise<readonly VendaNoFio[]> {
    const resposta = await this.#get<{ vendas: readonly VendaNoFio[] }>(
      `/api/vendas/abertas?estacaoId=${estacaoId}`,
    );

    return resposta.vendas;
  }

  adicionarItem(
    vendaId: string,
    dados: {
      readonly codigo: string;
      /** Sem `unidade`: o "3 ×", na unidade do próprio produto. */
      readonly quantidade?:
        { readonly milesimos: string; readonly unidade?: string | undefined } | undefined;
      readonly supervisor?: CredencialSupervisor | undefined;
    },
  ): Promise<RespostaItem> {
    return this.#enviar(`/api/vendas/${vendaId}/itens`, dados);
  }

  alterarQuantidade(
    vendaId: string,
    numeroItem: number,
    quantidade: QuantidadeNoFio,
    supervisor?: CredencialSupervisor,
  ): Promise<VendaNoFio> {
    return this.#enviar(
      `/api/vendas/${vendaId}/itens/${String(numeroItem)}`,
      { quantidade, supervisor },
      "PUT",
    );
  }

  removerItem(
    vendaId: string,
    numeroItem: number,
    supervisor?: CredencialSupervisor,
  ): Promise<VendaNoFio> {
    return this.#enviar(`/api/vendas/${vendaId}/itens/${String(numeroItem)}/remover`, {
      supervisor,
    });
  }

  aplicarDesconto(
    vendaId: string,
    dados: {
      readonly numeroItem?: number | undefined;
      readonly valor?: string | undefined;
      readonly percentualBps?: number | undefined;
      readonly supervisor?: CredencialSupervisor | undefined;
    },
  ): Promise<VendaNoFio> {
    return this.#enviar(`/api/vendas/${vendaId}/desconto`, dados);
  }

  identificarCliente(vendaId: string, clienteId: string | null): Promise<VendaNoFio> {
    return this.#enviar(`/api/vendas/${vendaId}/cliente`, { clienteId }, "PUT");
  }

  registrarPagamento(
    vendaId: string,
    dados: {
      readonly forma: string;
      readonly valor: string;
      readonly parcelas?: number | undefined;
      readonly autorizacao?: string | undefined;
      readonly confirmacao?: "MANUAL" | "SIMULADA" | undefined;
      readonly chave: string;
      readonly supervisor?: CredencialSupervisor | undefined;
    },
  ): Promise<RespostaPagamento> {
    return this.#enviar(`/api/vendas/${vendaId}/pagamentos`, dados);
  }

  removerPagamento(vendaId: string, indice: number): Promise<VendaNoFio> {
    return this.#enviar(
      `/api/vendas/${vendaId}/pagamentos/${String(indice)}/remover`,
      {},
    );
  }

  suspender(vendaId: string, rotulo: string): Promise<VendaNoFio> {
    return this.#enviar(`/api/vendas/${vendaId}/suspender`, { rotulo });
  }

  retomar(vendaId: string, estacaoId: string): Promise<VendaNoFio> {
    return this.#enviar(`/api/vendas/${vendaId}/retomar`, { estacaoId });
  }

  cancelar(
    vendaId: string,
    motivo: string,
    supervisor?: CredencialSupervisor,
  ): Promise<RespostaCancelamento> {
    return this.#enviar(`/api/vendas/${vendaId}/cancelar`, { motivo, supervisor });
  }

  finalizar(
    vendaId: string,
    crediario?: { readonly parcelas: number },
  ): Promise<VendaNoFio> {
    return this.#enviar(`/api/vendas/${vendaId}/finalizar`, { crediario });
  }

  // ── Depois da venda ───────────────────────────────────────────────────

  comprovante(vendaId: string): Promise<Comprovante> {
    return this.#get(`/api/vendas/${vendaId}/comprovante`);
  }

  async recentes(filtro: {
    readonly estacaoId?: string;
    readonly numero?: number;
    readonly limite?: number;
  }): Promise<readonly VendaRecente[]> {
    const parametros = new URLSearchParams();
    if (filtro.estacaoId !== undefined) parametros.set("estacaoId", filtro.estacaoId);
    if (filtro.numero !== undefined) parametros.set("numero", String(filtro.numero));
    if (filtro.limite !== undefined) parametros.set("limite", String(filtro.limite));

    const resposta = await this.#get<{ vendas: readonly VendaRecente[] }>(
      `/api/vendas/recentes?${parametros.toString()}`,
    );

    return resposta.vendas;
  }

  devolucoes(vendaId: string): Promise<DevolucoesDaVenda> {
    return this.#get(`/api/vendas/${vendaId}/devolucoes`);
  }

  registrarDevolucao(
    vendaId: string,
    dados: {
      readonly estacaoId: string;
      readonly itens: readonly {
        readonly numeroItem: number;
        readonly quantidade: QuantidadeNoFio;
        readonly destino: "ESTOQUE" | "PERDA";
      }[];
      readonly formaReembolso: "DINHEIRO" | "PIX" | "CARTAO" | "ABATER_FIADO";
      readonly motivo: string;
      readonly supervisor?: CredencialSupervisor | undefined;
    },
  ): Promise<{ readonly id: string; readonly valorTotal: string }> {
    return this.#enviar(`/api/vendas/${vendaId}/devolucoes`, dados);
  }

  // ── Treinamento ───────────────────────────────────────────────────────

  /** Apaga o que o treino fez e monta a loja de demonstração de novo. */
  recomecarTreino(): Promise<void> {
    return this.#enviar("/api/treinamento/recomecar", {});
  }
}

/** O endereço de uma imagem do catálogo — pública, para `<img src>`. */
export function enderecoDaImagem(imagemId: string, prefixo = ""): string {
  return `${prefixo}/api/imagens/${imagemId}`;
}
