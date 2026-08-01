import { Dinheiro, Identificador, SessaoCaixa } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import { FecharCaixa } from "./FecharCaixa.js";

/**
 * O fechamento é o momento em que o sistema e a realidade são confrontados.
 *
 * Duas regras carregam o resto: **divergência não impede o fechamento** — caixa
 * travado deixa a loja sem saída e a diferença existe de qualquer forma — e
 * **venda offline pendente impede**, porque essa diferença não é real e some
 * sozinha quando a estação sincroniza.
 */

const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e540001").unwrap();
const OUTRA_ESTACAO = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e540002",
).unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e540003").unwrap();
const CAIXA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e540004").unwrap();
const VENDA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e540005").unwrap();
const ABERTURA = new Date("2026-08-01T08:00:00.000Z");
const AGORA = new Date("2026-08-01T18:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function montar() {
  const ambiente = montarAmbiente(AGORA);

  const sessao = SessaoCaixa.abrir({
    id: CAIXA,
    estacaoId: ESTACAO,
    operadorId: OPERADOR,
    fundoTroco: reais("100,00"),
    abertaEm: ABERTURA,
  }).unwrap();

  // Uma venda de R$ 250,00 em dinheiro, com R$ 50,00 de troco: entraram
  // R$ 200,00 líquidos na gaveta.
  sessao.registrarVenda({
    vendaId: VENDA,
    total: reais("250,00"),
    troco: reais("50,00"),
    pagamentos: [{ forma: "DINHEIRO", valor: reais("300,00") }],
  });

  ambiente.caixas.adicionar(sessao);

  return {
    ...ambiente,
    sessao,
    fechar: new FecharCaixa(ambiente.unitOfWork, ambiente.relogio),
  };
}

let sistema: ReturnType<typeof montar>;

beforeEach(() => {
  sistema = montar();
});

describe("Fechamento de caixa", () => {
  it("fecha certo quando a gaveta bate", async () => {
    // Fundo 100 + recebido 300 − troco 50 = 350 esperado.
    const resultado = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("350,00"),
    });

    expect(resultado.isOk()).toBe(true);

    const { conferencia, sessao } = resultado.unwrap();

    expect(conferencia.esperadoEmDinheiro.formatar()).toBe("R$ 350,00");
    expect(conferencia.divergenciaEmDinheiro.centavos).toBe(0n);
    expect(sessao.estaAberta).toBe(false);
    expect(sessao.fechadaEm?.toISOString()).toBe(AGORA.toISOString());
  });

  it("🔑 falta na gaveta é registrada, não bloqueia", async () => {
    // Travar o fechamento deixaria a loja com a gaveta aberta e o operador sem
    // saída — e a falta continuaria existindo.
    const resultado = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("330,00"),
    });

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().conferencia.divergenciaEmDinheiro.formatar()).toBe(
      "-R$ 20,00",
    );
  });

  it("sobra também é divergência", async () => {
    const resultado = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("370,00"),
    });

    expect(resultado.unwrap().conferencia.divergenciaEmDinheiro.formatar()).toBe(
      "R$ 20,00",
    );
  });

  it("🔑 venda ainda na fila da estação impede o fechamento", async () => {
    // Ela não entrou no esperado. Fechar assim produz uma falta que não é
    // falta, e ninguém consegue explicar de onde veio — o dinheiro está certo.
    const resultado = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("350,00"),
      vendasPendentesNaEstacao: 3,
    });

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;

    expect(resultado.error.codigo).toBe("CAIXA_COM_VENDAS_PENDENTES");
    expect(resultado.error.mensagem).toContain("3 vendas");
    expect(sistema.sessao.estaAberta).toBe(true);
  });

  it("a mensagem concorda em número com uma venda só", async () => {
    const resultado = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("350,00"),
      vendasPendentesNaEstacao: 1,
    });

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error.mensagem).toContain("1 venda ainda não enviada");
  });

  it("fila vazia não bloqueia", async () => {
    const resultado = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("350,00"),
      vendasPendentesNaEstacao: 0,
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("estação sem caixa aberto recusa", async () => {
    const resultado = await sistema.fechar.executar({
      estacaoId: OUTRA_ESTACAO,
      contadoEmDinheiro: reais("350,00"),
    });

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error.codigo).toBe("CAIXA_NAO_ABERTO");
  });

  it("🔑 não fecha duas vezes", async () => {
    // A segunda chamada não encontra sessão aberta: o índice parcial garante
    // que só existe uma, e ela já foi fechada.
    await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("350,00"),
    });

    const segunda = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("350,00"),
    });

    expect(segunda.isErr()).toBe(true);
  });

  it("contagem negativa é recusada", async () => {
    const resultado = await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("-10,00"),
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("a conferência leva o que o relatório do dia precisa", async () => {
    const { conferencia } = (
      await sistema.fechar.executar({
        estacaoId: ESTACAO,
        contadoEmDinheiro: reais("350,00"),
      })
    ).unwrap();

    expect(conferencia.fundoTroco.formatar()).toBe("R$ 100,00");
    expect(conferencia.recebidoEmDinheiro.formatar()).toBe("R$ 300,00");
    expect(conferencia.trocoDevolvido.formatar()).toBe("R$ 50,00");
    expect(conferencia.totalVendido.formatar()).toBe("R$ 250,00");
    expect(conferencia.quantidadeVendas).toBe(1);
  });

  it("o fechamento vira evento na outbox", async () => {
    await sistema.fechar.executar({
      estacaoId: ESTACAO,
      contadoEmDinheiro: reais("350,00"),
    });

    const tipos = sistema.outbox.eventos.map((evento) => evento.tipo);
    expect(tipos).toContain("CaixaFechado");
  });
});
