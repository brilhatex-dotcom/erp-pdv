import {
  type CodigoUnidade,
  CredencialHash,
  type DomainError,
  type DomainEvent,
  err,
  type Identificador,
  type Matricula,
  montarUuidV7,
  type MovimentoEstoque,
  type Papel,
  type Produto,
  type Result,
  SaldoEstoque,
  type SessaoAcesso,
  type SessaoCaixa,
  type Usuario,
  type Venda,
} from "@erp/domain";

import { ErroInfraestrutura } from "../erros/ErroInfraestrutura.js";
import type { GeradorId } from "../portas/infraestrutura/GeradorId.js";
import type { Hasher } from "../portas/infraestrutura/Hasher.js";
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
import type {
  PapelRepository,
  SessaoAcessoRepository,
  UsuarioRepository,
} from "../portas/repositorios/RepositoriosAcesso.js";

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

  adicionar(produto: Produto): void {
    this.itens.set(produto.id.valor, produto);
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
    for (const produto of this.itens.values()) {
      if (produto.codigoBalanca === codigo) return Promise.resolve(produto);
    }
    return Promise.resolve(undefined);
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
  /** Transações desfeitas por erro devolvido pelo trabalho. */
  desfeitas = 0;

  constructor(readonly repositorios: Repositorios) {}

  async transacao<T, E extends DomainError>(
    trabalho: (repositorios: Repositorios) => Promise<Result<T, E>>,
  ): Promise<Result<T, E | ErroInfraestrutura>> {
    this.transacoes += 1;

    if (this.falharAoConfirmar) {
      return err(new ErroInfraestrutura("TRANSACAO_FALHOU"));
    }

    try {
      const resultado = await trabalho(this.repositorios);

      // Não desfaz os dados — os dublês guardam referências, não cópias —, mas
      // **conta** o rollback. É o que permite um teste afirmar que uma
      // gravação que precisa sobreviver não está sendo devolvida com `err`.
      if (resultado.isErr()) this.desfeitas += 1;

      return resultado;
    } catch (causa) {
      return err(ErroInfraestrutura.de(causa));
    }
  }
}

export class UsuarioRepositorioEmMemoria implements UsuarioRepository {
  readonly itens = new Map<string, Usuario>();

  adicionar(usuario: Usuario): void {
    this.itens.set(usuario.id.valor, usuario);
  }

  porId(id: Identificador): Promise<Usuario | undefined> {
    return Promise.resolve(this.itens.get(id.valor));
  }

  porMatricula(matricula: Matricula): Promise<Usuario | undefined> {
    for (const usuario of this.itens.values()) {
      if (usuario.matricula.equals(matricula)) return Promise.resolve(usuario);
    }
    return Promise.resolve(undefined);
  }

  salvar(usuario: Usuario): Promise<void> {
    this.itens.set(usuario.id.valor, usuario);
    return Promise.resolve();
  }
}

export class PapelRepositorioEmMemoria implements PapelRepository {
  readonly itens = new Map<string, Papel>();

  adicionar(papel: Papel): void {
    this.itens.set(papel.id.valor, papel);
  }

  porId(id: Identificador): Promise<Papel | undefined> {
    return Promise.resolve(this.itens.get(id.valor));
  }

  porCodigo(codigo: string): Promise<Papel | undefined> {
    for (const papel of this.itens.values()) {
      if (papel.codigo === codigo.trim().toUpperCase()) return Promise.resolve(papel);
    }
    return Promise.resolve(undefined);
  }

  todos(): Promise<readonly Papel[]> {
    return Promise.resolve([...this.itens.values()]);
  }

  salvar(papel: Papel): Promise<void> {
    this.itens.set(papel.id.valor, papel);
    return Promise.resolve();
  }
}

export class SessaoAcessoRepositorioEmMemoria implements SessaoAcessoRepository {
  readonly itens = new Map<string, SessaoAcesso>();

  porId(id: Identificador): Promise<SessaoAcesso | undefined> {
    return Promise.resolve(this.itens.get(id.valor));
  }

  salvar(sessao: SessaoAcesso): Promise<void> {
    this.itens.set(sessao.id.valor, sessao);
    return Promise.resolve();
  }

  revogarFamilia(familiaId: Identificador, agora: Date): Promise<void> {
    for (const sessao of this.itens.values()) {
      if (sessao.familiaId.equals(familiaId)) sessao.revogar(agora);
    }
    return Promise.resolve();
  }

  revogarDoUsuario(usuarioId: Identificador, agora: Date): Promise<void> {
    for (const sessao of this.itens.values()) {
      if (sessao.usuarioId.equals(usuarioId)) sessao.revogar(agora);
    }
    return Promise.resolve();
  }
}

/**
 * Hasher falso — reversível e instantâneo.
 *
 * Não usa Argon2id de propósito: o custo dele é deliberadamente alto, e uma
 * suíte que o chamasse a cada teste passaria a ser medida em minutos. O que se
 * testa aqui é o **fluxo**, não a criptografia.
 */
export class HasherFalso implements Hasher {
  readonly algoritmo = "falso";
  /** Quantas vezes o tempo foi gasto sem conferir nada. */
  tempoGastoEmVao = 0;

  hash(textoEmClaro: string): Promise<CredencialHash> {
    return Promise.resolve(
      CredencialHash.criar(`falso:${textoEmClaro}`, this.algoritmo).unwrap(),
    );
  }

  confere(textoEmClaro: string, hash: CredencialHash): Promise<boolean> {
    return Promise.resolve(hash.valor === `falso:${textoEmClaro}`);
  }

  gastarTempoEquivalente(): Promise<void> {
    this.tempoGastoEmVao += 1;
    return Promise.resolve();
  }
}

/** Monta o conjunto completo de dublês para um teste. */
export function montarAmbiente(instante = new Date("2026-07-30T12:00:00.000Z")): {
  readonly produtos: ProdutoRepositorioEmMemoria;
  readonly vendas: VendaRepositorioEmMemoria;
  readonly estoque: EstoqueRepositorioEmMemoria;
  readonly caixas: CaixaRepositorioEmMemoria;
  readonly outbox: OutboxEmMemoria;
  readonly usuarios: UsuarioRepositorioEmMemoria;
  readonly papeis: PapelRepositorioEmMemoria;
  readonly sessoes: SessaoAcessoRepositorioEmMemoria;
  readonly hasher: HasherFalso;
  readonly unitOfWork: UnitOfWorkEmMemoria;
  readonly relogio: RelogioFixo;
  readonly geradorId: GeradorIdSequencial;
} {
  const produtos = new ProdutoRepositorioEmMemoria();
  const vendas = new VendaRepositorioEmMemoria();
  const estoque = new EstoqueRepositorioEmMemoria();
  const caixas = new CaixaRepositorioEmMemoria();
  const outbox = new OutboxEmMemoria();
  const usuarios = new UsuarioRepositorioEmMemoria();
  const papeis = new PapelRepositorioEmMemoria();
  const sessoes = new SessaoAcessoRepositorioEmMemoria();

  return {
    produtos,
    vendas,
    estoque,
    caixas,
    outbox,
    usuarios,
    papeis,
    sessoes,
    hasher: new HasherFalso(),
    unitOfWork: new UnitOfWorkEmMemoria({
      produtos,
      vendas,
      estoque,
      caixas,
      outbox,
      usuarios,
      papeis,
      sessoes,
    }),
    relogio: new RelogioFixo(instante),
    geradorId: new GeradorIdSequencial(),
  };
}
