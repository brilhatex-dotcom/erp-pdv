import {
  Devolucao,
  Dinheiro,
  type DomainError,
  err,
  ErroRegraNegocio,
  type FormaReembolso,
  type Identificador,
  type JaDevolvido,
  MovimentoEstoque,
  ok,
  type PedidoDeItemDevolvido,
  type Result,
  type SessaoCaixa,
  type Titulo,
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
import { carregarVenda } from "./apoio.js";

export interface EntradaRegistrarDevolucao {
  readonly vendaId: Identificador;
  /** Onde a devolução acontece — de que gaveta sai o dinheiro. */
  readonly estacaoId: Identificador;
  readonly operadorId: Identificador;
  readonly itens: readonly PedidoDeItemDevolvido[];
  readonly formaReembolso: FormaReembolso;
  readonly motivo: string;
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
}

/**
 * Devolução de mercadoria — total ou parcial, ligada à venda original.
 *
 * Tudo numa transação: a devolução, o estoque (de volta à prateleira, ou para
 * as perdas quando o produto voltou estragado), o caixa de **hoje** (quando o
 * dinheiro sai da gaveta) e o fiado (quando a devolução abate a dívida). Uma
 * parte sem a outra é o iogurte de volta à geladeira com o dinheiro ainda
 * contado na gaveta — ou o contrário.
 *
 * A permissão `venda:devolver` é conferida na rota, como as demais. O teto do
 * que sai **em dinheiro** é outra conversa, conferida aqui: é a mesma alçada
 * de estorno em dinheiro do papel (o supervisor, por padrão, até R$ 200,00), e
 * acima dela o gerente libera com o PIN.
 */
export class RegistrarDevolucao {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
    private readonly autorizar: AutorizarOperacao,
  ) {}

  async executar(
    entrada: EntradaRegistrarDevolucao,
  ): Promise<Result<Devolucao, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();
      const anteriores = await repositorios.devolucoes.porVenda(venda.id);
      const sessao = await repositorios.caixas.abertaNaEstacao(entrada.estacaoId);

      if (entrada.formaReembolso === "DINHEIRO" && sessao === undefined) {
        return err(
          new ErroRegraNegocio(
            "DEVOLUCAO_SEM_CAIXA",
            "Abra o caixa para devolver em dinheiro: o valor sai da gaveta.",
          ),
        );
      }

      const agora = this.relogio.agora();

      const registrada = Devolucao.registrar({
        id: this.geradorId.proximo(),
        venda,
        itens: entrada.itens,
        jaDevolvido: somarDevolvido(anteriores),
        jaReembolsadoAVista: somarAVista(anteriores),
        formaReembolso: entrada.formaReembolso,
        motivo: entrada.motivo,
        usuarioId: entrada.operadorId,
        sessaoCaixaId: sessao?.id,
        agora,
      });

      if (registrada.isErr()) return err(registrada.error);

      const calculada = registrada.unwrap();
      let autorizadoPorId: Identificador | undefined;

      if (calculada.saiDaGaveta) {
        const autorizacao = await this.autorizar.executar(repositorios, {
          solicitanteId: entrada.operadorId,
          acao: { tipo: "ESTORNO_EM_DINHEIRO", valor: calculada.valorTotal },
          descricao: `Devolução de ${calculada.valorTotal.formatar()} em dinheiro da venda ${String(venda.numero)}`,
          credencialSupervisor: entrada.credencialSupervisor,
        });

        if (autorizacao.isErr()) return err(autorizacao.error);
        autorizadoPorId = autorizacao.unwrap().autorizadoPorId;
      }

      // Refeita com quem autorizou: o agregado é imutável depois de criado, e o
      // nome de quem liberou faz parte do fato, não de uma anotação posterior.
      const devolucao =
        autorizadoPorId === undefined
          ? calculada
          : Devolucao.registrar({
              id: calculada.id,
              venda,
              itens: entrada.itens,
              jaDevolvido: somarDevolvido(anteriores),
              jaReembolsadoAVista: somarAVista(anteriores),
              formaReembolso: entrada.formaReembolso,
              motivo: entrada.motivo,
              usuarioId: entrada.operadorId,
              autorizadoPorId,
              sessaoCaixaId: sessao?.id,
              agora,
            }).unwrap();

      const caixa = registrarNoCaixa(sessao, devolucao);
      if (caixa.isErr()) return err(caixa.error);

      const titulos =
        devolucao.formaReembolso === "ABATER_FIADO"
          ? await this.#abaterFiado(repositorios, venda, devolucao, entrada.operadorId)
          : ok<readonly Titulo[], DomainError>([]);

      if (titulos.isErr()) return err(titulos.error);

      await this.#movimentarEstoque(repositorios, venda, devolucao, entrada.operadorId);

      await auditar(repositorios, this.geradorId, {
        ocorridoEm: agora,
        acao: "DEVOLUCAO",
        usuarioId: entrada.operadorId,
        autorizadoPorId,
        descricao: `Devolução de ${devolucao.valorTotal.formatar()} da venda ${String(venda.numero)} (${descreverReembolso(devolucao.formaReembolso)}): ${devolucao.motivo}`,
        entidade: "devolucao",
        entidadeId: devolucao.id,
        dados: {
          vendaId: venda.id.valor,
          valor: devolucao.valorTotal.centavos.toString(),
          forma: devolucao.formaReembolso,
        },
      });

      await repositorios.devolucoes.salvar(devolucao);
      if (sessao !== undefined) await repositorios.caixas.salvar(sessao);
      for (const titulo of titulos.unwrap()) await repositorios.titulos.salvar(titulo);
      await repositorios.outbox.enfileirar(devolucao.coletarEventos());

      return ok(devolucao);
    });
  }

  /**
   * Cada item volta ao estoque; o que voltou estragado sai em seguida como
   * perda.
   *
   * Dois movimentos, e não nenhum, para o produto avariado: o histórico precisa
   * dizer que ele voltou **e** que foi para o lixo. Sem o segundo, o relatório
   * de perdas não enxergaria o iogurte aberto; sem o primeiro, o extrato do
   * produto teria uma perda de mercadoria que, pelo registro, nunca esteve na
   * loja.
   */
  async #movimentarEstoque(
    repositorios: Repositorios,
    venda: Venda,
    devolucao: Devolucao,
    usuarioId: Identificador,
  ): Promise<void> {
    const origem = { tipo: "DEVOLUCAO" as const, documentoId: devolucao.id };
    const observacao = `Devolução da venda ${String(venda.numero)}: ${devolucao.motivo}`;

    for (const item of devolucao.itens) {
      await repositorios.estoque.registrar(
        MovimentoEstoque.criar({
          id: this.geradorId.proximo(),
          produtoId: item.produtoId,
          tipo: "DEVOLUCAO_CLIENTE",
          quantidade: item.quantidade,
          origem,
          usuarioId,
          ocorridoEm: devolucao.ocorridaEm,
          observacao,
        }).unwrap(),
      );

      if (item.destino === "PERDA") {
        await repositorios.estoque.registrar(
          MovimentoEstoque.criar({
            id: this.geradorId.proximo(),
            produtoId: item.produtoId,
            tipo: "PERDA",
            quantidade: item.quantidade,
            origem,
            usuarioId,
            ocorridoEm: devolucao.ocorridaEm,
            observacao,
          }).unwrap(),
        );
      }
    }
  }

  /**
   * Abate a dívida da venda, do título que vence primeiro para o último.
   *
   * Registrado como baixa de forma `DEVOLUCAO`: reduz o que o cliente deve sem
   * fingir que entrou dinheiro — e o relatório de recebimentos deixa essa
   * forma de fora, para não contar como receita uma mercadoria que voltou.
   */
  async #abaterFiado(
    repositorios: Repositorios,
    venda: Venda,
    devolucao: Devolucao,
    usuarioId: Identificador,
  ): Promise<Result<readonly Titulo[], DomainError>> {
    const titulos = [...(await repositorios.titulos.porDocumento(venda.id))]
      .filter((titulo) => !titulo.estaCancelado && titulo.saldo.ehPositivo())
      .sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime());

    const emAberto = titulos.reduce(
      (soma, titulo) => soma.somar(titulo.saldo),
      Dinheiro.zero(),
    );

    if (devolucao.valorTotal.maiorQue(emAberto)) {
      return err(
        new ErroRegraNegocio(
          "DEVOLUCAO_ACIMA_DO_FIADO",
          emAberto.ehPositivo()
            ? `O fiado desta venda tem só ${emAberto.formatar()} em aberto. Devolva o restante de outra forma.`
            : "O fiado desta venda já foi pago. Devolva o valor de outra forma.",
          { emAberto: emAberto.centavos.toString() },
        ),
      );
    }

    let restante = devolucao.valorTotal;
    const alterados: Titulo[] = [];

    for (const titulo of titulos) {
      if (!restante.ehPositivo()) break;

      const parte = restante.menorQue(titulo.saldo) ? restante : titulo.saldo;

      const baixa = titulo.registrarBaixa({
        id: this.geradorId.proximo(),
        valor: parte,
        ocorridaEm: devolucao.ocorridaEm,
        usuarioId,
        forma: "DEVOLUCAO",
        observacao: `Devolução de mercadoria da venda ${String(venda.numero)}`,
      });

      /* v8 ignore next -- inalcançável: parte positiva e dentro do saldo */
      if (baixa.isErr()) return err(baixa.error);

      restante = restante.subtrair(parte);
      alterados.push(titulo);
    }

    return ok(alterados);
  }
}

function registrarNoCaixa(
  sessao: SessaoCaixa | undefined,
  devolucao: Devolucao,
): Result<void, DomainError> {
  // Sem caixa aberto, só chega aqui o reembolso que não passa pela gaveta: ele
  // fica registrado na devolução, e o fechamento de hoje não tem o que somar.
  if (sessao === undefined) return ok(undefined);

  return sessao.registrarDevolucao({
    valor: devolucao.valorTotal,
    emDinheiro: devolucao.saiDaGaveta,
  });
}

/** O que já voltou de cada item, somando todas as devoluções anteriores. */
function somarDevolvido(
  anteriores: readonly Devolucao[],
): ReadonlyMap<number, JaDevolvido> {
  const total = new Map<number, JaDevolvido>();

  for (const devolucao of anteriores) {
    for (const item of devolucao.itens) {
      const atual = total.get(item.numeroItem) ?? {
        milesimos: 0n,
        valor: Dinheiro.zero(),
      };

      total.set(item.numeroItem, {
        milesimos: atual.milesimos + item.quantidade.milesimos,
        valor: atual.valor.somar(item.valor),
      });
    }
  }

  return total;
}

function somarAVista(anteriores: readonly Devolucao[]): Dinheiro {
  return anteriores
    .filter((devolucao) => devolucao.formaReembolso !== "ABATER_FIADO")
    .reduce((soma, devolucao) => soma.somar(devolucao.valorTotal), Dinheiro.zero());
}

function descreverReembolso(forma: FormaReembolso): string {
  switch (forma) {
    case "DINHEIRO":
      return "em dinheiro";
    case "PIX":
      return "por Pix";
    case "CARTAO":
      return "estorno no cartão";
    case "ABATER_FIADO":
      return "abatido do fiado";
  }
}
