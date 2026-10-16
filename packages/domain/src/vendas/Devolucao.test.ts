import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import {
  type DadosDevolucao,
  Devolucao,
  ehDestinoDevolucao,
  ehFormaReembolso,
  type JaDevolvido,
} from "./Devolucao.js";
import { Venda } from "./Venda.js";

const ID = (sufixo: string): Identificador =>
  Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a${sufixo}`).unwrap();

const VENDA = ID("01");
const CAIXA = ID("02");
const OPERADOR = ID("03");
const ESTACAO = ID("04");
const CLIENTE = ID("05");
const SUPERVISOR = ID("06");
const REFRIGERANTE = ID("07");
const PAO = ID("08");
const DEVOLUCAO = ID("09");
const AGORA = new Date("2026-10-16T12:00:00.000Z");

const reais = (valor: string): Dinheiro => Dinheiro.deReais(valor).unwrap();
const un = (valor: string): Quantidade => Quantidade.de(valor, "UN").unwrap();
const kg = (valor: string): Quantidade => Quantidade.de(valor, "KG").unwrap();

/**
 * Venda finalizada: 3 refrigerantes a R$ 10,00 (item 1) + 0,500 kg de pão a
 * R$ 20,00/kg (item 2) = R$ 40,00, paga em dinheiro.
 */
function vendaFinalizada(
  configurar?: (venda: Venda) => void,
  pagar: (venda: Venda) => void = (venda) => {
    venda.registrarPagamento("DINHEIRO", venda.total);
  },
): Venda {
  const venda = Venda.iniciar({
    id: VENDA,
    numero: 15,
    sessaoCaixaId: CAIXA,
    operadorId: OPERADOR,
    estacaoId: ESTACAO,
    abertaEm: AGORA,
  }).unwrap();

  venda.adicionarItem({
    produtoId: REFRIGERANTE,
    descricao: "Refrigerante",
    quantidade: un("3"),
    precoUnitario: reais("10,00"),
  });
  venda.adicionarItem({
    produtoId: PAO,
    descricao: "Pão francês",
    quantidade: kg("0,500"),
    precoUnitario: reais("20,00"),
  });

  configurar?.(venda);
  pagar(venda);
  venda.finalizar(AGORA).unwrap();
  venda.coletarEventos();

  return venda;
}

function dados(venda: Venda, sobrescritas: Partial<DadosDevolucao> = {}): DadosDevolucao {
  return {
    id: DEVOLUCAO,
    venda,
    itens: [{ numeroItem: 1, quantidade: un("1"), destino: "ESTOQUE" }],
    jaDevolvido: new Map(),
    jaReembolsadoAVista: Dinheiro.zero(),
    formaReembolso: "DINHEIRO",
    motivo: "Produto vencido",
    usuarioId: SUPERVISOR,
    sessaoCaixaId: CAIXA,
    agora: AGORA,
    ...sobrescritas,
  };
}

function registrar(venda: Venda, sobrescritas: Partial<DadosDevolucao> = {}): Devolucao {
  const resultado = Devolucao.registrar(dados(venda, sobrescritas));
  if (resultado.isErr()) throw new Error(resultado.error.toString());
  return resultado.unwrap();
}

function codigoDoErro(
  venda: Venda,
  sobrescritas: Partial<DadosDevolucao> = {},
): string | undefined {
  const resultado = Devolucao.registrar(dados(venda, sobrescritas));
  return resultado.isErr() ? resultado.error.codigo : undefined;
}

describe("Devolução — parcial", () => {
  it("🔑 devolve 1 de 3 refrigerantes: R$ 10,00", () => {
    const devolucao = registrar(vendaFinalizada());

    expect(devolucao.valorTotal.formatar()).toBe("R$ 10,00");
    expect(devolucao.itens).toHaveLength(1);
    expect(devolucao.itens[0]).toMatchObject({
      numeroItem: 1,
      produtoId: REFRIGERANTE,
      descricao: "Refrigerante",
      destino: "ESTOQUE",
    });
    expect(devolucao.vendaId.equals(VENDA)).toBe(true);
    expect(devolucao.numeroVenda).toBe(15);
  });

  it("devolve parte do peso: 0,200 kg de pão a R$ 20,00 = R$ 4,00", () => {
    const devolucao = registrar(vendaFinalizada(), {
      itens: [{ numeroItem: 2, quantidade: kg("0,200"), destino: "PERDA" }],
    });

    expect(devolucao.valorTotal.formatar()).toBe("R$ 4,00");
    expect(devolucao.itens[0]?.destino).toBe("PERDA");
  });

  it("🔑 devolve o que o cliente pagou, com o desconto rateado", () => {
    // R$ 4,00 de desconto na venda de R$ 40,00: cada real de item vale 0,90.
    const venda = vendaFinalizada((aberta) => {
      aberta.aplicarDescontoVenda(reais("4,00"));
    });

    const devolucao = registrar(venda);

    expect(devolucao.valorTotal.formatar()).toBe("R$ 9,00");
  });

  it("a última parte leva o resto: três terços somam o item ao centavo", () => {
    // Item de R$ 10,00 em 3 unidades com R$ 0,01 de desconto: R$ 29,99.
    const venda = vendaFinalizada((aberta) => {
      aberta.aplicarDescontoItem(1, reais("0,01"));
    });

    const primeira = registrar(venda).itens[0];
    expect(primeira?.valor.formatar()).toBe("R$ 10,00");

    const jaDevolvido = new Map<number, JaDevolvido>([
      [1, { milesimos: 1000n, valor: reais("10,00") }],
    ]);
    const segunda = registrar(venda, { jaDevolvido }).itens[0];
    expect(segunda?.valor.formatar()).toBe("R$ 10,00");

    const terceira = registrar(venda, {
      jaDevolvido: new Map([[1, { milesimos: 2000n, valor: reais("20,00") }]]),
    }).itens[0];

    // 29,99 − 20,00: o centavo do desconto fecha aqui, e não some.
    expect(terceira?.valor.formatar()).toBe("R$ 9,99");
  });

  it("devolve vários itens de uma vez", () => {
    const devolucao = registrar(vendaFinalizada(), {
      itens: [
        { numeroItem: 1, quantidade: un("3"), destino: "ESTOQUE" },
        { numeroItem: 2, quantidade: kg("0,500"), destino: "PERDA" },
      ],
    });

    expect(devolucao.valorTotal.formatar()).toBe("R$ 40,00");
  });
});

describe("Devolução — limites", () => {
  it("🔑 não devolve mais do que foi vendido", () => {
    expect(
      codigoDoErro(vendaFinalizada(), {
        itens: [{ numeroItem: 1, quantidade: un("4"), destino: "ESTOQUE" }],
      }),
    ).toBe("DEVOLUCAO_ACIMA_DO_VENDIDO");
  });

  it("desconta o que já voltou antes e diz quanto ainda cabe", () => {
    const resultado = Devolucao.registrar(
      dados(vendaFinalizada(), {
        itens: [{ numeroItem: 1, quantidade: un("2"), destino: "ESTOQUE" }],
        jaDevolvido: new Map([[1, { milesimos: 2000n, valor: reais("20,00") }]]),
      }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("De Refrigerante, ainda podem voltar 1 un.");
    }
  });

  it("avisa quando o item já voltou inteiro", () => {
    const resultado = Devolucao.registrar(
      dados(vendaFinalizada(), {
        jaDevolvido: new Map([[1, { milesimos: 3000n, valor: reais("30,00") }]]),
      }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("Refrigerante já foi devolvido por inteiro.");
    }
  });

  it("recusa item que não é da venda", () => {
    expect(
      codigoDoErro(vendaFinalizada(), {
        itens: [{ numeroItem: 9, quantidade: un("1"), destino: "ESTOQUE" }],
      }),
    ).toBe("DEVOLUCAO_ITEM_NAO_ENCONTRADO");
  });

  it("recusa outra unidade", () => {
    expect(
      codigoDoErro(vendaFinalizada(), {
        itens: [{ numeroItem: 2, quantidade: un("1"), destino: "ESTOQUE" }],
      }),
    ).toBe("DEVOLUCAO_UNIDADE_DIFERENTE");
  });

  it("recusa quantidade zero", () => {
    expect(
      codigoDoErro(vendaFinalizada(), {
        itens: [{ numeroItem: 1, quantidade: un("0"), destino: "ESTOQUE" }],
      }),
    ).toBe("DEVOLUCAO_QUANTIDADE_INVALIDA");
  });

  it("recusa o mesmo item duas vezes no pedido", () => {
    expect(
      codigoDoErro(vendaFinalizada(), {
        itens: [
          { numeroItem: 1, quantidade: un("1"), destino: "ESTOQUE" },
          { numeroItem: 1, quantidade: un("1"), destino: "PERDA" },
        ],
      }),
    ).toBe("DEVOLUCAO_ITEM_REPETIDO");
  });

  it("recusa devolução sem itens", () => {
    expect(codigoDoErro(vendaFinalizada(), { itens: [] })).toBe("DEVOLUCAO_SEM_ITENS");
  });

  it.each([
    ["vazio", "   ", "DEVOLUCAO_MOTIVO_OBRIGATORIO"],
    ["longo", "x".repeat(201), "DEVOLUCAO_MOTIVO_LONGO"],
  ])("recusa motivo %s", (_caso, motivo, codigo) => {
    expect(codigoDoErro(vendaFinalizada(), { motivo })).toBe(codigo);
  });
});

describe("Devolução — situação da venda", () => {
  it("só devolve venda concluída", () => {
    const aberta = Venda.iniciar({
      id: VENDA,
      numero: 1,
      sessaoCaixaId: CAIXA,
      operadorId: OPERADOR,
      estacaoId: ESTACAO,
      abertaEm: AGORA,
    }).unwrap();

    expect(codigoDoErro(aberta)).toBe("DEVOLUCAO_VENDA_NAO_FINALIZADA");
  });

  it("não devolve venda cancelada", () => {
    const venda = vendaFinalizada();
    venda.cancelar({ motivo: "Erro", solicitadoPorId: OPERADOR, agora: AGORA });

    expect(codigoDoErro(venda)).toBe("DEVOLUCAO_VENDA_CANCELADA");
  });
});

describe("Devolução — fiado e reembolso à vista", () => {
  function vendaNoFiado(): Venda {
    return vendaFinalizada(
      (aberta) => {
        aberta.identificarCliente(CLIENTE);
      },
      (aberta) => {
        aberta.registrarPagamento("CREDIARIO", aberta.total);
      },
    );
  }

  it("🔑 venda inteira no fiado não devolve dinheiro da gaveta", () => {
    const resultado = Devolucao.registrar(dados(vendaNoFiado()));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("DEVOLUCAO_ACIMA_DO_PAGO");
      expect(resultado.error.mensagem).toContain("abater do fiado");
    }
  });

  it("venda no fiado abate a dívida", () => {
    const devolucao = registrar(vendaNoFiado(), {
      formaReembolso: "ABATER_FIADO",
      sessaoCaixaId: undefined,
    });

    expect(devolucao.formaReembolso).toBe("ABATER_FIADO");
    expect(devolucao.saiDaGaveta).toBe(false);
    expect(devolucao.sessaoCaixaId).toBeUndefined();
  });

  it("não abate fiado de venda que não foi no fiado", () => {
    expect(codigoDoErro(vendaFinalizada(), { formaReembolso: "ABATER_FIADO" })).toBe(
      "DEVOLUCAO_SEM_FIADO",
    );
  });

  it("venda mista devolve à vista só o que foi pago à vista", () => {
    // R$ 40,00 = R$ 15,00 em dinheiro + R$ 25,00 no fiado.
    const venda = vendaFinalizada(
      (aberta) => {
        aberta.identificarCliente(CLIENTE);
      },
      (aberta) => {
        aberta.registrarPagamento("DINHEIRO", reais("15,00"));
        aberta.registrarPagamento("CREDIARIO", reais("25,00"));
      },
    );

    expect(registrar(venda).valorTotal.formatar()).toBe("R$ 10,00");

    const resultado = Devolucao.registrar(
      dados(venda, {
        itens: [{ numeroItem: 1, quantidade: un("2"), destino: "ESTOQUE" }],
        jaReembolsadoAVista: reais("10,00"),
      }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toContain("R$ 5,00");
    }
  });

  it.each(["PIX", "CARTAO"] as const)("reembolso em %s não sai da gaveta", (forma) => {
    const devolucao = registrar(vendaFinalizada(), { formaReembolso: forma });

    expect(devolucao.saiDaGaveta).toBe(false);
  });

  it("reembolso em dinheiro sai da gaveta", () => {
    expect(registrar(vendaFinalizada()).saiDaGaveta).toBe(true);
  });
});

describe("Devolução — evento e reconstituição", () => {
  it("registra o fato para estoque, caixa e fiscal reagirem", () => {
    const devolucao = registrar(vendaFinalizada(), {
      itens: [
        { numeroItem: 1, quantidade: un("1"), destino: "ESTOQUE" },
        { numeroItem: 2, quantidade: kg("0,100"), destino: "PERDA" },
      ],
    });

    const [evento] = devolucao.coletarEventos();

    expect(evento).toMatchObject({
      tipo: "DevolucaoRegistrada",
      vendaId: VENDA,
      formaReembolso: "DINHEIRO",
    });
    expect(evento?.agregadoId.equals(DEVOLUCAO)).toBe(true);
  });

  it("guarda motivo, responsável e quem autorizou", () => {
    const devolucao = registrar(vendaFinalizada(), {
      motivo: "  Embalagem furada  ",
      autorizadoPorId: OPERADOR,
    });

    expect(devolucao.motivo).toBe("Embalagem furada");
    expect(devolucao.usuarioId.equals(SUPERVISOR)).toBe(true);
    expect(devolucao.autorizadoPorId?.equals(OPERADOR)).toBe(true);
    expect(devolucao.sessaoCaixaId?.equals(CAIXA)).toBe(true);
    expect(devolucao.ocorridaEm).toBe(AGORA);
  });

  it("reconstrói sem recalcular", () => {
    const devolucao = Devolucao.reconstituir({
      id: DEVOLUCAO,
      vendaId: VENDA,
      numeroVenda: 15,
      itens: [
        {
          numeroItem: 1,
          produtoId: REFRIGERANTE,
          descricao: "Refrigerante",
          quantidade: un("1"),
          valor: reais("9,99"),
          destino: "ESTOQUE",
        },
      ],
      formaReembolso: "PIX",
      motivo: "Troca",
      usuarioId: SUPERVISOR,
      autorizadoPorId: undefined,
      sessaoCaixaId: undefined,
      ocorridaEm: AGORA,
    });

    expect(devolucao.valorTotal.formatar()).toBe("R$ 9,99");
    expect(devolucao.eventos).toHaveLength(0);
  });
});

describe("Devolução — valores aceitos", () => {
  it("reconhece formas de reembolso e destinos", () => {
    expect(ehFormaReembolso("ABATER_FIADO")).toBe(true);
    expect(ehFormaReembolso("VALE")).toBe(false);
    expect(ehDestinoDevolucao("PERDA")).toBe(true);
    expect(ehDestinoDevolucao("LIXO")).toBe(false);
  });
});
