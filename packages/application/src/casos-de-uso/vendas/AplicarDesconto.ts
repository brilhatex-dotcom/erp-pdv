import {
  type Dinheiro,
  type DomainError,
  err,
  ErroValidacao,
  type Identificador,
  ok,
  type Result,
  type Venda,
} from "@erp/domain";

import { auditar } from "../../auditoria/RegistroAuditoria.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type {
  AutorizarOperacao,
  CredencialSupervisor,
} from "../acesso/AutorizarOperacao.js";
import { carregarVenda, formatarPercentual } from "./apoio.js";

/** Onde o desconto incide. */
export type AlvoDesconto =
  { readonly tipo: "VENDA" } | { readonly tipo: "ITEM"; readonly numero: number };

export interface EntradaAplicarDesconto {
  readonly vendaId: Identificador;
  readonly operadorId: Identificador;
  readonly alvo: AlvoDesconto;
  /**
   * Em reais **ou** em percentual — um dos dois. O balcão pensa dos dois
   * jeitos ("dez por cento" e "deixa por vinte reais"), e converter de cabeça é
   * onde o operador erra.
   */
  readonly valor?: Dinheiro | undefined;
  /** Pontos-base: `1000` é 10%. */
  readonly percentualBps?: number | undefined;
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
}

/**
 * Dá desconto num item ou na venda inteira, dentro da alçada de quem pede.
 *
 * O limite é percentual e vem do papel (operador 5% no item, 3% na venda, por
 * padrão). Acima dele o sistema **pede** o gerente em vez de negar: o gerente
 * digita matrícula e PIN no próprio caixa, a venda continua em nome do
 * operador, e o registro guarda os dois nomes.
 *
 * O percentual que a política confere é medido com arredondamento **para
 * cima** (`Dinheiro.proporcaoEmBps`): 5,004% não passa por um teto de 5%. Por
 * isso o desconto pedido em percentual é **truncado** no centavo
 * (`Dinheiro.percentualSemExceder`): 5% de R$ 12,50 são R$ 0,62, e medido de
 * volta cabe nos 5% que o operador pode dar sozinho.
 *
 * Desconto zero é tirar o desconto — não pede autorização nem se audita,
 * porque devolve o preço cheio e não tira nada de ninguém.
 */
export class AplicarDesconto {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
    private readonly autorizar: AutorizarOperacao,
  ) {}

  async executar(entrada: EntradaAplicarDesconto): Promise<Result<Venda, DomainError>> {
    if ((entrada.valor === undefined) === (entrada.percentualBps === undefined)) {
      return err(
        new ErroValidacao(
          "DESCONTO_FORMATO",
          "Informe o desconto em reais ou em percentual.",
        ),
      );
    }

    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();
      const alvo = descreverAlvo(venda, entrada.alvo);
      if (alvo.isErr()) return err(alvo.error);

      const { base, texto } = alvo.unwrap();
      const valor =
        entrada.valor ?? base.percentualSemExceder(entrada.percentualBps ?? 0);

      // Conferido antes da alçada: pedir o PIN do gerente para um desconto que
      // a venda vai recusar faria o gerente atravessar a loja à toa.
      if (valor.maiorQue(base)) {
        return err(
          new ErroValidacao(
            "DESCONTO_MAIOR_QUE_VALOR",
            `O desconto não pode passar de ${base.formatar()}.`,
            { desconto: valor.centavos.toString(), base: base.centavos.toString() },
          ),
        );
      }

      const percentual = valor.proporcaoEmBps(base);
      let autorizadoPorId: Identificador | undefined;

      if (valor.ehPositivo()) {
        const autorizacao = await this.autorizar.executar(repositorios, {
          solicitanteId: entrada.operadorId,
          acao:
            entrada.alvo.tipo === "ITEM"
              ? { tipo: "DESCONTO_ITEM", percentualBps: percentual }
              : { tipo: "DESCONTO_VENDA", percentualBps: percentual },
          descricao: `Desconto de ${valor.formatar()} (${formatarPercentual(percentual)}) ${texto} da venda ${String(venda.numero)}`,
          credencialSupervisor: entrada.credencialSupervisor,
        });

        if (autorizacao.isErr()) return err(autorizacao.error);
        autorizadoPorId = autorizacao.unwrap().autorizadoPorId;
      }

      const aplicado =
        entrada.alvo.tipo === "ITEM"
          ? venda.aplicarDescontoItem(entrada.alvo.numero, valor)
          : venda.aplicarDescontoVenda(valor);

      /* v8 ignore next -- inalcançável: valor e alvo conferidos acima */
      if (aplicado.isErr()) return err(aplicado.error);

      if (valor.ehPositivo()) {
        await auditar(repositorios, this.geradorId, {
          ocorridoEm: this.relogio.agora(),
          acao: entrada.alvo.tipo === "ITEM" ? "DESCONTO_ITEM" : "DESCONTO_VENDA",
          usuarioId: entrada.operadorId,
          autorizadoPorId,
          descricao: `Desconto de ${valor.formatar()} (${formatarPercentual(percentual)}) ${texto} da venda ${String(venda.numero)}`,
          entidade: "venda",
          entidadeId: venda.id,
          dados: {
            valor: valor.centavos.toString(),
            percentualBps: percentual,
            ...(entrada.alvo.tipo === "ITEM" ? { numeroItem: entrada.alvo.numero } : {}),
          },
        });
      }

      await repositorios.vendas.salvar(venda);

      return ok(venda);
    });
  }
}

/** Sobre quanto o desconto incide, e como descrevê-lo para o dono. */
function descreverAlvo(
  venda: Venda,
  alvo: AlvoDesconto,
): Result<{ readonly base: Dinheiro; readonly texto: string }, DomainError> {
  if (alvo.tipo === "VENDA") {
    return ok({ base: venda.baseParaDescontoDaVenda, texto: "no total" });
  }

  const item = venda.encontrarItem(alvo.numero);

  if (item === undefined) {
    return err(
      new ErroValidacao("VENDA_ITEM_NAO_ENCONTRADO", "Item não encontrado na venda.", {
        numero: alvo.numero,
      }),
    );
  }

  return ok({
    base: item.totalBruto,
    texto: `em ${item.descricao} (item ${String(item.numero)})`,
  });
}
