import {
  Dinheiro,
  type DomainError,
  err,
  ErroNaoEncontrado,
  ErroValidacao,
  type Identificador,
  montarPlanoDeParcelas,
  ok,
  type Result,
  type TipoTitulo,
  Titulo,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";

/**
 * Lança uma conta a pagar ou a receber na mão.
 *
 * É o aluguel, a luz, o contador, o acerto combinado com o cliente fora do
 * balcão. Sem isto, o financeiro só enxergaria o que nasce de venda — e o
 * lojista continuaria com metade das contas num caderno à parte, que é
 * exatamente o problema que o módulo veio resolver.
 *
 * ### O nome da contraparte é obrigatório; o cadastro dela, não
 *
 * A conta de luz não tem fornecedor cadastrado. Exigir o cadastro faria o
 * lojista registrar a concessionária para lançar uma despesa — atrito puro,
 * numa tela que ele usa todo mês. Quando o `contraparteId` vem, o nome é lido
 * do cadastro; quando não vem, ele é digitado.
 *
 * ### Parcela aqui é a compra a prazo do fornecedor
 *
 * `parcelas: 3` numa conta a pagar é a duplicata em três vezes que veio com a
 * mercadoria. O mesmo `montarPlanoDeParcelas` da venda cuida do centavo da
 * divisão — não há duas contas diferentes no sistema para o mesmo problema.
 */

export interface EntradaLancarTitulo {
  readonly tipo: TipoTitulo;
  readonly contraparteId?: Identificador | undefined;
  /** Ignorado quando `contraparteId` vem: o nome sai do cadastro. */
  readonly contraparteNome?: string | undefined;
  readonly valorCentavos: bigint;
  readonly vencimento: Date;
  readonly parcelas?: number | undefined;
  readonly diasEntreParcelas?: number | undefined;
  readonly descricao?: string | undefined;
}

export class LancarTitulo {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly relogio: Relogio,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaLancarTitulo,
  ): Promise<Result<readonly Titulo[], DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const valor = Dinheiro.deCentavos(entrada.valorCentavos);

      if (valor.isErr()) return err(valor.error);

      const nome = await nomeDaContraparte(repositorios, entrada);

      if (nome.isErr()) return err(nome.error);

      const agora = this.relogio.agora();

      // O vencimento é informado, e não calculado: quem lança a conta de luz já
      // tem o boleto na mão com a data impressa. O plano existe só para dividir
      // o valor e espaçar as parcelas seguintes.
      const plano = montarPlanoDeParcelas({
        total: valor.unwrap(),
        parcelas: entrada.parcelas ?? 1,
        emitidoEm: entrada.vencimento,
        diasParaPrimeiroVencimento: 0,
        diasEntreParcelas: entrada.diasEntreParcelas,
      });

      if (plano.isErr()) return err(plano.error);

      const parcelas = plano.unwrap();
      const criados: Titulo[] = [];
      const problemas: ErroValidacao[] = [];

      for (const parcela of parcelas) {
        const titulo = Titulo.criar({
          id: this.geradorId.proximo(),
          tipo: entrada.tipo,
          origem: "MANUAL",
          contraparteId: entrada.contraparteId,
          contraparteNome: nome.unwrap(),
          valorOriginal: parcela.valor,
          vencimento: parcela.vencimento,
          emitidoEm: agora,
          parcela:
            parcelas.length > 1 ? { numero: parcela.numero, de: parcela.de } : undefined,
          descricao: entrada.descricao,
        });

        if (titulo.isErr()) {
          problemas.push(...titulo.error);
          break;
        }

        criados.push(titulo.unwrap());
      }

      if (problemas.length > 0) return err(agregarErros(problemas));

      for (const titulo of criados) await repositorios.titulos.salvar(titulo);

      return ok(criados);
    });
  }
}

/**
 * Descobre em nome de quem a conta fica.
 *
 * Com `contraparteId`, o nome vem do cadastro — e não do que a tela mandou:
 * confiar no texto do cliente deixaria o título gravado com um nome que não é o
 * do cadastro, e a conciliação com o histórico do cliente pararia de fechar.
 *
 * A receber busca em clientes; a pagar, em fornecedores. Trocar os dois faria o
 * título nascer com o nome errado sem erro nenhum aparecer.
 */
async function nomeDaContraparte(
  repositorios: Repositorios,
  entrada: EntradaLancarTitulo,
): Promise<Result<string, DomainError>> {
  const { contraparteId } = entrada;

  if (contraparteId === undefined) {
    const digitado = (entrada.contraparteNome ?? "").trim();

    if (digitado === "") {
      return err(
        new ErroValidacao("TITULO_CONTRAPARTE_OBRIGATORIA", "Informe de quem é a conta."),
      );
    }

    return ok(digitado);
  }

  if (entrada.tipo === "RECEBER") {
    const cliente = await repositorios.clientes.porId(contraparteId);

    return cliente === undefined
      ? err(new ErroNaoEncontrado("CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado."))
      : ok(cliente.exibicao);
  }

  const fornecedor = await repositorios.fornecedores.porId(contraparteId);

  return fornecedor === undefined
    ? err(
        new ErroNaoEncontrado("FORNECEDOR_NAO_ENCONTRADO", "Fornecedor não encontrado."),
      )
    : ok(fornecedor.exibicao);
}
