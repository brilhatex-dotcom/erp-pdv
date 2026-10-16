import {
  CODIGOS_FORMA_PAGAMENTO,
  Dinheiro,
  type DomainError,
  err,
  ErroRegraNegocio,
  type Identificador,
  MovimentoEstoque,
  ok,
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
  CredencialSupervisor,
} from "../acesso/AutorizarOperacao.js";
import { carregarVenda, resumoParaCaixa } from "./apoio.js";

export interface EntradaCancelarVenda {
  readonly vendaId: Identificador;
  readonly operadorId: Identificador;
  readonly motivo: string;
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
}

/** O que o operador precisa fazer com as mãos depois do cancelamento. */
export interface EstornoAoCliente {
  readonly forma: string;
  readonly valor: Dinheiro;
}

export interface SaidaCancelarVenda {
  readonly venda: Venda;
  /** Era venda concluída: estoque, caixa e fiado foram estornados. */
  readonly estornada: boolean;
  /**
   * Valores a devolver ao cliente, por forma.
   *
   * O sistema estorna o **registro**; o dinheiro na mão do cliente, o Pix e o
   * cartão quem estorna é o operador — na gaveta, no aplicativo do banco e na
   * maquininha. A tela mostra esta lista para que nada fique esquecido.
   */
  readonly estornos: readonly EstornoAoCliente[];
}

/**
 * Cancela uma venda — aberta ou concluída.
 *
 * ### Venda aberta: descartar
 *
 * O cliente desistiu antes de pagar. Nada saiu do estoque nem entrou no caixa,
 * então não há estorno. Mas descartar uma venda com itens é o mesmo que tirar
 * todos eles, e por isso passa pela mesma alçada de "tirar item".
 *
 * ### Venda concluída: cancelar e estornar tudo, na mesma transação
 *
 * Exige a permissão de cancelar e cabe na janela de tempo do papel (o
 * supervisor, por padrão, até 30 minutos depois). Estorna o estoque, o caixa e
 * o fiado juntos — metade estornada é a mercadoria de volta na prateleira com
 * o dinheiro ainda contado na gaveta.
 *
 * Só enquanto o caixa da venda está aberto. Depois do fechamento o turno foi
 * conferido; mexer nele mudaria uma conferência que já foi assinada. O caminho
 * do dia seguinte é a **devolução**, que entra no caixa de hoje.
 */
export class CancelarVenda {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
    private readonly autorizar: AutorizarOperacao,
  ) {}

  async executar(
    entrada: EntradaCancelarVenda,
  ): Promise<Result<SaidaCancelarVenda, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();

      return venda.status === "FINALIZADA"
        ? this.#cancelarConcluida(repositorios, venda, entrada)
        : this.#descartarAberta(repositorios, venda, entrada);
    });
  }

  async #descartarAberta(
    repositorios: Repositorios,
    venda: Venda,
    entrada: EntradaCancelarVenda,
  ): Promise<Result<SaidaCancelarVenda, DomainError>> {
    let autorizadoPorId: Identificador | undefined;

    if (!venda.estaVazia && venda.status === "ABERTA") {
      const autorizacao = await this.autorizar.executar(repositorios, {
        solicitanteId: entrada.operadorId,
        acao: { tipo: "REMOVER_ITEM" },
        descricao: `Descartar a venda ${String(venda.numero)} com ${String(venda.quantidadeItens)} item(ns)`,
        credencialSupervisor: entrada.credencialSupervisor,
      });

      if (autorizacao.isErr()) return err(autorizacao.error);
      autorizadoPorId = autorizacao.unwrap().autorizadoPorId;
    }

    const agora = this.relogio.agora();

    const cancelada = venda.cancelar({
      motivo: entrada.motivo,
      solicitadoPorId: entrada.operadorId,
      autorizadoPorId,
      agora,
    });

    if (cancelada.isErr()) return err(cancelada.error);

    // Pagamento registrado numa venda que não fechou ainda pode ter passado na
    // maquininha ou caído no Pix. A venda não guarda dinheiro nenhum, mas o
    // cliente pode ter pago — e é o operador quem devolve.
    const estornos = estornosPorForma(venda, false);

    if (!venda.estaVazia) {
      await auditar(repositorios, this.geradorId, {
        ocorridoEm: agora,
        acao: "VENDA_DESCARTADA",
        usuarioId: entrada.operadorId,
        autorizadoPorId,
        descricao: `Venda ${String(venda.numero)} descartada antes de concluir (${String(venda.quantidadeItens)} item(ns), ${venda.total.formatar()}): ${entrada.motivo.trim()}`,
        entidade: "venda",
        entidadeId: venda.id,
        dados: { total: venda.total.centavos.toString(), itens: venda.quantidadeItens },
      });
    }

    await repositorios.vendas.salvar(venda);

    return ok({ venda, estornada: false, estornos });
  }

  async #cancelarConcluida(
    repositorios: Repositorios,
    venda: Venda,
    entrada: EntradaCancelarVenda,
  ): Promise<Result<SaidaCancelarVenda, DomainError>> {
    const sessao = await repositorios.caixas.porId(venda.sessaoCaixaId);

    if (sessao?.estaAberta !== true) {
      return err(
        new ErroRegraNegocio(
          "VENDA_DE_CAIXA_FECHADO",
          "Esta venda é de um caixa que já foi fechado. Para devolver o dinheiro ao cliente, faça uma devolução.",
          { vendaId: venda.id.valor },
        ),
      );
    }

    const devolucoes = await repositorios.devolucoes.porVenda(venda.id);

    if (devolucoes.length > 0) {
      return err(
        new ErroRegraNegocio(
          "VENDA_COM_DEVOLUCAO",
          "Esta venda já tem devolução registrada. Para o restante, faça outra devolução em vez de cancelar.",
          { vendaId: venda.id.valor },
        ),
      );
    }

    const agora = this.relogio.agora();
    /* v8 ignore next -- inalcançável: venda finalizada sempre tem a data */
    const finalizadaEm = venda.finalizadaEm ?? agora;
    const minutos = Math.floor((agora.getTime() - finalizadaEm.getTime()) / 60_000);

    const autorizacao = await this.autorizar.executar(repositorios, {
      solicitanteId: entrada.operadorId,
      acao: { tipo: "CANCELAR_VENDA", minutosDesdeFinalizacao: minutos },
      descricao: `Cancelar a venda ${String(venda.numero)} de ${venda.total.formatar()}`,
      credencialSupervisor: entrada.credencialSupervisor,
    });

    if (autorizacao.isErr()) return err(autorizacao.error);

    const { autorizadoPorId } = autorizacao.unwrap();

    // O fiado primeiro: é o único passo que pode recusar por um motivo que o
    // operador precisa resolver antes (o cliente já pagou parte da conta).
    const titulos = await repositorios.titulos.porDocumento(venda.id);

    for (const titulo of titulos) {
      if (titulo.estaCancelado) continue;

      const cancelado = titulo.cancelar(agora, `Venda ${String(venda.numero)} cancelada`);

      if (cancelado.isErr()) {
        return err(
          new ErroRegraNegocio(
            "VENDA_COM_FIADO_RECEBIDO",
            "O cliente já pagou parte do fiado desta venda. Estorne o recebimento no financeiro antes de cancelar.",
            { tituloId: titulo.id.valor },
          ),
        );
      }
    }

    const cancelada = venda.cancelar({
      motivo: entrada.motivo,
      solicitadoPorId: entrada.operadorId,
      autorizadoPorId,
      agora,
    });

    if (cancelada.isErr()) return err(cancelada.error);

    for (const item of venda.itens) {
      const movimento = MovimentoEstoque.criar({
        id: this.geradorId.proximo(),
        produtoId: item.produtoId,
        tipo: "ESTORNO_VENDA",
        quantidade: item.quantidade,
        origem: { tipo: "VENDA", documentoId: venda.id },
        usuarioId: entrada.operadorId,
        ocorridoEm: agora,
        observacao: `Cancelamento da venda ${String(venda.numero)}: ${entrada.motivo.trim()}`,
      });

      /* v8 ignore next -- inalcançável: item de venda tem quantidade positiva */
      if (movimento.isErr()) return err(movimento.error);

      await repositorios.estoque.registrar(movimento.unwrap());
    }

    const estorno = sessao.registrarCancelamento(resumoParaCaixa(venda));
    /* v8 ignore next -- inalcançável: a sessão foi conferida como aberta */
    if (estorno.isErr()) return err(estorno.error);

    await auditar(repositorios, this.geradorId, {
      ocorridoEm: agora,
      acao: "VENDA_CANCELADA",
      usuarioId: entrada.operadorId,
      autorizadoPorId,
      descricao: `Venda ${String(venda.numero)} de ${venda.total.formatar()} cancelada ${String(minutos)} min depois de concluída: ${entrada.motivo.trim()}`,
      entidade: "venda",
      entidadeId: venda.id,
      dados: { total: venda.total.centavos.toString(), minutos },
    });

    await repositorios.vendas.salvar(venda);
    await repositorios.caixas.salvar(sessao);
    for (const titulo of titulos) await repositorios.titulos.salvar(titulo);
    await repositorios.outbox.enfileirar(venda.coletarEventos());

    return ok({ venda, estornada: true, estornos: estornosPorForma(venda, true) });
  }
}

/**
 * Quanto devolver ao cliente, forma a forma.
 *
 * Dinheiro devolve o que ficou na gaveta — o pago menos o troco que já saiu.
 * Fiado não devolve nada: a dívida é que some. Na venda descartada, o troco
 * ainda não saiu, então volta o valor registrado.
 */
function estornosPorForma(venda: Venda, concluida: boolean): readonly EstornoAoCliente[] {
  return CODIGOS_FORMA_PAGAMENTO.flatMap((codigo): EstornoAoCliente[] => {
    if (codigo === "CREDIARIO") return [];

    const pagos = venda.pagamentos.filter(
      (pagamento) => pagamento.forma.codigo === codigo,
    );
    const [primeiro] = pagos;
    if (primeiro === undefined) return [];

    let valor = pagos.reduce(
      (soma, pagamento) => soma.somar(pagamento.valor),
      Dinheiro.zero(),
    );

    if (codigo === "DINHEIRO" && concluida) valor = valor.subtrair(venda.troco);

    return valor.ehPositivo() ? [{ forma: primeiro.forma.descricao, valor }] : [];
  });
}
