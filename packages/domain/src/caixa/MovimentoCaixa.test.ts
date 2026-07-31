import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { type DadosMovimentoCaixa, MovimentoCaixa } from "./MovimentoCaixa.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5c01").unwrap();
const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5c02").unwrap();
const GERENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5c03").unwrap();
const AGORA = new Date("2026-07-30T14:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function dados(sobrescritas: Partial<DadosMovimentoCaixa> = {}): DadosMovimentoCaixa {
  return {
    id: ID,
    tipo: "SANGRIA",
    valor: reais("100,00"),
    motivo: "Retirada para o cofre",
    usuarioId: USUARIO,
    ocorridoEm: AGORA,
    ...sobrescritas,
  };
}

function criar(sobrescritas: Partial<DadosMovimentoCaixa> = {}): MovimentoCaixa {
  const resultado = MovimentoCaixa.criar(dados(sobrescritas));
  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

describe("MovimentoCaixa — criação", () => {
  it("cria sangria", () => {
    const movimento = criar();

    expect(movimento.tipo).toBe("SANGRIA");
    expect(movimento.valor.formatar()).toBe("R$ 100,00");
    expect(movimento.motivo).toBe("Retirada para o cofre");
  });

  it("cria suprimento", () => {
    expect(criar({ tipo: "SUPRIMENTO", motivo: "Troco" }).tipo).toBe("SUPRIMENTO");
  });

  it("remove espaços do motivo", () => {
    expect(criar({ motivo: "  Cofre  " }).motivo).toBe("Cofre");
  });

  it("guarda autor e instante para auditoria", () => {
    const movimento = criar();

    expect(movimento.usuarioId.equals(USUARIO)).toBe(true);
    expect(movimento.ocorridoEm).toBe(AGORA);
  });

  it("guarda quem autorizou quando informado", () => {
    expect(criar({ autorizadoPorId: GERENTE }).autorizadoPorId?.equals(GERENTE)).toBe(
      true,
    );
  });

  it("não exige autorizador", () => {
    expect(criar().autorizadoPorId).toBeUndefined();
  });

  it("rejeita valor zero", () => {
    const resultado = MovimentoCaixa.criar(dados({ valor: Dinheiro.zero() }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("MOVIMENTO_CAIXA_VALOR_INVALIDO");
    }
  });

  it("rejeita valor negativo", () => {
    expect(MovimentoCaixa.criar(dados({ valor: reais("-1,00") })).isErr()).toBe(true);
  });

  it("exige motivo na sangria — dinheiro saindo sem justificativa não deixa rastro", () => {
    const resultado = MovimentoCaixa.criar(dados({ motivo: "   " }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("Informe o motivo da sangria.");
    }
  });

  it("exige motivo no suprimento", () => {
    const resultado = MovimentoCaixa.criar(dados({ tipo: "SUPRIMENTO", motivo: "" }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("Informe o motivo do suprimento.");
    }
  });
});

describe("MovimentoCaixa — efeito na gaveta", () => {
  it("suprimento soma", () => {
    expect(criar({ tipo: "SUPRIMENTO", motivo: "Troco" }).delta.formatar()).toBe(
      "R$ 100,00",
    );
  });

  it("sangria subtrai", () => {
    expect(criar().delta.formatar()).toBe("-R$ 100,00");
  });

  it("compara por identificador", () => {
    expect(criar().equals(criar({ tipo: "SUPRIMENTO", motivo: "x" }))).toBe(true);
  });
});
