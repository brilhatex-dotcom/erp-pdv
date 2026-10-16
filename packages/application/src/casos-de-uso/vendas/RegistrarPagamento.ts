import {
  type CodigoFormaPagamento,
  type ConfirmacaoPagamento,
  Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type Identificador,
  ok,
  type Pagamento,
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
import { carregarVenda, configuracaoDaLoja } from "./apoio.js";

export interface EntradaRegistrarPagamento {
  readonly vendaId: Identificador;
  /** Quem está no balcão — é quem pede a liberação do fiado acima do limite. */
  readonly operadorId: Identificador;
  readonly forma: CodigoFormaPagamento;
  readonly valor: Dinheiro;
  readonly autorizacao?: string | undefined;
  readonly parcelas?: number | undefined;
  /** Ausente é `MANUAL`: sem integração, quem confirma é o operador. */
  readonly confirmacao?: ConfirmacaoPagamento | undefined;
  /** Gerada pela estação: o reenvio não duplica o pagamento. */
  readonly chave?: string | undefined;
  /** Só na segunda tentativa, depois de `AUTORIZACAO_NECESSARIA`. */
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
  /**
   * `IMPORTACAO` remonta uma venda feita offline: o fiado dela já foi
   * entregue, e a conferência de limite não tem mais o que impedir.
   */
  readonly origem?: "BALCAO" | "IMPORTACAO" | undefined;
}

export interface SaidaRegistrarPagamento {
  readonly venda: Venda;
  readonly pagamento: Pagamento;
  readonly faltaPagar: Dinheiro;
  readonly troco: Dinheiro;
}

export interface OpcoesRegistrarPagamento {
  /**
   * Aceita pagamento `SIMULADA`. Só o modo treinamento liga isto (ADR-0026):
   * na operação real, um Pix "simulado" seria dinheiro que nunca entrou.
   */
  readonly permiteSimulacao: boolean;
}

/**
 * Registra um pagamento na venda.
 *
 * Devolve **quanto falta** e **quanto é de troco** junto com o pagamento: são
 * exatamente os dois números que a tela do PDV precisa mostrar em seguida, e
 * obrigá-la a uma segunda consulta acrescentaria latência no caminho onde o
 * operador está com o cliente esperando.
 *
 * ### Fiado: ligado na loja, autorizado no cliente
 *
 * Venda a prazo só sai se a loja usa fiado (configuração) **e** o cadastro do
 * cliente tem limite. Dentro do limite, o operador segue sozinho — é a
 * caderneta de sempre. Acima, o gerente libera com o PIN dele: quem define o
 * limite é quem responde pelo risco de não receber.
 */
export class RegistrarPagamento {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
    private readonly autorizar: AutorizarOperacao,
    private readonly opcoes: OpcoesRegistrarPagamento,
  ) {}

  async executar(
    entrada: EntradaRegistrarPagamento,
  ): Promise<Result<SaidaRegistrarPagamento, DomainError>> {
    if (entrada.confirmacao === "SIMULADA" && !this.opcoes.permiteSimulacao) {
      return err(
        new ErroRegraNegocio(
          "PAGAMENTO_SIMULADO_RECUSADO",
          "Pagamento simulado só existe no modo treinamento.",
        ),
      );
    }

    // Integração confirmaria por conta própria, do lado do servidor. Vindo do
    // navegador, "confirmado pela integração" é só uma afirmação — e aceitá-la
    // deixaria a tela marcar como conferido o que ninguém conferiu.
    if (entrada.confirmacao === "INTEGRACAO") {
      return err(
        new ErroRegraNegocio(
          "PAGAMENTO_INTEGRACAO_INDISPONIVEL",
          "Não há integração de pagamento configurada. Registre o pagamento como manual.",
        ),
      );
    }

    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();

      const jaRegistrado = repetido(venda, entrada);

      if (jaRegistrado !== undefined) {
        return ok({
          venda,
          pagamento: jaRegistrado,
          faltaPagar: venda.faltaPagar,
          troco: venda.troco,
        });
      }

      if (entrada.forma === "CREDIARIO" && entrada.origem !== "IMPORTACAO") {
        const fiado = await this.#conferirFiado(repositorios, venda, entrada);
        if (fiado.isErr()) return err(fiado.error);
      }

      const pagamento = venda.registrarPagamento(entrada.forma, entrada.valor, {
        autorizacao: entrada.autorizacao,
        parcelas: entrada.parcelas,
        confirmacao: entrada.confirmacao,
        chave: entrada.chave,
      });

      if (pagamento.isErr()) return err(pagamento.error);

      await repositorios.vendas.salvar(venda);

      return ok({
        venda,
        pagamento: pagamento.unwrap(),
        faltaPagar: venda.faltaPagar,
        troco: venda.troco,
      });
    });
  }

  async #conferirFiado(
    repositorios: Repositorios,
    venda: Venda,
    entrada: EntradaRegistrarPagamento,
  ): Promise<Result<void, DomainError>> {
    const configuracao = await configuracaoDaLoja(repositorios, this.geradorId);

    if (!configuracao.temRecurso("FIADO")) {
      return err(
        new ErroRegraNegocio(
          "FIADO_DESLIGADO",
          "Esta loja não vende fiado. O gerente pode ligar o fiado na configuração.",
        ),
      );
    }

    // Sem cliente, quem recusa é a venda, com a mensagem dela.
    const clienteId = venda.clienteId;
    if (clienteId === undefined) return ok(undefined);

    const cliente = await repositorios.clientes.porId(clienteId);

    if (cliente === undefined) {
      return err(
        new ErroNaoEncontrado(
          "CLIENTE_NAO_ENCONTRADO",
          "O cliente desta venda não foi encontrado.",
          { clienteId: clienteId.valor },
        ),
      );
    }

    if (!cliente.vendeAPrazo) {
      return err(
        new ErroRegraNegocio(
          "CLIENTE_SEM_FIADO",
          `O cadastro de ${cliente.exibicao} não tem limite de fiado. O gerente pode definir um limite na retaguarda.`,
          { clienteId: clienteId.valor },
        ),
      );
    }

    const emAberto = await repositorios.titulos.emAbertoDaContraparte(
      clienteId,
      "RECEBER",
    );
    const devido = emAberto.reduce(
      (soma, titulo) => soma.somar(titulo.saldo),
      Dinheiro.zero(),
    );
    const nestaVenda = venda.valorAReceber;
    const disponivel = cliente.creditoDisponivel(devido.somar(nestaVenda));

    if (!entrada.valor.maiorQue(disponivel)) return ok(undefined);

    const excedente = entrada.valor.subtrair(disponivel);

    const autorizacao = await this.autorizar.executar(repositorios, {
      solicitanteId: entrada.operadorId,
      acao: { tipo: "FIADO_ACIMA_DO_LIMITE", excedente },
      descricao: `Fiado de ${entrada.valor.formatar()} para ${cliente.exibicao}, ${excedente.formatar()} acima do limite`,
      credencialSupervisor: entrada.credencialSupervisor,
    });

    if (autorizacao.isErr()) return err(autorizacao.error);

    await auditar(repositorios, this.geradorId, {
      ocorridoEm: this.relogio.agora(),
      acao: "FIADO_ACIMA_DO_LIMITE",
      usuarioId: entrada.operadorId,
      autorizadoPorId: autorizacao.unwrap().autorizadoPorId,
      descricao: `Fiado de ${entrada.valor.formatar()} para ${cliente.exibicao} na venda ${String(venda.numero)}: ${excedente.formatar()} acima do limite (disponível: ${disponivel.formatar()})`,
      entidade: "venda",
      entidadeId: venda.id,
      dados: {
        clienteId: clienteId.valor,
        excedente: excedente.centavos.toString(),
        disponivel: disponivel.centavos.toString(),
      },
    });

    return ok(undefined);
  }
}

/**
 * O pagamento que esta chave já registrou, se houver.
 *
 * Conferido **antes** do fiado: o reenvio de um pagamento a prazo já aceito
 * pediria de novo a liberação do gerente — e a resposta seria a de um
 * pagamento novo, não a do que já está na venda.
 */
function repetido(
  venda: Venda,
  entrada: EntradaRegistrarPagamento,
): Pagamento | undefined {
  const chave = entrada.chave?.trim();
  if (chave === undefined || chave === "") return undefined;

  const existente = venda.pagamentos.find((pagamento) => pagamento.chave === chave);

  return existente?.mesmoConteudoQue(entrada.forma, entrada.valor) === true
    ? existente
    : undefined;
}
