import { ErroInfraestrutura, type Repositorios, type UnitOfWork } from "@erp/application";
import { type DomainError, err, type Result } from "@erp/domain";

import type { Prisma, PrismaClient } from "./gerado/index.js";
import {
  PapelRepositorioPrisma,
  SessaoAcessoRepositorioPrisma,
  UsuarioRepositorioPrisma,
} from "./repositorios/AcessoRepositorioPrisma.js";
import { CaixaRepositorioPrisma } from "./repositorios/CaixaRepositorioPrisma.js";
import { EstoqueRepositorioPrisma } from "./repositorios/EstoqueRepositorioPrisma.js";
import { OutboxRepositorioPrisma } from "./repositorios/OutboxRepositorioPrisma.js";
import { ProdutoRepositorioPrisma } from "./repositorios/ProdutoRepositorioPrisma.js";
import { VendaRepositorioPrisma } from "./repositorios/VendaRepositorioPrisma.js";

/** Erro interno usado só para forçar o `ROLLBACK` — nunca escapa desta classe. */
class DesfazerTransacao extends Error {
  constructor(readonly erroDeNegocio: DomainError) {
    super("rollback");
  }
}

export interface OpcoesUnitOfWork {
  /**
   * Quanto o trabalho pode demorar dentro da transação, em milissegundos.
   *
   * Transação aberta segura linhas travadas: se a estação travar no meio de uma
   * venda, o limite libera o produto para os outros caixas em vez de parar a
   * loja inteira (princípio 1).
   */
  readonly tempoLimiteMs?: number;
  /**
   * Quanto esperar por uma transação concorrente antes de desistir.
   */
  readonly esperaMaximaMs?: number;
}

const TEMPO_LIMITE_PADRAO_MS = 10_000;
const ESPERA_MAXIMA_PADRAO_MS = 5_000;

/**
 * `UnitOfWork` sobre uma transação do PostgreSQL.
 *
 * É aqui que a promessa da camada de aplicação vira garantia real: gravar a
 * venda, baixar o estoque, creditar o caixa e enfileirar o evento fiscal
 * acontecem **juntos ou não acontecem**. Meio caminho significaria estoque
 * baixado de venda que não existe, ou nota fiscal de venda revertida.
 *
 * O detalhe que faz isso funcionar é a tradução entre dois vocabulários: o
 * domínio devolve erro como **valor** (`Result`), e o Prisma só desfaz a
 * transação se a função **lançar**. A ponte é a exceção interna acima —
 * lançada para provocar o `ROLLBACK` e recapturada logo em seguida, de modo que
 * quem chamou continua recebendo um `Result` e nunca vê uma exceção.
 */
export class UnitOfWorkPrisma implements UnitOfWork {
  readonly #tempoLimiteMs: number;
  readonly #esperaMaximaMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    opcoes: OpcoesUnitOfWork = {},
  ) {
    this.#tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
    this.#esperaMaximaMs = opcoes.esperaMaximaMs ?? ESPERA_MAXIMA_PADRAO_MS;
  }

  async transacao<T, E extends DomainError>(
    trabalho: (repositorios: Repositorios) => Promise<Result<T, E>>,
  ): Promise<Result<T, E | ErroInfraestrutura>> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const resultado = await trabalho(montarRepositorios(tx));

          if (resultado.isErr()) {
            throw new DesfazerTransacao(resultado.error);
          }

          return resultado;
        },
        { timeout: this.#tempoLimiteMs, maxWait: this.#esperaMaximaMs },
      );
    } catch (causa) {
      if (causa instanceof DesfazerTransacao) {
        // Erro de negócio: a transação foi desfeita de propósito. O operador vê
        // a mensagem do domínio, não um erro técnico (CLAUDE.md §9).
        return err(causa.erroDeNegocio as E);
      }

      // Falha de verdade — banco fora, conflito de escrita, tempo esgotado.
      // Vira mensagem que o operador consegue agir sobre, com o detalhe técnico
      // guardado para o log.
      return err(ErroInfraestrutura.de(causa, "FALHA_TRANSACAO"));
    }
  }
}

/** Repositórios ligados à mesma transação. */
export function montarRepositorios(tx: Prisma.TransactionClient): Repositorios {
  return {
    produtos: new ProdutoRepositorioPrisma(tx),
    vendas: new VendaRepositorioPrisma(tx),
    estoque: new EstoqueRepositorioPrisma(tx),
    caixas: new CaixaRepositorioPrisma(tx),
    outbox: new OutboxRepositorioPrisma(tx),
    usuarios: new UsuarioRepositorioPrisma(tx),
    papeis: new PapelRepositorioPrisma(tx),
    sessoes: new SessaoAcessoRepositorioPrisma(tx),
  };
}
