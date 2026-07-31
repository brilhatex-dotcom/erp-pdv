import { describe, expect, it } from "vitest";

import { combine, combineAll, err, ok, type Result } from "./Result.js";

/** Erro de negócio de exemplo, no formato que o domínio usará. */
interface ErroNegocio {
  readonly codigo: string;
  readonly mensagem: string;
}

const ERRO: ErroNegocio = {
  codigo: "ESTOQUE_INSUFICIENTE",
  mensagem: "Estoque insuficiente para o produto",
};

describe("Result", () => {
  describe("construção e verificação", () => {
    it("identifica um resultado de sucesso", () => {
      const resultado = ok<number, ErroNegocio>(42);

      expect(resultado.isOk()).toBe(true);
      expect(resultado.isErr()).toBe(false);
    });

    it("identifica um resultado de falha", () => {
      const resultado = err<ErroNegocio, number>(ERRO);

      expect(resultado.isOk()).toBe(false);
      expect(resultado.isErr()).toBe(true);
    });

    it("estreita o tipo ao verificar isOk, dando acesso ao valor", () => {
      const resultado: Result<number, ErroNegocio> = ok(10);

      // O compilador só permite `.value` dentro deste bloco — é essa garantia
      // que impede acessar o valor de um resultado com erro.
      if (resultado.isOk()) {
        expect(resultado.value).toBe(10);
      } else {
        expect.unreachable("resultado deveria ser Ok");
      }
    });

    it("estreita o tipo ao verificar isErr, dando acesso ao erro", () => {
      const resultado: Result<number, ErroNegocio> = err(ERRO);

      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("ESTOQUE_INSUFICIENTE");
      } else {
        expect.unreachable("resultado deveria ser Err");
      }
    });
  });

  describe("map", () => {
    it("transforma o valor de um sucesso", () => {
      const resultado = ok<number, ErroNegocio>(5).map((n) => n * 2);

      expect(resultado.unwrap()).toBe(10);
    });

    it("não executa a transformação sobre uma falha", () => {
      let executou = false;

      const resultado = err<ErroNegocio, number>(ERRO).map((n) => {
        executou = true;
        return n * 2;
      });

      expect(executou).toBe(false);
      expect(resultado.isErr()).toBe(true);
    });
  });

  describe("mapErr", () => {
    it("transforma o erro de uma falha", () => {
      const resultado = err<ErroNegocio, number>(ERRO).mapErr((e) => e.codigo);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error).toBe("ESTOQUE_INSUFICIENTE");
      }
    });

    it("não altera um sucesso", () => {
      const resultado = ok<number, ErroNegocio>(7).mapErr((e) => e.codigo);

      expect(resultado.unwrap()).toBe(7);
    });
  });

  describe("andThen", () => {
    it("encadeia operações enquanto todas tiverem sucesso", () => {
      const dobrar = (n: number): Result<number, ErroNegocio> => ok(n * 2);
      const somarUm = (n: number): Result<number, ErroNegocio> => ok(n + 1);

      const resultado = ok<number, ErroNegocio>(5).andThen(dobrar).andThen(somarUm);

      expect(resultado.unwrap()).toBe(11);
    });

    it("interrompe a cadeia no primeiro erro", () => {
      let alcancou = false;

      const falhar = (): Result<number, ErroNegocio> => err(ERRO);
      const naoDeveExecutar = (n: number): Result<number, ErroNegocio> => {
        alcancou = true;
        return ok(n);
      };

      const resultado = ok<number, ErroNegocio>(5)
        .andThen(falhar)
        .andThen(naoDeveExecutar);

      expect(alcancou).toBe(false);
      expect(resultado.isErr()).toBe(true);
    });

    it("propaga o erro sem executar a operação seguinte", () => {
      let executou = false;

      const resultado = err<ErroNegocio, number>(ERRO).andThen((n) => {
        executou = true;
        return ok<number, ErroNegocio>(n);
      });

      expect(executou).toBe(false);
      expect(resultado.isErr()).toBe(true);
    });
  });

  describe("unwrap", () => {
    it("devolve o valor de um sucesso", () => {
      expect(ok<string, ErroNegocio>("venda").unwrap()).toBe("venda");
    });

    it("lança ao tentar extrair valor de uma falha, por ser bug de programação", () => {
      const resultado = err<ErroNegocio, number>(ERRO);

      expect(() => resultado.unwrap()).toThrow(/Estoque insuficiente/);
    });

    it("descreve erro do tipo Error na mensagem lançada", () => {
      const resultado = err<Error, number>(new Error("falha ao gravar"));

      expect(() => resultado.unwrap()).toThrow(/falha ao gravar/);
    });

    it("descreve erro do tipo string na mensagem lançada", () => {
      const resultado = err<string, number>("CAIXA_FECHADO");

      expect(() => resultado.unwrap()).toThrow(/CAIXA_FECHADO/);
    });

    it("descreve erro com referência circular sem quebrar", () => {
      const circular: Record<string, unknown> = {};
      circular["proprio"] = circular;

      const resultado = err<Record<string, unknown>, number>(circular);

      expect(() => resultado.unwrap()).toThrow(/object Object/);
    });
  });

  describe("unwrapOr", () => {
    it("ignora o padrão quando há valor", () => {
      expect(ok<number, ErroNegocio>(1).unwrapOr(99)).toBe(1);
    });

    it("devolve o padrão quando há erro", () => {
      expect(err<ErroNegocio, number>(ERRO).unwrapOr(99)).toBe(99);
    });
  });

  describe("match", () => {
    it("executa o ramo de sucesso", () => {
      const mensagem = ok<number, ErroNegocio>(3).match({
        ok: (n) => `total: ${String(n)}`,
        err: (e) => e.mensagem,
      });

      expect(mensagem).toBe("total: 3");
    });

    it("executa o ramo de erro", () => {
      const mensagem = err<ErroNegocio, number>(ERRO).match({
        ok: (n) => `total: ${String(n)}`,
        err: (e) => e.mensagem,
      });

      expect(mensagem).toBe("Estoque insuficiente para o produto");
    });
  });

  describe("combine", () => {
    it("reúne os valores quando todos têm sucesso", () => {
      const resultado = combine([ok(1), ok(2), ok(3)] as Result<number, ErroNegocio>[]);

      expect(resultado.unwrap()).toEqual([1, 2, 3]);
    });

    it("devolve o primeiro erro e ignora os seguintes", () => {
      const primeiro: ErroNegocio = { codigo: "A", mensagem: "primeiro" };
      const segundo: ErroNegocio = { codigo: "B", mensagem: "segundo" };

      const resultado = combine<number, ErroNegocio>([
        ok(1),
        err(primeiro),
        err(segundo),
      ]);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("A");
      }
    });

    it("trata lista vazia como sucesso vazio", () => {
      const resultado = combine<number, ErroNegocio>([]);

      expect(resultado.unwrap()).toEqual([]);
    });
  });

  describe("combineAll", () => {
    it("acumula todos os erros, para o usuário corrigir de uma vez", () => {
      const cpf: ErroNegocio = { codigo: "CPF_INVALIDO", mensagem: "CPF inválido" };
      const email: ErroNegocio = {
        codigo: "EMAIL_INVALIDO",
        mensagem: "E-mail inválido",
      };

      const resultado = combineAll<string, ErroNegocio>([
        ok("Maria"),
        err(cpf),
        err(email),
      ]);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error).toHaveLength(2);
        expect(resultado.error.map((e) => e.codigo)).toEqual([
          "CPF_INVALIDO",
          "EMAIL_INVALIDO",
        ]);
      }
    });

    it("reúne os valores quando todos têm sucesso", () => {
      const resultado = combineAll<string, ErroNegocio>([ok("a"), ok("b")]);

      expect(resultado.unwrap()).toEqual(["a", "b"]);
    });

    it("trata lista vazia como sucesso vazio", () => {
      const resultado = combineAll<string, ErroNegocio>([]);

      expect(resultado.unwrap()).toEqual([]);
    });
  });
});
