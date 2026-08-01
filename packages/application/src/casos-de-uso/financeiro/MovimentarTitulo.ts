import {
  Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  type Identificador,
  ok,
  type Result,
  type Titulo,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

/**
 * Receber e estornar.
 *
 * São os dois atos do dia a dia da caderneta: o cliente passa e paga um pedaço,
 * e de vez em quando alguém lança no cliente errado e precisa desfazer.
 *
 * ### O dinheiro recebido aqui **não** entra na sessão de caixa
 *
 * É tentador creditar a gaveta quando o cliente paga o fiado no balcão, e seria
 * errado: a sessão de caixa é conferida contra a contagem física do turno em
 * que a **venda** aconteceu, e o pagamento do fiado chega dias depois, muitas
 * vezes com outro operador. Somá-lo faria a conferência de fechamento passar a
 * não bater por construção.
 *
 * O recebimento fica registrado no título, com data, forma e quem atendeu — que
 * é o que a pergunta "quem recebeu isso?" precisa. Ligar o recebimento de fiado
 * à gaveta é decisão de negócio, e exige ADR.
 */

export interface EntradaRegistrarRecebimento {
  readonly tituloId: Identificador;
  readonly valorCentavos: bigint;
  readonly usuarioId: Identificador;
  readonly forma?: string | undefined;
  readonly observacao?: string | undefined;
}

export class RegistrarRecebimento {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaRegistrarRecebimento,
  ): Promise<Result<Titulo, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const titulo = await repositorios.titulos.porId(entrada.tituloId);

      if (titulo === undefined) return err(naoEncontrado());

      const valor = Dinheiro.deCentavos(entrada.valorCentavos);

      if (valor.isErr()) return err(valor.error);

      const baixa = titulo.registrarBaixa({
        id: this.geradorId.proximo(),
        valor: valor.unwrap(),
        ocorridaEm: this.relogio.agora(),
        usuarioId: entrada.usuarioId,
        forma: entrada.forma,
        observacao: entrada.observacao,
      });

      if (baixa.isErr()) return err(baixa.error);

      await repositorios.titulos.salvar(titulo);

      return ok(titulo);
    });
  }
}

export interface EntradaEstornarRecebimento {
  readonly tituloId: Identificador;
  readonly baixaId: Identificador;
  readonly usuarioId: Identificador;
  readonly observacao?: string | undefined;
}

/**
 * Desfaz um recebimento sem apagá-lo.
 *
 * O caso real é o balcão cheio com dois homônimos na lista de clientes. O
 * estorno devolve o saldo e deixa os dois lançamentos à vista — que é o que
 * permite explicar ao cliente o que aconteceu, em vez de o valor simplesmente
 * sumir do extrato dele.
 */
export class EstornarRecebimento {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaEstornarRecebimento,
  ): Promise<Result<Titulo, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const titulo = await repositorios.titulos.porId(entrada.tituloId);

      if (titulo === undefined) return err(naoEncontrado());

      const estorno = titulo.estornarBaixa(entrada.baixaId, {
        id: this.geradorId.proximo(),
        ocorridaEm: this.relogio.agora(),
        usuarioId: entrada.usuarioId,
        observacao: entrada.observacao,
      });

      if (estorno.isErr()) return err(estorno.error);

      await repositorios.titulos.salvar(titulo);

      return ok(titulo);
    });
  }
}

export interface EntradaAdiarVencimento {
  readonly tituloId: Identificador;
  readonly novoVencimento: Date;
  readonly motivo?: string | undefined;
}

/** Renegociação de balcão: "consegue pagar dia 20?". Só adia, nunca antecipa. */
export class AdiarVencimento {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(entrada: EntradaAdiarVencimento): Promise<Result<Titulo, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const titulo = await repositorios.titulos.porId(entrada.tituloId);

      if (titulo === undefined) return err(naoEncontrado());

      const adiado = titulo.adiarVencimento(entrada.novoVencimento, entrada.motivo);

      if (adiado.isErr()) return err(adiado.error);

      await repositorios.titulos.salvar(titulo);

      return ok(titulo);
    });
  }
}

export interface EntradaCancelarTitulo {
  readonly tituloId: Identificador;
  readonly motivo: string;
}

export class CancelarTitulo {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
  ) {}

  async executar(entrada: EntradaCancelarTitulo): Promise<Result<Titulo, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const titulo = await repositorios.titulos.porId(entrada.tituloId);

      if (titulo === undefined) return err(naoEncontrado());

      const cancelado = titulo.cancelar(this.relogio.agora(), entrada.motivo);

      if (cancelado.isErr()) return err(cancelado.error);

      await repositorios.titulos.salvar(titulo);

      return ok(titulo);
    });
  }
}

function naoEncontrado(): ErroNaoEncontrado {
  return new ErroNaoEncontrado("TITULO_NAO_ENCONTRADO", "Título não encontrado.");
}
