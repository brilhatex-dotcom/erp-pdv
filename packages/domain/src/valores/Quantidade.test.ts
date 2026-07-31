import { describe, expect, it } from "vitest";

import { Quantidade } from "./Quantidade.js";

function qtd(
  valor: string | number,
  unidade: "KG" | "UN" | "CX" | "L" | "M",
): Quantidade {
  const resultado = Quantidade.de(valor, unidade);
  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

describe("Quantidade", () => {
  describe("construção", () => {
    it.each([
      ["1,5", 1500n],
      ["1.5", 1500n],
      ["0,750", 750n],
      ["2", 2000n],
      ["0,001", 1n],
    ])("converte %s em %s milésimos", (entrada, esperado) => {
      expect(qtd(entrada, "KG").milesimos).toBe(esperado);
    });

    it("aceita number sem erro de ponto flutuante", () => {
      expect(qtd(0.1 + 0.2, "KG").milesimos).toBe(300n);
    });

    it("arredonda a quarta casa decimal para cima", () => {
      expect(qtd("1,2345", "KG").milesimos).toBe(1235n);
    });

    it("mantém o valor quando a quarta casa é menor que cinco", () => {
      expect(qtd("1,2344", "KG").milesimos).toBe(1234n);
    });

    it("constrói a partir de milésimos", () => {
      expect(Quantidade.deMilesimos(1500n, "KG").unwrap().milesimos).toBe(1500n);
    });

    it("constrói o zero", () => {
      expect(Quantidade.zero("UN").ehZero()).toBe(true);
    });

    it("constrói quantidade negativa, usada em devolução e estorno", () => {
      expect(qtd("-1,5", "KG").milesimos).toBe(-1500n);
    });

    it("rejeita formato inválido", () => {
      const resultado = Quantidade.de("abc", "KG");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("QUANTIDADE_FORMATO_INVALIDO");
      }
    });

    it("rejeita valor vazio", () => {
      const resultado = Quantidade.de("", "KG");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("QUANTIDADE_VAZIA");
      }
    });

    it("rejeita number não finito", () => {
      expect(Quantidade.de(Number.NaN, "KG").isErr()).toBe(true);
    });

    it("rejeita quantidade fora do limite", () => {
      const resultado = Quantidade.deMilesimos(1_000_000_000_001n, "KG");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("QUANTIDADE_FORA_DO_LIMITE");
      }
    });
  });

  describe("unidade não fracionável", () => {
    it("aceita quantidade inteira em caixa", () => {
      expect(qtd("3", "CX").milesimos).toBe(3000n);
    });

    it("recusa meia caixa — não existe no depósito", () => {
      const resultado = Quantidade.de("0,5", "CX");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("QUANTIDADE_NAO_FRACIONAVEL");
        expect(resultado.error.mensagem).toContain("caixa");
      }
    });

    it("recusa fração em unidade", () => {
      expect(Quantidade.de("1,5", "UN").isErr()).toBe(true);
    });

    it("aceita fração em quilo — meio quilo é venda normal no açougue", () => {
      expect(qtd("0,5", "KG").milesimos).toBe(500n);
    });
  });

  describe("aritmética", () => {
    it("soma quantidades da mesma unidade", () => {
      const total = qtd("1,5", "KG").somar(qtd("0,750", "KG")).unwrap();

      expect(total.milesimos).toBe(2250n);
    });

    it("subtrai quantidades da mesma unidade", () => {
      const total = qtd("2", "KG").subtrair(qtd("0,750", "KG")).unwrap();

      expect(total.milesimos).toBe(1250n);
    });

    it("recusa somar unidades diferentes — 2 kg com 3 caixas não existe", () => {
      const resultado = qtd("2", "KG").somar(qtd("3", "CX"));

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("QUANTIDADE_UNIDADES_INCOMPATIVEIS");
      }
    });

    it("recusa subtrair unidades diferentes", () => {
      expect(qtd("2", "KG").subtrair(qtd("1", "L")).isErr()).toBe(true);
    });

    it("permite resultado negativo, necessário para estorno de estoque", () => {
      const total = qtd("1", "KG").subtrair(qtd("3", "KG")).unwrap();

      expect(total.ehNegativa()).toBe(true);
      expect(total.milesimos).toBe(-2000n);
    });

    it("nega a quantidade", () => {
      expect(qtd("2", "KG").negar().milesimos).toBe(-2000n);
    });

    it("é imutável", () => {
      const original = qtd("1", "KG");
      original.somar(qtd("1", "KG"));

      expect(original.milesimos).toBe(1000n);
    });
  });

  describe("conversão de unidade", () => {
    it("converte fardo em unidades — caso do depósito", () => {
      const emUnidades = qtd("2", "CX").converterPara("UN", 12n).unwrap();

      expect(emUnidades.milesimos).toBe(24000n);
      expect(emUnidades.unidade.codigo).toBe("UN");
    });

    it("rejeita fator zero", () => {
      const resultado = qtd("2", "CX").converterPara("UN", 0n);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("CONVERSAO_FATOR_INVALIDO");
      }
    });

    it("rejeita fator negativo", () => {
      expect(qtd("2", "CX").converterPara("UN", -1n).isErr()).toBe(true);
    });

    it("recusa conversão que geraria fração em unidade não fracionável", () => {
      const meioQuilo = qtd("0,5", "KG");

      expect(meioQuilo.converterPara("UN", 1n).isErr()).toBe(true);
    });
  });

  describe("comparação", () => {
    it("considera iguais mesma quantidade e mesma unidade", () => {
      expect(qtd("1,5", "KG").equals(qtd("1,5", "KG"))).toBe(true);
    });

    it("considera diferentes a mesma quantidade em unidades distintas", () => {
      expect(qtd("2", "KG").equals(qtd("2", "L"))).toBe(false);
    });

    it("ordena quantidades da mesma unidade", () => {
      expect(qtd("2", "KG").maiorQue(qtd("1", "KG"))).toBe(true);
      expect(qtd("1", "KG").menorQue(qtd("2", "KG"))).toBe(true);
    });

    it("não ordena unidades diferentes", () => {
      expect(qtd("2", "KG").maiorQue(qtd("1", "L"))).toBe(false);
      expect(qtd("1", "KG").menorQue(qtd("2", "L"))).toBe(false);
    });

    it("classifica o sinal", () => {
      expect(Quantidade.zero("KG").ehZero()).toBe(true);
      expect(qtd("0,001", "KG").ehPositiva()).toBe(true);
      expect(qtd("1", "KG").negar().ehNegativa()).toBe(true);
    });
  });

  describe("apresentação", () => {
    it.each([
      ["2", "UN", "2 un"],
      ["1,5", "KG", "1,5 kg"],
      ["0,750", "KG", "0,75 kg"],
      ["0,001", "KG", "0,001 kg"],
      ["3", "CX", "3 cx"],
    ] as const)("formata %s %s como %s", (valor, unidade, esperado) => {
      expect(qtd(valor, unidade).formatar()).toBe(esperado);
    });

    it("omite zeros decimais desnecessários, reduzindo ruído na tela", () => {
      expect(qtd("2", "KG").formatar()).toBe("2 kg");
    });

    it("formata negativo", () => {
      expect(qtd("1,5", "KG").negar().formatar()).toBe("-1,5 kg");
    });

    it("formata sem unidade quando pedido", () => {
      expect(qtd("1,5", "KG").formatar({ comUnidade: false })).toBe("1,5");
    });

    it("gera decimal com três casas para o XML fiscal", () => {
      expect(qtd("1,5", "KG").paraDecimal()).toBe("1.500");
      expect(qtd("2", "UN").paraDecimal()).toBe("2.000");
      expect(qtd("1,5", "KG").negar().paraDecimal()).toBe("-1.500");
    });

    it("usa a formatação amigável no toString", () => {
      expect(String(qtd("1,5", "KG"))).toBe("1,5 kg");
    });

    it("serializa milésimos e unidade", () => {
      expect(JSON.stringify(qtd("1,5", "KG"))).toBe(
        '{"milesimos":"1500","unidade":"KG"}',
      );
    });
  });
});
