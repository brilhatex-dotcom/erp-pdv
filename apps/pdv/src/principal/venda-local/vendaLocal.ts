import {
  Dinheiro,
  ehCodigoDeBalanca,
  ehCodigoUnidade,
  interpretarCodigoBalanca,
  type LayoutBalanca,
  Quantidade,
} from "@erp/domain";

import type {
  ItemNaPonte,
  ResultadoFinalizacaoNaPonte,
  ResultadoItemNaPonte,
  ResultadoPagamentoNaPonte,
  VendaNaPonte,
} from "../../contrato-ponte.js";
import type { FilaDeVendas, VendaPendente } from "../armazenamento-local/filaDeVendas.js";
import type {
  ProdutoReplicado,
  ReplicaCatalogo,
} from "../armazenamento-local/replicaCatalogo.js";

/**
 * A venda quando o servidor não responde.
 *
 * ### Por que isto existe no processo principal, e não na tela
 *
 * A réplica do catálogo mora aqui — ela lê disco. Somar o total na tela exigiria
 * ou levar o domínio para dentro do navegador, ou reescrever a aritmética de
 * dinheiro num segundo lugar. O primeiro caminho põe regra de negócio onde um
 * cliente adulterado a contorna; o segundo é duplicação vetada por `CLAUDE.md`
 * §9. Calculando aqui, a tela recebe o **mesmo formato** que a API devolve e não
 * sabe se está online ou offline — que é o que a mantém simples.
 *
 * ### O total daqui é provisório, e isso é de propósito
 *
 * Quem manda no preço é o cadastro do servidor, na importação
 * (`rotas/sincronizacao.ts`). Se o preço mudou enquanto a estação estava
 * isolada, a venda entra com o preço novo e a diferença aparece no relatório.
 * O número calculado aqui serve ao operador — conferir o troco na mão — e nunca
 * à contabilidade.
 *
 * ### Sem número de venda
 *
 * Numerar é do servidor: duas estações offline escolhendo números sozinhas
 * produziriam duas vendas 47 no mesmo dia. Enquanto a venda não sobe, ela não
 * tem número — e a tela mostra isso ao operador em vez de inventar um.
 */

export type {
  EstadoConexaoNaPonte,
  ItemNaPonte as ItemLocal,
  ResultadoFinalizacaoNaPonte as ResultadoFinalizacao,
  ResultadoItemNaPonte as ResultadoItem,
  ResultadoPagamentoNaPonte as ResultadoPagamento,
  VendaNaPonte as VendaLocalNaTela,
} from "../../contrato-ponte.js";

export interface PagamentoLocal {
  readonly forma: string;
  readonly valor: string;
}

interface EmAndamento {
  readonly id: string;
  readonly estacaoId: string;
  readonly operadorId: string;
  readonly registradaEm: Date;
  readonly itens: ItemNaPonte[];
  readonly pagamentos: PagamentoLocal[];
}

export interface OpcoesVendaLocal {
  readonly replica: ReplicaCatalogo;
  readonly fila: FilaDeVendas;
  readonly layoutBalanca: LayoutBalanca;
  readonly novoId: () => string;
  readonly agora?: () => Date;
}

export class VendaLocal {
  readonly #replica: ReplicaCatalogo;
  readonly #fila: FilaDeVendas;
  readonly #layout: LayoutBalanca;
  readonly #novoId: () => string;
  readonly #agora: () => Date;

  #atual: EmAndamento | undefined;

  constructor(opcoes: OpcoesVendaLocal) {
    this.#replica = opcoes.replica;
    this.#fila = opcoes.fila;
    this.#layout = opcoes.layoutBalanca;
    this.#novoId = opcoes.novoId;
    this.#agora = opcoes.agora ?? ((): Date => new Date());
  }

  /** Abre a venda offline. Chamada na primeira bipada, como no caminho online. */
  iniciar(estacaoId: string, operadorId: string): VendaNaPonte {
    this.#atual = {
      id: this.#novoId(),
      estacaoId,
      operadorId,
      registradaEm: this.#agora(),
      itens: [],
      pagamentos: [],
    };

    return this.#comoTela(this.#atual);
  }

  adicionarItem(codigo: string): ResultadoItemNaPonte {
    const venda = this.#atual;

    if (venda === undefined) {
      return { tipo: "ERRO", mensagem: "Nenhuma venda aberta." };
    }

    const achado = this.#localizar(codigo);

    if (achado.tipo === "ERRO") return achado;

    const { produto, quantidade } = achado;
    const centavos = centavosDe(produto.precoVenda);

    if (centavos === undefined) {
      return { tipo: "ERRO", mensagem: "Preço inválido no catálogo local." };
    }

    const preco = Dinheiro.deCentavos(centavos);

    if (preco.isErr()) {
      return { tipo: "ERRO", mensagem: "Preço inválido no catálogo local." };
    }

    // `escalar` com escala de milésimos é como o domínio multiplica preço por
    // peso sem passar por ponto flutuante — 1,235 kg é `1235n / 1000n`.
    const total = preco.unwrap().escalar(quantidade.milesimos, 1000n);

    venda.itens.push({
      numero: venda.itens.length + 1,
      codigo,
      descricao: produto.descricaoPdv,
      quantidade: {
        milesimos: quantidade.milesimos.toString(),
        unidade: quantidade.unidade.codigo,
      },
      precoUnitario: produto.precoVenda,
      total: total.centavos.toString(),
    });

    return { tipo: "OK", venda: this.#comoTela(venda) };
  }

  registrarPagamento(forma: string, valorEmCentavos: string): ResultadoPagamentoNaPonte {
    const venda = this.#atual;

    if (venda === undefined) {
      return { tipo: "ERRO", mensagem: "Nenhuma venda aberta." };
    }

    if (venda.itens.length === 0) {
      return { tipo: "ERRO", mensagem: "Venda sem itens." };
    }

    if (!/^[1-9]\d*$/.test(valorEmCentavos)) {
      return { tipo: "ERRO", mensagem: "Valor inválido." };
    }

    venda.pagamentos.push({ forma, valor: valorEmCentavos });

    return { tipo: "OK", faltaPagar: this.#faltaPagar(venda).toString() };
  }

  /**
   * Grava a venda na fila e só então retorna.
   *
   * Quando esta função retorna, o disco já confirmou (`FilaDeVendas`). É o que
   * permite ao operador entregar o cupom sabendo que a venda existe em algum
   * lugar mesmo que falte energia no segundo seguinte.
   */
  finalizar(): ResultadoFinalizacaoNaPonte {
    const venda = this.#atual;

    if (venda === undefined) {
      return { tipo: "ERRO", mensagem: "Nenhuma venda aberta." };
    }

    const falta = this.#faltaPagar(venda);

    if (falta > 0n) {
      return { tipo: "ERRO", mensagem: "Ainda falta receber." };
    }

    const pendente: VendaPendente = {
      id: venda.id,
      estacaoId: venda.estacaoId,
      operadorId: venda.operadorId,
      registradaEm: venda.registradaEm.toISOString(),
      itens: venda.itens.map((item) => ({
        codigo: item.codigo,
        quantidade: item.quantidade,
      })),
      pagamentos: venda.pagamentos,
      total: this.#total(venda).toString(),
    };

    this.#fila.enfileirar(pendente);
    this.#atual = undefined;

    // Falta negativa é troco. O sinal se inverte porque `faltaPagar` mede o que
    // ainda não entrou.
    return { tipo: "OK", troco: (-falta).toString() };
  }

  /** Descarta a venda em aberto — o operador cancelou antes de receber. */
  cancelar(): void {
    this.#atual = undefined;
  }

  #localizar(
    codigo: string,
  ):
    | { readonly tipo: "OK"; produto: ProdutoReplicado; quantidade: Quantidade }
    | { readonly tipo: "ERRO"; readonly mensagem: string } {
    if (ehCodigoDeBalanca(codigo, this.#layout)) {
      return this.#localizarPorBalanca(codigo);
    }

    const produto = this.#replica.porCodigo(codigo);

    if (produto === undefined) {
      return { tipo: "ERRO", mensagem: "Produto não encontrado no catálogo local." };
    }

    // A unidade é **conferida**, não convertida à força. Uma réplica gravada
    // por um servidor mais novo pode trazer unidade que esta estação ainda não
    // conhece, e o domínio a procura numa tabela: afirmar o tipo sem checar
    // troca uma recusa clara por tela branca no meio do atendimento.
    if (!ehCodigoUnidade(produto.unidade)) {
      return { tipo: "ERRO", mensagem: "Unidade inválida no catálogo local." };
    }

    const quantidade = Quantidade.de("1", produto.unidade);

    return quantidade.isErr()
      ? { tipo: "ERRO", mensagem: "Unidade inválida no catálogo local." }
      : { tipo: "OK", produto, quantidade: quantidade.unwrap() };
  }

  #localizarPorBalanca(
    codigo: string,
  ):
    | { readonly tipo: "OK"; produto: ProdutoReplicado; quantidade: Quantidade }
    | { readonly tipo: "ERRO"; readonly mensagem: string } {
    const leitura = interpretarCodigoBalanca(codigo, this.#layout);

    if (leitura.isErr()) {
      return { tipo: "ERRO", mensagem: "Etiqueta de balança inválida." };
    }

    const { codigoProduto, peso, preco } = leitura.unwrap();
    const produto = this.#replica.porCodigo(codigoProduto);

    if (produto === undefined) {
      return {
        tipo: "ERRO",
        mensagem: "Produto da etiqueta não está no catálogo local.",
      };
    }

    if (peso !== undefined) return { tipo: "OK", produto, quantidade: peso };

    const precoUnitario = centavosDe(produto.precoVenda);

    if (!ehCodigoUnidade(produto.unidade)) {
      return { tipo: "ERRO", mensagem: "Unidade inválida no catálogo local." };
    }

    // Etiqueta que embute preço em vez de peso: a quantidade sai da divisão.
    // Sem preço unitário não há divisão possível, e adivinhar cobraria errado —
    // o defeito mais caro do balcão.
    if (preco === undefined || precoUnitario === undefined || precoUnitario <= 0n) {
      return {
        tipo: "ERRO",
        mensagem: "Não foi possível calcular o peso da etiqueta. Registre manualmente.",
      };
    }

    const quantidade = Quantidade.deMilesimos(
      (preco.centavos * 1000n) / precoUnitario,
      produto.unidade,
    );

    return quantidade.isErr()
      ? { tipo: "ERRO", mensagem: "Peso da etiqueta fora do aceito." }
      : { tipo: "OK", produto, quantidade: quantidade.unwrap() };
  }

  #total(venda: EmAndamento): bigint {
    return venda.itens.reduce((soma, item) => soma + BigInt(item.total), 0n);
  }

  #faltaPagar(venda: EmAndamento): bigint {
    const pago = venda.pagamentos.reduce((soma, atual) => soma + BigInt(atual.valor), 0n);

    return this.#total(venda) - pago;
  }

  #comoTela(venda: EmAndamento): VendaNaPonte {
    const falta = this.#faltaPagar(venda);

    return {
      id: venda.id,
      offline: true,
      total: this.#total(venda).toString(),
      // A tela mostra o que falta receber; quando já entrou demais, falta zero
      // e a diferença vira troco na finalização.
      faltaPagar: (falta > 0n ? falta : 0n).toString(),
      itens: venda.itens,
    };
  }
}

/**
 * Lê centavos vindos do catálogo em disco.
 *
 * `BigInt("abc")` **lança**, e o arquivo é gravado por outro processo — basta
 * uma versão futura mudar o formato para a bipada estourar. Preço negativo é
 * catálogo corrompido: recusar o item é degradação, cobrar errado não é.
 */
function centavosDe(texto: string): bigint | undefined {
  if (!/^\d+$/.test(texto)) return undefined;

  return BigInt(texto);
}
