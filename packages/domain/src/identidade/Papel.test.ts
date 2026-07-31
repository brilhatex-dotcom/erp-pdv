import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { type DadosPapel, Papel } from "./Papel.js";
import {
  type CodigoPapelPadrao,
  MODELOS_PAPEL_PADRAO,
  papelPadrao,
} from "./papeisPadrao.js";
import { ehPermissao, PERMISSOES } from "./Permissao.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fc001").unwrap();

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function dados(sobrescritas: Partial<DadosPapel> = {}): DadosPapel {
  return {
    id: ID,
    codigo: "VENDEDOR",
    nome: "Vendedor",
    permissoes: ["venda:criar"],
    ...sobrescritas,
  };
}

describe("Catálogo de permissões", () => {
  it("reconhece as permissões declaradas e rejeita o resto", () => {
    expect(ehPermissao("venda:criar")).toBe(true);
    // O typo que a união fechada existe para pegar.
    expect(ehPermissao("venda:cancela")).toBe(false);
    expect(ehPermissao("")).toBe(false);
  });

  it("não tem permissão repetida", () => {
    expect(new Set(PERMISSOES).size).toBe(PERMISSOES.length);
  });

  it("usa sempre o formato recurso:acao", () => {
    for (const permissao of PERMISSOES) {
      expect(permissao).toMatch(/^[a-z]+:[a-z_]+$/);
    }
  });
});

describe("Papel — criação", () => {
  it("normaliza o código para maiúsculas", () => {
    expect(Papel.criar(dados({ codigo: " vendedor " })).unwrap().codigo).toBe("VENDEDOR");
  });

  it("nasce sem limites e sem ser padrão", () => {
    const papel = Papel.criar(dados()).unwrap();

    expect(papel.nome).toBe("Vendedor");
    expect(papel.limites).toEqual({});
    expect(papel.ehPadrao).toBe(false);
  });

  it("🔑 nega por padrão o que não foi concedido", () => {
    const papel = Papel.criar(dados()).unwrap();

    expect(papel.concede("venda:criar")).toBe(true);
    expect(papel.concede("venda:cancelar")).toBe(false);
  });

  it.each([
    ["com espaço", "MEU PAPEL"],
    ["começando por número", "1PAPEL"],
    ["com hífen", "MEU-PAPEL"],
    ["vazio", ""],
  ])("recusa código %s", (_descricao, codigo) => {
    const resultado = Papel.criar(dados({ codigo }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((e) => e.codigo)).toContain("PAPEL_CODIGO_INVALIDO");
    }
  });

  it("recusa nome vazio", () => {
    const resultado = Papel.criar(dados({ nome: "  " }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((e) => e.codigo)).toContain("PAPEL_NOME_VAZIO");
    }
  });

  it("🔑 recusa permissão que não existe mais no catálogo", () => {
    // Cenário real: uma permissão é removida numa versão nova e um papel
    // gravado ainda a referencia. Falhar alto é melhor que conceder no escuro.
    const resultado = Papel.criar(
      dados({ permissoes: ["venda:criar", "venda:extinta"] as never }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((e) => e.codigo)).toContain(
        "PAPEL_PERMISSAO_DESCONHECIDA",
      );
    }
  });

  it("devolve todos os erros de uma vez", () => {
    const resultado = Papel.criar(dados({ codigo: "1x", nome: "" }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.length).toBeGreaterThanOrEqual(2);
  });

  it("descarta permissão repetida", () => {
    const papel = Papel.criar(
      dados({ permissoes: ["venda:criar", "venda:criar"] }),
    ).unwrap();

    expect(papel.permissoes.size).toBe(1);
  });
});

describe("Papel — validação de limites", () => {
  it.each([
    ["negativo", -1],
    ["acima de 100%", 10_001],
    ["fracionário", 500.5],
  ])("recusa percentual %s", (_descricao, descontoMaximoItemBps) => {
    const resultado = Papel.criar(dados({ limites: { descontoMaximoItemBps } }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.map((e) => e.codigo)).toContain(
        "PAPEL_LIMITE_PERCENTUAL_INVALIDO",
      );
    }
  });

  it("aceita os extremos válidos", () => {
    expect(
      Papel.criar(
        dados({ limites: { descontoMaximoItemBps: 0, descontoMaximoVendaBps: 10_000 } }),
      ).isOk(),
    ).toBe(true);
  });

  it("valida o percentual da venda além do percentual do item", () => {
    const resultado = Papel.criar(dados({ limites: { descontoMaximoVendaBps: -5 } }));

    expect(resultado.isErr()).toBe(true);
  });

  it("recusa janela de cancelamento negativa ou quebrada", () => {
    expect(
      Papel.criar(dados({ limites: { minutosParaCancelarVenda: -1 } })).isErr(),
    ).toBe(true);
    expect(
      Papel.criar(dados({ limites: { minutosParaCancelarVenda: 1.5 } })).isErr(),
    ).toBe(true);
    expect(Papel.criar(dados({ limites: { minutosParaCancelarVenda: 0 } })).isOk()).toBe(
      true,
    );
  });

  it.each([["valorMaximoSangria"], ["estornoMaximoEmDinheiro"]] as const)(
    "recusa %s negativo",
    (campo) => {
      const resultado = Papel.criar(
        dados({ limites: { [campo]: reais("10,00").negar() } }),
      );

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.map((e) => e.codigo)).toContain("PAPEL_LIMITE_NEGATIVO");
      }
    },
  );

  it("🔑 distingue limite ausente de limite zero", () => {
    // `undefined` é "sem teto"; `0` é "não pode nada". Confundir os dois
    // liberaria a gaveta para quem não deveria.
    const semTeto = Papel.criar(dados({ limites: {} })).unwrap();
    const zerado = Papel.criar(
      dados({ limites: { valorMaximoSangria: Dinheiro.zero() } }),
    ).unwrap();

    expect(semTeto.limites.valorMaximoSangria).toBeUndefined();
    expect(zerado.limites.valorMaximoSangria?.ehZero()).toBe(true);
  });
});

describe("Papel — reconstituição", () => {
  it("volta com o que foi gravado, sem revalidar", () => {
    const papel = Papel.reconstituir(dados({ codigo: " gerente ", padrao: true }));

    expect(papel.codigo).toBe("GERENTE");
    expect(papel.ehPadrao).toBe(true);
  });
});

describe("Papéis de fábrica", () => {
  const codigos = MODELOS_PAPEL_PADRAO.map((modelo) => modelo.codigo);

  it.each(codigos)("%s é válido e marcado como padrão", (codigo) => {
    const papel = Papel.criar(papelPadrao(codigo, ID)).unwrap();

    expect(papel.ehPadrao).toBe(true);
    expect(papel.permissoes.size).toBeGreaterThan(0);
  });

  it("todos os códigos são distintos", () => {
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("🔑 o operador de caixa não sangra, não cancela e não vê custo", () => {
    const papel = Papel.criar(papelPadrao("OPERADOR_CAIXA", ID)).unwrap();

    expect(papel.concede("venda:criar")).toBe(true);
    expect(papel.concede("caixa:sangria")).toBe(false);
    expect(papel.concede("venda:cancelar")).toBe(false);
    expect(papel.concede("produto:ver_custo")).toBe(false);
    expect(papel.concede("relatorio:margem")).toBe(false);
  });

  it("🔑 o contador não escreve nada", () => {
    const papel = Papel.criar(papelPadrao("CONTADOR", ID)).unwrap();

    const escritas = [...papel.permissoes].filter(
      (permissao) =>
        !permissao.startsWith("relatorio:") && !permissao.includes("consultar"),
    );

    expect(escritas).toHaveLength(0);
  });

  it("o supervisor contém o operador, e o gerente contém o supervisor", () => {
    const operador = Papel.criar(papelPadrao("OPERADOR_CAIXA", ID)).unwrap();
    const supervisor = Papel.criar(papelPadrao("SUPERVISOR", ID)).unwrap();
    const gerente = Papel.criar(papelPadrao("GERENTE", ID)).unwrap();

    for (const permissao of operador.permissoes) {
      expect(supervisor.concede(permissao)).toBe(true);
    }
    for (const permissao of supervisor.permissoes) {
      expect(gerente.concede(permissao)).toBe(true);
    }
  });

  it("🔑 só o ADMIN configura o fiscal e mexe em usuários", () => {
    for (const codigo of codigos) {
      const papel = Papel.criar(papelPadrao(codigo, ID)).unwrap();
      const esperado = codigo === "ADMIN";

      expect(papel.concede("config:fiscal")).toBe(esperado);
      expect(papel.concede("usuario:editar_permissoes")).toBe(esperado);
    }
  });

  it("não repete permissão herdada da composição", () => {
    for (const codigo of codigos) {
      const dadosPapel = papelPadrao(codigo, ID);
      expect(new Set(dadosPapel.permissoes).size).toBe(dadosPapel.permissoes.length);
    }
  });

  it("os limites do supervisor batem com a tabela da arquitetura", () => {
    const { limites } = Papel.criar(papelPadrao("SUPERVISOR", ID)).unwrap();

    expect(limites.descontoMaximoItemBps).toBe(1500);
    expect(limites.descontoMaximoVendaBps).toBe(1000);
    expect(limites.valorMaximoSangria?.formatar()).toBe("R$ 500,00");
    expect(limites.minutosParaCancelarVenda).toBe(30);
    expect(limites.estornoMaximoEmDinheiro?.formatar()).toBe("R$ 200,00");
  });

  it("lança para papel padrão desconhecido", () => {
    expect(() => papelPadrao("INEXISTENTE" as CodigoPapelPadrao, ID)).toThrow(
      /Papel padrão desconhecido/,
    );
  });
});
