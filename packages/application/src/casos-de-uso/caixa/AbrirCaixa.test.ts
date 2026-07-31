import { Dinheiro, Identificador, SessaoCaixa } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import { AbrirCaixa } from "./AbrirCaixa.js";

const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e520001").unwrap();
const OUTRA_ESTACAO = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e520002",
).unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e520003").unwrap();
const CAIXA_EXISTENTE = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e520004",
).unwrap();
const AGORA = new Date("2026-07-31T08:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function montar() {
  const ambiente = montarAmbiente(AGORA);

  return {
    ...ambiente,
    abrirCaixa: new AbrirCaixa(ambiente.unitOfWork, ambiente.relogio, ambiente.geradorId),
  };
}

let sistema: ReturnType<typeof montar>;

beforeEach(() => {
  sistema = montar();
});

describe("Abertura de caixa", () => {
  it("abre com o fundo de troco e registra o operador", async () => {
    const caixa = (
      await sistema.abrirCaixa.executar({
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        fundoTroco: reais("100,00"),
      })
    ).unwrap();

    expect(caixa.estaAberta).toBe(true);
    expect(caixa.fundoTroco.formatar()).toBe("R$ 100,00");
    expect(caixa.operadorId.equals(OPERADOR)).toBe(true);
    expect(caixa.abertaEm.toISOString()).toBe(AGORA.toISOString());
  });

  it("o dinheiro esperado na gaveta começa igual ao fundo", async () => {
    const caixa = (
      await sistema.abrirCaixa.executar({
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        fundoTroco: reais("150,00"),
      })
    ).unwrap();

    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 150,00");
    expect(caixa.quantidadeVendas).toBe(0);
  });

  it("🔑 recusa o segundo caixa na mesma estação, apontando o existente", async () => {
    // Duas gavetas abertas duplicariam o fundo de troco, e o fechamento
    // acusaria sobra que não existe na gaveta.
    sistema.caixas.adicionar(
      SessaoCaixa.abrir({
        id: CAIXA_EXISTENTE,
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        fundoTroco: reais("100,00"),
        abertaEm: AGORA,
      }).unwrap(),
    );

    const resultado = await sistema.abrirCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("50,00"),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_JA_ABERTO");
      // O identificador do existente vai junto: é o que permite ao PDV
      // continuar de onde parou em vez de exigir intervenção.
      expect(resultado.error.detalhes?.["sessaoId"]).toBe(CAIXA_EXISTENTE.valor);
    }
  });

  it("estações diferentes abrem caixas independentes", async () => {
    // O caso normal de uma loja com dois PDVs.
    const primeiro = await sistema.abrirCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
    });

    const segundo = await sistema.abrirCaixa.executar({
      estacaoId: OUTRA_ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("80,00"),
    });

    expect(primeiro.isOk()).toBe(true);
    expect(segundo.isOk()).toBe(true);
  });

  it("caixa já fechado não impede abrir outro na mesma estação", async () => {
    // É o dia seguinte: o de ontem está fechado e o de hoje precisa abrir.
    const ontem = SessaoCaixa.abrir({
      id: CAIXA_EXISTENTE,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
      abertaEm: new Date("2026-07-30T08:00:00.000Z"),
    }).unwrap();

    ontem.fechar(reais("100,00"), new Date("2026-07-30T18:00:00.000Z")).unwrap();
    sistema.caixas.adicionar(ontem);

    const resultado = await sistema.abrirCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("120,00"),
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("recusa fundo de troco negativo", async () => {
    const resultado = await sistema.abrirCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("50,00").negar(),
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("aceita abrir sem fundo de troco", async () => {
    // Acontece: a loja que só recebe em cartão e PIX não precisa de troco.
    const caixa = (
      await sistema.abrirCaixa.executar({
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        fundoTroco: Dinheiro.zero(),
      })
    ).unwrap();

    expect(caixa.fundoTroco.ehZero()).toBe(true);
  });

  it("enfileira o evento de abertura para a auditoria", async () => {
    await sistema.abrirCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
    });

    expect(sistema.outbox.eventos).toHaveLength(1);
    expect(sistema.outbox.eventos[0]?.tipo).toBe("CaixaAberto");
  });

  it("tudo acontece numa transação só", async () => {
    await sistema.abrirCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
    });

    expect(sistema.unitOfWork.transacoes).toBe(1);
  });
});
