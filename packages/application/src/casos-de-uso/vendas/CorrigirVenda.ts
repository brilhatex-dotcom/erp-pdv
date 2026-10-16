import {
  type DomainError,
  err,
  ErroValidacao,
  type Identificador,
  ok,
  type Quantidade,
  type Result,
  type Venda,
} from "@erp/domain";

import { auditar } from "../../auditoria/RegistroAuditoria.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";
import type {
  AutorizarOperacao,
  Autorizacao,
  CredencialSupervisor,
} from "../acesso/AutorizarOperacao.js";
import { carregarVenda, descreverItem } from "./apoio.js";

/**
 * Correções da venda em andamento: mudar quantidade, tirar item, tirar
 * pagamento.
 *
 * ### Corrigir é rotina, e por isso é fácil — mas nunca invisível
 *
 * Bipar duas vezes, pegar o pão errado, escolher débito em vez de crédito:
 * acontece dezenas de vezes por dia, e o operador precisa resolver sem chamar
 * ninguém. O que **diminui** a venda — tirar item, baixar quantidade — passa
 * pela política de alçada, porque é também a porta do desvio clássico
 * (registrar, cobrar, tirar o item depois). O papel de fábrica do operador tem
 * a permissão; a loja que quiser supervisor nisso a retira do papel, e o caixa
 * passa a pedir o PIN dele. Em qualquer caso, fica registrado.
 *
 * Aumentar quantidade não pede nada: é o mesmo que bipar de novo.
 */

export interface EntradaAlterarQuantidade {
  readonly vendaId: Identificador;
  readonly operadorId: Identificador;
  readonly numeroItem: number;
  readonly quantidade: Quantidade;
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
}

export interface EntradaRemoverItem {
  readonly vendaId: Identificador;
  readonly operadorId: Identificador;
  readonly numeroItem: number;
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
}

export interface EntradaRemoverPagamento {
  readonly vendaId: Identificador;
  readonly operadorId: Identificador;
  /** Posição na lista de pagamentos, a partir de zero. */
  readonly indice: number;
}

export class AlterarQuantidadeItem {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
    private readonly autorizar: AutorizarOperacao,
  ) {}

  async executar(entrada: EntradaAlterarQuantidade): Promise<Result<Venda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();
      const item = venda.encontrarItem(entrada.numeroItem);
      if (item === undefined) return err(itemNaoEncontrado(entrada.numeroItem));

      // A quantidade pode chegar em gramas para item vendido por quilo.
      const convertida = entrada.quantidade.converterMedida(
        item.quantidade.unidade.codigo,
      );
      if (convertida.isErr()) return err(convertida.error);

      const nova = convertida.unwrap();
      const anterior = item.quantidade;
      const diminui = nova.milesimos < anterior.milesimos;

      let autorizacao: Autorizacao = { autorizadoPorId: undefined };

      if (diminui) {
        const decisao = await this.autorizar.executar(repositorios, {
          solicitanteId: entrada.operadorId,
          acao: { tipo: "REMOVER_ITEM" },
          descricao: `Reduzir ${item.descricao} de ${anterior.formatar()} para ${nova.formatar()} na venda ${String(venda.numero)}`,
          credencialSupervisor: entrada.credencialSupervisor,
        });

        if (decisao.isErr()) return err(decisao.error);
        autorizacao = decisao.unwrap();
      }

      const alterada = venda.alterarQuantidadeItem(entrada.numeroItem, nova);
      if (alterada.isErr()) return err(alterada.error);

      if (diminui) {
        await auditar(repositorios, this.geradorId, {
          ocorridoEm: this.relogio.agora(),
          acao: "QUANTIDADE_REDUZIDA",
          usuarioId: entrada.operadorId,
          autorizadoPorId: autorizacao.autorizadoPorId,
          descricao: `${item.descricao}: de ${anterior.formatar()} para ${nova.formatar()} na venda ${String(venda.numero)}`,
          entidade: "venda",
          entidadeId: venda.id,
          dados: {
            numeroItem: entrada.numeroItem,
            de: anterior.milesimos.toString(),
            para: nova.milesimos.toString(),
          },
        });
      }

      await repositorios.vendas.salvar(venda);

      return ok(venda);
    });
  }
}

export class RemoverItem {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
    private readonly autorizar: AutorizarOperacao,
  ) {}

  async executar(entrada: EntradaRemoverItem): Promise<Result<Venda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();
      const item = venda.encontrarItem(entrada.numeroItem);
      if (item === undefined) return err(itemNaoEncontrado(entrada.numeroItem));

      const descricao = descreverItem(item);
      const valor = item.totalAposDescontoProprio;

      const autorizacao = await this.autorizar.executar(repositorios, {
        solicitanteId: entrada.operadorId,
        acao: { tipo: "REMOVER_ITEM" },
        descricao: `Remover ${descricao} da venda ${String(venda.numero)}`,
        credencialSupervisor: entrada.credencialSupervisor,
      });

      if (autorizacao.isErr()) return err(autorizacao.error);

      const removido = venda.removerItem(entrada.numeroItem);
      if (removido.isErr()) return err(removido.error);

      await registrarRemocao(repositorios, this.geradorId, {
        ocorridoEm: this.relogio.agora(),
        acao: "ITEM_REMOVIDO",
        usuarioId: entrada.operadorId,
        autorizadoPorId: autorizacao.unwrap().autorizadoPorId,
        descricao: `Removido ${descricao}, ${valor.formatar()}, da venda ${String(venda.numero)}`,
        venda,
        dados: { numeroItem: entrada.numeroItem, valor: valor.centavos.toString() },
      });

      await repositorios.vendas.salvar(venda);

      return ok(venda);
    });
  }
}

/**
 * Tira um pagamento que ainda não fechou a venda.
 *
 * O caso é o operador que tocou em "débito" quando o cliente pagou no crédito.
 * Não passa por alçada — nenhum dinheiro sai da gaveta, e a venda volta a
 * dever o valor —, mas fica registrado: um Pix registrado e depois retirado é
 * exatamente o que se quer poder perguntar depois.
 */
export class RemoverPagamento {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async executar(entrada: EntradaRemoverPagamento): Promise<Result<Venda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();
      const pagamento = venda.pagamentos[entrada.indice];

      const removido = venda.removerPagamento(entrada.indice);
      if (removido.isErr()) return err(removido.error);

      /* v8 ignore next -- inalcançável: a venda recusou índice fora da lista */
      if (pagamento === undefined) return err(itemNaoEncontrado(entrada.indice));

      await registrarRemocao(repositorios, this.geradorId, {
        ocorridoEm: this.relogio.agora(),
        acao: "PAGAMENTO_REMOVIDO",
        usuarioId: entrada.operadorId,
        autorizadoPorId: undefined,
        descricao: `Retirado pagamento de ${pagamento.valor.formatar()} em ${pagamento.forma.descricao} da venda ${String(venda.numero)}`,
        venda,
        dados: {
          forma: pagamento.forma.codigo,
          valor: pagamento.valor.centavos.toString(),
        },
      });

      await repositorios.vendas.salvar(venda);

      return ok(venda);
    });
  }
}

function itemNaoEncontrado(numero: number): ErroValidacao {
  return new ErroValidacao("VENDA_ITEM_NAO_ENCONTRADO", "Item não encontrado na venda.", {
    numero,
  });
}

async function registrarRemocao(
  repositorios: Repositorios,
  geradorId: GeradorId,
  dados: {
    readonly ocorridoEm: Date;
    readonly acao: "ITEM_REMOVIDO" | "PAGAMENTO_REMOVIDO";
    readonly usuarioId: Identificador;
    readonly autorizadoPorId: Identificador | undefined;
    readonly descricao: string;
    readonly venda: Venda;
    readonly dados: Readonly<Record<string, string | number>>;
  },
): Promise<void> {
  await auditar(repositorios, geradorId, {
    ocorridoEm: dados.ocorridoEm,
    acao: dados.acao,
    usuarioId: dados.usuarioId,
    autorizadoPorId: dados.autorizadoPorId,
    descricao: dados.descricao,
    entidade: "venda",
    entidadeId: dados.venda.id,
    dados: dados.dados,
  });
}
