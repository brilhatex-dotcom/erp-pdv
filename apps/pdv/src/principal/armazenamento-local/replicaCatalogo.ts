import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { normalizarParaBusca } from "@erp/utils";

/**
 * Cópia local do catálogo, para o PDV bipar sem servidor.
 *
 * ### Índice em memória, não banco
 *
 * Cerca de 50 mil produtos ocupam uns 15 MB e são indexados em menos de um
 * segundo na abertura do caixa (ADR-0021). Uma busca por código de barras vira
 * `Map.get` — mais rápido que qualquer consulta, e sem peça nativa no
 * instalador.
 *
 * ### O preço aqui é cópia, e a cópia envelhece
 *
 * A estação registra a venda com o preço que conhece. Se o preço mudou na
 * retaguarda enquanto a rede estava fora, a venda vai com o preço antigo — e é
 * assim que tem que ser: mudar o valor depois de o cliente pagar seria pior.
 * O servidor reconhece a divergência na sincronização; quem decide o que fazer
 * é o gerente, não o caixa.
 */

export interface ProdutoReplicado {
  readonly id: string;
  readonly sku: string;
  readonly descricao: string;
  readonly descricaoPdv: string;
  readonly unidade: string;
  /** Centavos em texto — dinheiro nunca vira número. */
  readonly precoVenda: string;
  readonly codigoBarras?: string | undefined;
  readonly codigoBalanca?: string | undefined;
  readonly ativo: boolean;
}

export interface CatalogoEmDisco {
  /** Momento da última atualização vinda do servidor. */
  readonly atualizadoEm: string;
  readonly produtos: readonly ProdutoReplicado[];
}

const LIMITE_BUSCA = 20;

export class ReplicaCatalogo {
  #porCodigoBarras = new Map<string, ProdutoReplicado>();
  #porSku = new Map<string, ProdutoReplicado>();
  #porCodigoBalanca = new Map<string, ProdutoReplicado>();
  #porDescricao: { chave: string; produto: ProdutoReplicado }[] = [];
  #atualizadoEm: Date | undefined;

  get atualizadoEm(): Date | undefined {
    return this.#atualizadoEm;
  }

  get quantidade(): number {
    return this.#porSku.size;
  }

  /** Índice montado a partir do que está em disco. Fila vazia se não houver. */
  carregarDe(caminho: string): void {
    if (!existsSync(caminho)) return;

    let bruto: unknown;

    try {
      bruto = JSON.parse(readFileSync(caminho, "utf8"));
    } catch {
      // Catálogo corrompido não impede o caixa de abrir: sem réplica, o PDV
      // volta a depender do servidor — degradado, mas de pé (princípio 1).
      return;
    }

    const dados = bruto as Partial<CatalogoEmDisco>;
    if (!Array.isArray(dados.produtos)) return;

    this.substituir({
      atualizadoEm: typeof dados.atualizadoEm === "string" ? dados.atualizadoEm : "",
      produtos: dados.produtos as ProdutoReplicado[],
    });
  }

  gravarEm(caminho: string, catalogo: CatalogoEmDisco): void {
    writeFileSync(caminho, JSON.stringify(catalogo), "utf8");
    this.substituir(catalogo);
  }

  /** Troca o catálogo inteiro — é o que a abertura do caixa faz. */
  substituir(catalogo: CatalogoEmDisco): void {
    this.#porCodigoBarras = new Map();
    this.#porSku = new Map();
    this.#porCodigoBalanca = new Map();
    this.#porDescricao = [];

    for (const produto of catalogo.produtos) {
      this.#indexar(produto);
    }

    const quando = new Date(catalogo.atualizadoEm);
    this.#atualizadoEm = Number.isNaN(quando.getTime()) ? undefined : quando;
  }

  /**
   * O que o operador bipou ou digitou.
   *
   * A ordem das tentativas é a frequência real do balcão: quase toda venda
   * entra por código de barras, e só então por SKU. Inverter custaria uma
   * consulta a mais em cada bipada do dia.
   */
  porCodigo(codigo: string): ProdutoReplicado | undefined {
    const limpo = codigo.trim();
    if (limpo === "") return undefined;

    return (
      this.#porCodigoBarras.get(limpo) ??
      this.#porSku.get(limpo.toUpperCase()) ??
      this.#porCodigoBalanca.get(limpo)
    );
  }

  /**
   * Busca por trecho da descrição — o caminho de quem não tem código.
   *
   * Prefixo, não "contém": com 50 mil produtos, procurar em qualquer posição de
   * cada descrição a cada tecla digitada trava a tela.
   */
  buscar(termo: string, limite = LIMITE_BUSCA): readonly ProdutoReplicado[] {
    const procurado = normalizarParaBusca(termo);
    if (procurado === "") return [];

    const achados: ProdutoReplicado[] = [];

    for (const entrada of this.#porDescricao) {
      if (!entrada.chave.startsWith(procurado)) continue;

      achados.push(entrada.produto);
      if (achados.length >= limite) break;
    }

    return achados;
  }

  #indexar(produto: ProdutoReplicado): void {
    // Produto inativo fica de fora do índice: se não pode ser vendido, ele não
    // deve aparecer na bipada. Mantê-lo levaria o operador a bipar e receber
    // uma recusa sem explicação.
    if (!produto.ativo) return;

    this.#porSku.set(produto.sku.toUpperCase(), produto);

    if (produto.codigoBarras !== undefined) {
      this.#porCodigoBarras.set(produto.codigoBarras, produto);
    }
    if (produto.codigoBalanca !== undefined) {
      this.#porCodigoBalanca.set(produto.codigoBalanca, produto);
    }

    this.#porDescricao.push({
      chave: normalizarParaBusca(produto.descricaoPdv),
      produto,
    });
  }
}
