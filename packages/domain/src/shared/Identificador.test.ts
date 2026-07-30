import { describe, expect, it } from "vitest";

import {
  BYTES_ALEATORIOS_UUID_V7,
  Identificador,
  montarUuidV7,
} from "./Identificador.js";

const ALEATORIOS = new Uint8Array([
  0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde,
]);

describe("Identificador", () => {
  describe("validação", () => {
    it("aceita UUID válido", () => {
      const id = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b").unwrap();

      expect(id.valor).toBe("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b");
    });

    it("normaliza para minúsculas", () => {
      const id = Identificador.criar("018F3A2B-7C1D-7E4F-8A9B-1C2D3E4F5A6B").unwrap();

      expect(id.valor).toBe("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b");
    });

    it("ignora espaços nas pontas", () => {
      expect(Identificador.criar(" 018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b ").isOk()).toBe(
        true,
      );
    });

    it("rejeita vazio", () => {
      const resultado = Identificador.criar("");

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("ID_VAZIO");
      }
    });

    it.each([
      "018f3a2b7c1d7e4f8a9b1c2d3e4f5a6b",
      "018f3a2b-7c1d-7e4f-8a9b",
      "zzzzzzzz-7c1d-7e4f-8a9b-1c2d3e4f5a6b",
    ])("rejeita formato inválido %s", (valor) => {
      const resultado = Identificador.criar(valor);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("ID_FORMATO_INVALIDO");
      }
    });
  });

  describe("leitura da estrutura", () => {
    it("expõe a versão", () => {
      const id = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b").unwrap();

      expect(id.versao).toBe(7);
    });

    it("extrai o instante de criação embutido no v7", () => {
      const instante = 1_700_000_000_000;
      const id = montarUuidV7(instante, ALEATORIOS).unwrap();

      expect(id.criadoEmMilissegundos).toBe(instante);
    });

    it("não devolve instante para UUID de outra versão", () => {
      // UUIDv4 não carrega tempo.
      const id = Identificador.criar("018f3a2b-7c1d-4e4f-8a9b-1c2d3e4f5a6b").unwrap();

      expect(id.versao).toBe(4);
      expect(id.criadoEmMilissegundos).toBeUndefined();
    });
  });

  describe("comparação e apresentação", () => {
    it("compara por igualdade estrutural", () => {
      const a = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b").unwrap();
      const b = Identificador.criar("018F3A2B-7C1D-7E4F-8A9B-1C2D3E4F5A6B").unwrap();

      expect(a.equals(b)).toBe(true);
    });

    it("diferencia identificadores distintos", () => {
      const a = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b").unwrap();
      const b = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6c").unwrap();

      expect(a.equals(b)).toBe(false);
    });

    it("usa o valor no toString e no JSON", () => {
      const id = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b").unwrap();

      expect(String(id)).toBe("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b");
      expect(JSON.stringify({ id })).toBe(
        '{"id":"018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a6b"}',
      );
    });
  });
});

describe("montarUuidV7", () => {
  it("marca a versão 7 e a variante RFC", () => {
    const id = montarUuidV7(1_700_000_000_000, ALEATORIOS).unwrap();

    expect(id.versao).toBe(7);
    // Variante RFC: o primeiro caractere do quarto grupo é 8, 9, a ou b.
    expect(id.valor.charAt(19)).toMatch(/[89ab]/);
  });

  it("é determinístico: mesma entrada produz o mesmo identificador", () => {
    const primeiro = montarUuidV7(1_700_000_000_000, ALEATORIOS).unwrap();
    const segundo = montarUuidV7(1_700_000_000_000, ALEATORIOS).unwrap();

    expect(primeiro.equals(segundo)).toBe(true);
  });

  it("ordena por tempo — a propriedade que preserva a localidade de índice", () => {
    const antigo = montarUuidV7(1_700_000_000_000, ALEATORIOS).unwrap();
    const novo = montarUuidV7(1_700_000_001_000, ALEATORIOS).unwrap();

    // Comparação lexicográfica do texto reflete a ordem cronológica.
    expect(antigo.valor < novo.valor).toBe(true);
  });

  it("aceita o instante zero", () => {
    const id = montarUuidV7(0, ALEATORIOS).unwrap();

    expect(id.criadoEmMilissegundos).toBe(0);
  });

  it("usa a entropia fornecida, sem sortear por conta própria", () => {
    const outros = new Uint8Array([
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa,
    ]);

    const a = montarUuidV7(1_700_000_000_000, ALEATORIOS).unwrap();
    const b = montarUuidV7(1_700_000_000_000, outros).unwrap();

    expect(a.equals(b)).toBe(false);
  });

  it("aceita mais bytes que o necessário, usando apenas os primeiros", () => {
    const excedente = new Uint8Array([...ALEATORIOS, 0xff, 0xff]);

    const comExcedente = montarUuidV7(1_700_000_000_000, excedente).unwrap();
    const exato = montarUuidV7(1_700_000_000_000, ALEATORIOS).unwrap();

    expect(comExcedente.equals(exato)).toBe(true);
  });

  it.each([-1, 1.5, Number.NaN])("rejeita instante inválido %s", (instante) => {
    const resultado = montarUuidV7(instante, ALEATORIOS);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("UUID_TEMPO_INVALIDO");
    }
  });

  it("rejeita instante além dos 48 bits do formato", () => {
    const resultado = montarUuidV7(0xff_ff_ff_ff_ff_ff + 1, ALEATORIOS);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("UUID_TEMPO_FORA_DO_LIMITE");
    }
  });

  it("rejeita entropia insuficiente", () => {
    const resultado = montarUuidV7(1_700_000_000_000, new Uint8Array(3));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("UUID_ALEATORIOS_INSUFICIENTES");
      expect(resultado.error.detalhes?.["necessarios"]).toBe(BYTES_ALEATORIOS_UUID_V7);
    }
  });
});
