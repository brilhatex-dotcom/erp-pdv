import { describe, expect, it } from "vitest";

import { Dinheiro } from "./Dinheiro.js";

/** Atalho de teste: constrói ou falha o teste explicitamente. */
function reais(valor: string | number): Dinheiro {
  const resultado = Dinheiro.deReais(valor);
  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

describe("Dinheiro", () => {
  describe("construção a partir de centavos", () => {
    it("aceita bigint", () => {
      expect(Dinheiro.deCentavos(1050n).unwrap().centavos).toBe(1050n);
    });

    it("aceita number inteiro", () => {
      expect(Dinheiro.deCentavos(1050).unwrap().centavos).toBe(1050n);
    });

    it("aceita valor negativo, necessário para estorno e troco", () => {
      expect(Dinheiro.deCentavos(-500n).unwrap().centavos).toBe(-500n);
    });

    it("rejeita number fracionado, que indicaria centavo quebrado", () => {
      const resultado = Dinheiro.deCentavos(10.5);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("DINHEIRO_CENTAVOS_INVALIDO");
      }
    });

    it("rejeita valor acima do limite", () => {
      const resultado = Dinheiro.deCentavos(100_000_000_000_001n);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("DINHEIRO_FORA_DO_LIMITE");
      }
    });

    it("rejeita valor negativo abaixo do limite", () => {
      expect(Dinheiro.deCentavos(-100_000_000_000_001n).isErr()).toBe(true);
    });
  });

  describe("construção a partir de reais", () => {
    it.each([
      ["10,50", 1050n, "vírgula decimal brasileira"],
      ["10.50", 1050n, "ponto decimal"],
      ["10", 1000n, "sem casas decimais"],
      ["0,01", 1n, "um centavo"],
      ["1234,56", 123456n, "valor com milhar"],
      ["-25,00", -2500n, "negativo"],
      ["10,5", 1050n, "uma casa decimal"],
    ])("converte %s em %s centavos (%s)", (entrada, esperado) => {
      expect(Dinheiro.deReais(entrada).unwrap().centavos).toBe(esperado);
    });

    it("arredonda a terceira casa para cima", () => {
      expect(Dinheiro.deReais("10,125").unwrap().centavos).toBe(1013n);
    });

    it("mantém o valor quando a terceira casa é menor que cinco", () => {
      expect(Dinheiro.deReais("10,124").unwrap().centavos).toBe(1012n);
    });

    it("aceita number sem introduzir erro de ponto flutuante", () => {
      // 0.1 + 0.2 é 0.30000000000000004 em float. O resultado precisa ser 30.
      expect(Dinheiro.deReais(0.1 + 0.2).unwrap().centavos).toBe(30n);
    });

    it("aceita number com uma casa decimal", () => {
      expect(Dinheiro.deReais(10.5).unwrap().centavos).toBe(1050n);
    });

    it("ignora espaços", () => {
      expect(Dinheiro.deReais(" 10,50 ").unwrap().centavos).toBe(1050n);
    });

    it.each([
      ["", "DINHEIRO_VAZIO"],
      ["abc", "DINHEIRO_FORMATO_INVALIDO"],
      ["10,50,30", "DINHEIRO_FORMATO_INVALIDO"],
      ["R$ 10", "DINHEIRO_FORMATO_INVALIDO"],
    ])("rejeita %s com o código %s", (entrada, codigo) => {
      const resultado = Dinheiro.deReais(entrada);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe(codigo);
      }
    });

    it("rejeita number não finito", () => {
      expect(Dinheiro.deReais(Number.POSITIVE_INFINITY).isErr()).toBe(true);
    });
  });

  describe("aritmética", () => {
    it("soma sem erro de ponto flutuante", () => {
      // O caso clássico: 0,10 + 0,20 precisa dar exatamente 0,30.
      const total = reais("0,10").somar(reais("0,20"));

      expect(total.centavos).toBe(30n);
      expect(total.equals(reais("0,30"))).toBe(true);
    });

    it("acumula muitas somas sem desvio", () => {
      // Somar 0,10 dez vezes precisa dar exatamente 1,00 — em float, não dá.
      let total = Dinheiro.zero();
      for (let i = 0; i < 10; i += 1) {
        total = total.somar(reais("0,10"));
      }

      expect(total.centavos).toBe(100n);
    });

    it("subtrai", () => {
      expect(reais("10,00").subtrair(reais("3,50")).centavos).toBe(650n);
    });

    it("permite subtração resultar em negativo, para calcular falta de pagamento", () => {
      expect(reais("10,00").subtrair(reais("15,00")).centavos).toBe(-500n);
    });

    it("não altera a instância original — é imutável", () => {
      const original = reais("10,00");
      original.somar(reais("5,00"));

      expect(original.centavos).toBe(1000n);
    });

    it("escala por fator inteiro", () => {
      expect(reais("10,00").escalar(3n).centavos).toBe(3000n);
    });

    it("escala por fator fracionado, arredondando meio para cima", () => {
      // R$ 9,99 × 2,5 = R$ 24,975 → R$ 24,98
      expect(reais("9,99").escalar(25n, 10n).centavos).toBe(2498n);
    });

    it("escala valor negativo arredondando para longe do zero", () => {
      expect(reais("-9,99").escalar(25n, 10n).centavos).toBe(-2498n);
    });

    it("trata divisor negativo invertendo o sinal do resultado", () => {
      expect(reais("10,00").escalar(1n, -2n).centavos).toBe(-500n);
    });

    it("mantém o sinal positivo quando numerador e divisor são negativos", () => {
      expect(reais("-10,00").escalar(1n, -2n).centavos).toBe(500n);
    });

    it("lança ao escalar com divisor zero, por ser bug de programação", () => {
      // Diferente das falhas de negócio, divisor zero não é entrada do usuário:
      // é código errado. Por isso lança em vez de devolver Result (CLAUDE.md §4.7).
      expect(() => reais("10,00").escalar(1n, 0n)).toThrow(/Divisão por zero/);
    });

    it("nega o valor", () => {
      expect(reais("10,00").negar().centavos).toBe(-1000n);
    });

    it("devolve o valor absoluto", () => {
      expect(reais("-10,00").absoluto().centavos).toBe(1000n);
      expect(reais("10,00").absoluto().centavos).toBe(1000n);
    });
  });

  describe("ratear — divisão em partes iguais", () => {
    it("distribui a sobra, garantindo que a soma feche com o total", () => {
      // O caso que faz a SEFAZ rejeitar nota quando mal implementado.
      const partes = reais("10,00").ratear(3).unwrap();

      expect(partes.map((p) => p.centavos)).toEqual([334n, 333n, 333n]);

      const soma = partes.reduce((acc, p) => acc.somar(p), Dinheiro.zero());
      expect(soma.centavos).toBe(1000n);
    });

    it("divide exatamente quando não há sobra", () => {
      const partes = reais("9,00").ratear(3).unwrap();

      expect(partes.map((p) => p.centavos)).toEqual([300n, 300n, 300n]);
    });

    it("rateia valor negativo preservando o sinal e a soma", () => {
      const partes = reais("-10,00").ratear(3).unwrap();

      expect(partes.map((p) => p.centavos)).toEqual([-334n, -333n, -333n]);

      const soma = partes.reduce((acc, p) => acc.somar(p), Dinheiro.zero());
      expect(soma.centavos).toBe(-1000n);
    });

    it("rateia em uma parte só", () => {
      expect(reais("10,00").ratear(1).unwrap()[0]?.centavos).toBe(1000n);
    });

    it("rateia zero", () => {
      const partes = reais("0,00").ratear(3).unwrap();

      expect(partes.map((p) => p.centavos)).toEqual([0n, 0n, 0n]);
    });

    it.each([0, -1, 2.5])("rejeita %s parcelas", (partes) => {
      const resultado = reais("10,00").ratear(partes);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("RATEIO_PARTES_INVALIDO");
      }
    });
  });

  describe("ratearProporcional — desconto distribuído entre itens", () => {
    it("distribui proporcionalmente e a soma fecha com o total", () => {
      // Desconto de R$ 10,00 sobre itens de R$ 30, R$ 50 e R$ 20.
      const partes = reais("10,00").ratearProporcional([3000n, 5000n, 2000n]).unwrap();

      expect(partes.map((p) => p.centavos)).toEqual([300n, 500n, 200n]);

      const soma = partes.reduce((acc, p) => acc.somar(p), Dinheiro.zero());
      expect(soma.centavos).toBe(1000n);
    });

    it("usa maior resto quando a divisão não é exata, sem perder centavo", () => {
      // R$ 1,00 entre três itens iguais: alguém precisa levar o centavo extra.
      const partes = reais("1,00").ratearProporcional([1n, 1n, 1n]).unwrap();

      const soma = partes.reduce((acc, p) => acc.somar(p), Dinheiro.zero());
      expect(soma.centavos).toBe(100n);
      expect(partes.map((p) => p.centavos)).toEqual([34n, 33n, 33n]);
    });

    it("ordena corretamente restos crescentes e decrescentes", () => {
      // Sete itens com pesos distintos forçam o comparador a decidir nos dois
      // sentidos, e não só em empates.
      const partes = reais("1,00")
        .ratearProporcional([1n, 2n, 3n, 4n, 5n, 6n, 7n])
        .unwrap();

      const soma = partes.reduce((acc, p) => acc.somar(p), Dinheiro.zero());
      expect(soma.centavos).toBe(100n);
      expect(partes).toHaveLength(7);
    });

    it("é determinístico: a mesma entrada produz sempre o mesmo rateio", () => {
      const primeira = reais("100,00").ratearProporcional([7n, 11n, 13n]).unwrap();
      const segunda = reais("100,00").ratearProporcional([7n, 11n, 13n]).unwrap();

      expect(primeira.map((p) => p.centavos)).toEqual(segunda.map((p) => p.centavos));
    });

    it("aceita peso zero, atribuindo valor zero ao item", () => {
      const partes = reais("10,00").ratearProporcional([1000n, 0n]).unwrap();

      expect(partes.map((p) => p.centavos)).toEqual([1000n, 0n]);
    });

    it("preserva o sinal em valor negativo", () => {
      const partes = reais("-10,00").ratearProporcional([3000n, 7000n]).unwrap();

      expect(partes.map((p) => p.centavos)).toEqual([-300n, -700n]);
    });

    it("rejeita lista de pesos vazia", () => {
      const resultado = reais("10,00").ratearProporcional([]);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("RATEIO_SEM_PESOS");
      }
    });

    it("rejeita peso negativo", () => {
      const resultado = reais("10,00").ratearProporcional([100n, -50n]);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("RATEIO_PESO_NEGATIVO");
      }
    });

    it("rejeita quando todos os pesos são zero", () => {
      const resultado = reais("10,00").ratearProporcional([0n, 0n]);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("RATEIO_PESO_TOTAL_ZERO");
      }
    });
  });

  describe("comparação", () => {
    it("compara igualdade estrutural", () => {
      expect(reais("10,00").equals(reais("10,00"))).toBe(true);
      expect(reais("10,00").equals(reais("10,01"))).toBe(false);
    });

    it("ordena valores", () => {
      const menor = reais("5,00");
      const maior = reais("10,00");

      expect(maior.maiorQue(menor)).toBe(true);
      expect(menor.menorQue(maior)).toBe(true);
      expect(maior.menorQue(menor)).toBe(false);
      expect(menor.maiorQue(maior)).toBe(false);
    });

    it("compara com igualdade inclusiva", () => {
      const valor = reais("10,00");

      expect(valor.maiorOuIgualA(reais("10,00"))).toBe(true);
      expect(valor.menorOuIgualA(reais("10,00"))).toBe(true);
      expect(valor.maiorOuIgualA(reais("10,01"))).toBe(false);
      expect(valor.menorOuIgualA(reais("9,99"))).toBe(false);
    });

    it("classifica o sinal", () => {
      expect(Dinheiro.zero().ehZero()).toBe(true);
      expect(reais("0,01").ehPositivo()).toBe(true);
      expect(reais("-0,01").ehNegativo()).toBe(true);
      expect(Dinheiro.zero().ehPositivo()).toBe(false);
      expect(Dinheiro.zero().ehNegativo()).toBe(false);
    });
  });

  describe("apresentação", () => {
    it.each([
      ["0,00", "R$ 0,00"],
      ["10,50", "R$ 10,50"],
      ["1234,56", "R$ 1.234,56"],
      ["1000000,00", "R$ 1.000.000,00"],
      ["0,05", "R$ 0,05"],
      ["-25,90", "-R$ 25,90"],
    ])("formata %s como %s", (entrada, esperado) => {
      expect(reais(entrada).formatar()).toBe(esperado);
    });

    it("formata sem símbolo quando pedido", () => {
      expect(reais("1234,56").formatar({ comSimbolo: false })).toBe("1.234,56");
    });

    it("gera decimal para XML fiscal", () => {
      expect(reais("1234,56").paraDecimal()).toBe("1234.56");
      expect(reais("0,05").paraDecimal()).toBe("0.05");
      expect(reais("-10,00").paraDecimal()).toBe("-10.00");
    });

    it("usa a formatação brasileira no toString", () => {
      expect(String(reais("10,00"))).toBe("R$ 10,00");
    });

    it("serializa centavos como texto, já que bigint não vai em JSON", () => {
      expect(JSON.stringify({ total: reais("10,00") })).toBe('{"total":"1000"}');
    });
  });

  describe("zero", () => {
    it("constrói o valor neutro", () => {
      expect(Dinheiro.zero().centavos).toBe(0n);
    });

    it("é neutro na soma", () => {
      expect(reais("10,00").somar(Dinheiro.zero()).centavos).toBe(1000n);
    });
  });
});
