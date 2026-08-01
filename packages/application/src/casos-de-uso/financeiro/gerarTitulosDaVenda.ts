import {
  type DomainError,
  err,
  ErroRegraNegocio,
  montarPlanoDeParcelas,
  ok,
  type Result,
  Titulo,
  type Venda,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";

/**
 * Transforma o crediário de uma venda em títulos a receber.
 *
 * ### Por que **na mesma transação** da venda, e não pela outbox
 *
 * O comentário antigo de `FinalizarVenda` dizia que a conta a receber viria de
 * quem reage ao evento. Isso valia enquanto o financeiro não existia, e vale
 * para o **fiscal** — que depende de rede externa e por isso é assíncrono
 * (ADR-0006).
 *
 * O financeiro é outra coisa: é local, é o mesmo banco, e é **consequência
 * obrigatória** da venda. Se a venda gravar e o título não, o lojista entregou
 * mercadoria e não tem registro da dívida — perda de dinheiro direta, do mesmo
 * tipo que estoque e caixa já evitam entrando na mesma transação. Fiado que
 * some é exatamente o defeito que o produto existe para corrigir
 * (`ANALISE-SEGMENTOS.md` §3.3).
 *
 * Registrado no ADR-0025.
 *
 * ### Uma função, não uma classe
 *
 * Ela não é chamada de fora: roda dentro da transação que `FinalizarVenda` já
 * abriu, com os repositórios que ele já tem. Uma classe com `UnitOfWork`
 * próprio abriria uma **segunda** transação — e aí a venda e o título voltariam
 * a poder existir um sem o outro, que é exatamente o que se quer impedir.
 */

export interface PedidoDeCrediario {
  /** Quantas parcelas o operador escolheu. Um é a caderneta clássica. */
  readonly parcelas: number;
  readonly diasParaPrimeiroVencimento?: number | undefined;
  readonly diasEntreParcelas?: number | undefined;
}

export async function gerarTitulosDaVenda(
  repositorios: Repositorios,
  geradorId: GeradorId,
  dados: {
    readonly venda: Venda;
    readonly momento: Date;
    readonly crediario?: PedidoDeCrediario | undefined;
  },
): Promise<Result<readonly Titulo[], DomainError>> {
  const { venda, momento } = dados;

  if (!venda.valorAReceber.ehPositivo()) return ok([]);

  const clienteId = venda.clienteId;

  /* v8 ignore next 8 -- inalcançável: `Venda` recusa crediário sem cliente */
  if (clienteId === undefined) {
    return err(
      new ErroRegraNegocio(
        "CREDIARIO_SEM_CLIENTE",
        "Identifique o cliente para vender no crediário.",
      ),
    );
  }

  const cliente = await repositorios.clientes.porId(clienteId);

  if (cliente === undefined) {
    return err(
      new ErroRegraNegocio(
        "CLIENTE_NAO_ENCONTRADO",
        "O cliente desta venda não foi encontrado.",
        { clienteId: clienteId.valor },
      ),
    );
  }

  const plano = montarPlanoDeParcelas({
    total: venda.valorAReceber,
    parcelas: dados.crediario?.parcelas ?? 1,
    emitidoEm: momento,
    diasParaPrimeiroVencimento: dados.crediario?.diasParaPrimeiroVencimento,
    diasEntreParcelas: dados.crediario?.diasEntreParcelas,
  });

  if (plano.isErr()) return err(plano.error);

  const parcelas = plano.unwrap();
  const criados: Titulo[] = [];

  for (const parcela of parcelas) {
    const titulo = Titulo.criar({
      id: geradorId.proximo(),
      tipo: "RECEBER",
      origem: "VENDA",
      documentoId: venda.id,
      contraparteId: clienteId,
      // O nome é congelado: o cliente pode ser renomeado depois, e a caderneta
      // precisa continuar dizendo em nome de quem a dívida foi feita.
      contraparteNome: cliente.exibicao,
      valorOriginal: parcela.valor,
      vencimento: parcela.vencimento,
      emitidoEm: momento,
      // Parcela só é registrada quando há mais de uma: `1 de 1` no carnê da
      // caderneta é ruído que o lojista teria de explicar ao cliente.
      parcela:
        parcelas.length > 1 ? { numero: parcela.numero, de: parcela.de } : undefined,
      descricao: `Venda ${String(venda.numero)}`,
    });

    /* v8 ignore next -- inalcançável: valor e contraparte já foram validados */
    if (titulo.isErr()) return err(titulo.error[0] ?? erroInesperado());

    const criado = titulo.unwrap();
    await repositorios.titulos.salvar(criado);
    criados.push(criado);
  }

  return ok(criados);
}

/* v8 ignore next 6 -- inalcançável: `Titulo.criar` nunca devolve lista vazia de erros */
function erroInesperado(): ErroRegraNegocio {
  return new ErroRegraNegocio(
    "TITULO_INVALIDO",
    "Não foi possível gerar a conta a receber desta venda.",
  );
}

// Falta o par disto: **cancelar os títulos quando a venda for cancelada**.
// Não foi escrito porque não existe caso de uso de cancelar venda — o domínio
// tem `Venda.cancelar`, mas nada o chama, e código sem chamador é código morto
// que ninguém mantém. Está registrado em `ESTADO.md` §2.4 com o gatilho: quem
// escrever `CancelarVenda` precisa alcançar o fiado que ela criou, senão a
// dívida sobrevive à venda e o cliente é cobrado por mercadoria devolvida.
