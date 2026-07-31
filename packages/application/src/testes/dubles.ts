import {
  type CodigoUnidade,
  type DomainError,
  type DomainEvent,
  err,
  type Identificador,
  montarUuidV7,
  type MovimentoEstoque,
  type Produto,
  type Result,
  SaldoEstoque,
  type SessaoCaixa,
  type Venda,
} from "@erp/domain";

import { ErroInfraestrutura } from "../erros/ErroInfraestrutura.js";
import type { GeradorId } from "../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../portas/infraestrutura/UnitOfWork.js";
import type {
  CaixaRepository,
  EstoqueRepository,
  OutboxRepository,
  ProdutoRepository,
  Repositorios,
  VendaRepository,
} from "../portas/repositorios/Repositorios.js";

/**
 * Dublês em memória das portas.
 *
 * Não são "só para teste": é a prova prática de que a arquitetura hexagonal
 * funciona. Todo o fluxo de venda roda sem banco, sem rede e sem impressora —
 * e é por isso que a suíte inteira leva menos de um segundo.
 *
 * O adapter de produção implementa exatamente as mesmas interfaces.
 */

/** Relógio parado, para testes determinísticos. */
export class RelogioFixo implements Relogio {
  constructor(private instante: Date) {}

  agora(): Date {
    return this.instante;
  }

  avancar(milissegundos: number): void {
    this.instante = new Date(this.instante.getTime() + milissegundos);
  }
}

/** Gerador previsível: mesma sequência a cada execução. */
export class GeradorIdSequencial implements GeradorId {
  #contador = 0;

  proximo(): Identificador {
    this.#contador += 1;
    const aleatorios = new Uint8Array(10).fill(this.#contador % 256);
    return montarUuidV7(1_700_000_000_000 + this.#contador, aleatorios).unwrap();
  }
}

export class ProdutoRepositorioEmMemoria implements ProdutoRepository {
  readonly itens = new Map<string, Produto>();
  readonly porBalanca = new Map<string, Produto>();

  adicionar(produto: Produto, codigoBalanca?: string): void {
    this.itens.set(produto.id.valor, produto);
    if (codigoBalanca !== undefined) {
      this.porBalanca.set(codigoBalanca, produto);
    }
  }

  porId(id: Identificador): Promise<Produto | undefined> {
    return Promise.resolve(this.itens.get(id.valor));
  }

  porCodigo(codigo: string): Promise<Produto | undefined> {
    for (const produto of this.itens.values()) {
      if (produto.correspondeAoCodigo(codigo)) return Promise.resolve(produto);
    }
    return Promise.resolve(undefined);
  }

  porCodigoBalanca(codigo: string): Promise<Produto | undefined> {
    return Promise.resolve(this.porBalanca.get(codigo));
  }

  salvar(produto: Produto): Promise<void> {
    this.itens.set(produto.id.valor, produto);
    return Promise.resolve();
  }
}

export class VendaRepositorioEmMemoria implements VendaRepository {
  readonly itens = new Map<string, Venda>();
  #proximo = 1;

  porId(id: Identificador): Promise<Venda | undefined> {
    return Promise.resolve(this.itens.get(id.valor));
  }

  salvar(venda: Venda): Promise<void> {
    this.itens.set(venda.id.valor, venda);
    return Promise.resolve();
  }

  proximoNumero(_estacaoId: Identificador): Promise<number> {
    const numero = this.#proximo;
    this.#proximo += 1;
    return Promise.resolve(numero);
  }
}

export class EstoqueRepositorioEmMemoria implements EstoqueRepository {
  readonly movimentos: MovimentoEstoque[] = [];

  saldo(produtoId: Identificador, unidade: CodigoUnidade): Promise<SaldoEstoque> {
    const doProduto = this.movimentos.filter((movimento) =>
      movimento.produtoId.equals(produtoId),
    );

    return Promise.resolve(
      SaldoEstoque.projetar(produtoId, unidade, doProduto).unwrapOr(
        SaldoEstoque.vazio(produtoId, unidade),
      ),
    );
  }

  registrar(movimento: MovimentoEstoque): Promise<void> {
    this.movimentos.push(movimento);
    return Promise.resolve();
  }
}

export class CaixaRepositorioEmMemoria implements CaixaRepository {
  readonly itens = new Map<string, SessaoCaixa>();

  adicionar(sessao: SessaoCaixa): void {
    this.itens.set(sessao.id.valor, sessao);
  }

  porId(id: Identificador): Promise<SessaoCaixa | undefined> {
    return Promise.resolve(this.itens.get(id.valor));
  }

  abertaNaEstacao(estacaoId: Identificador): Promise<SessaoCaixa | undefined> {
    for (const sessao of this.itens.values()) {
      if (sessao.estaAberta && sessao.estacaoId.equals(estacaoId)) {
        return Promise.resolve(sessao);
      }
    }
    return Promise.resolve(undefined);
  }

  salvar(sessao: SessaoCaixa): Promise<void> {
    this.itens.set(sessao.id.valor, sessao);
    return Promise.resolve();
  }
}

export class OutboxEmMemoria implements OutboxRepository {
  readonly eventos: DomainEvent[] = [];

  enfileirar(eventos: readonly DomainEvent[]): Promise<void> {
    this.eventos.push(...eventos);
    return Promise.resolve();
  }
}

/**
 * Unit of Work em memória.
 *
 * Não simula rollback de dados — os dublês guardam referências, não cópias.
 * O que ele **de fato** verifica é o contrato: erro devolvido pelo trabalho
 * chega inalterado a quem chamou, e exceção vira `ErroInfraestrutura` em vez de
 * escapar. `falharAoConfirmar` permite testar o caminho de falha de transação.
 */
export class UnitOfWorkEmMemoria implements UnitOfWork {
  falharAoConfirmar = false;
  transacoes = 0;

  constructor(readonly repositorios: Repositorios) {}

  async transacao<T, E extends DomainError>(
    trabalho: (repositorios: Repositorios) => Promise<Result<T, E>>,
  ): Promise<Result<T, E | ErroInfraestrutura>> {
    this.transacoes += 1;

    if (this.falharAoConfirmar) {
      return err(new ErroInfraestrutura("TRANSACAO_FALHOU"));
    }

    try {
      return await trabalho(this.repositorios);
    } catch (causa) {
      return err(ErroInfraestrutura.de(causa));
    }
  }
}

/** Monta o conjunto completo de dublês para um teste. */
export function montarAmbiente(instante = new Date("2026-07-30T12:00:00.000Z")): {
  readonly produtos: ProdutoRepositorioEmMemoria;
  readonly vendas: VendaRepositorioEmMemoria;
  readonly estoque: EstoqueRepositorioEmMemoria;
  readonly caixas: CaixaRepositorioEmMemoria;
  readonly outbox: OutboxEmMemoria;
  readonly unitOfWork: UnitOfWorkEmMemoria;
  readonly relogio: RelogioFixo;
  readonly geradorId: GeradorIdSequencial;
} {
  const produtos = new ProdutoRepositorioEmMemoria();
  const vendas = new VendaRepositorioEmMemoria();
  const estoque = new EstoqueRepositorioEmMemoria();
  const caixas = new CaixaRepositorioEmMemoria();
  const outbox = new OutboxEmMemoria();

  return {
    produtos,
    vendas,
    estoque,
    caixas,
    outbox,
    unitOfWork: new UnitOfWorkEmMemoria({ produtos, vendas, estoque, caixas, outbox }),
    relogio: new RelogioFixo(instante),
    geradorId: new GeradorIdSequencial(),
  };
}
