import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import { Pagamento } from "./Pagamento.js";
import { type DadosVenda, Venda } from "./Venda.js";
import { type DadosItemVenda, VendaItem } from "./VendaItem.js";

const VENDA_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a01").unwrap();
const CAIXA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a02").unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a03").unwrap();
const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a04").unwrap();
const CLIENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a05").unwrap();
const GERENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a06").unwrap();
const PRODUTO_A = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a07").unwrap();
const PRODUTO_B = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5a08").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function un(valor: string): Quantidade {
  return Quantidade.de(valor, "UN").unwrap();
}

function kg(valor: string): Quantidade {
  return Quantidade.de(valor, "KG").unwrap();
}

function abrir(sobrescritas: Partial<DadosVenda> = {}): Venda {
  const resultado = Venda.iniciar({
    id: VENDA_ID,
    numero: 1,
    sessaoCaixaId: CAIXA,
    operadorId: OPERADOR,
    estacaoId: ESTACAO,
    abertaEm: AGORA,
    ...sobrescritas,
  });

  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

function item(sobrescritas: Partial<DadosItemVenda> = {}): DadosItemVenda {
  return {
    produtoId: PRODUTO_A,
    descricao: "Refrigerante Cola 2L",
    quantidade: un("1"),
    precoUnitario: reais("9,90"),
    ...sobrescritas,
  };
}

/** Venda com dois itens: 2 × R$ 9,90 + 1 × R$ 5,00 = R$ 24,80. */
function vendaComItens(): Venda {
  const venda = abrir();
  venda.adicionarItem(item({ quantidade: un("2") }));
  venda.adicionarItem(
    item({ produtoId: PRODUTO_B, descricao: "Pão", precoUnitario: reais("5,00") }),
  );
  return venda;
}

describe("Venda — abertura", () => {
  it("nasce aberta e vazia", () => {
    const venda = abrir();

    expect(venda.status).toBe("ABERTA");
    expect(venda.estaVazia).toBe(true);
    expect(venda.total.ehZero()).toBe(true);
  });

  it("guarda caixa, operador e estação para rastreio", () => {
    const venda = abrir();

    expect(venda.sessaoCaixaId.equals(CAIXA)).toBe(true);
    expect(venda.operadorId.equals(OPERADOR)).toBe(true);
    expect(venda.estacaoId.equals(ESTACAO)).toBe(true);
    expect(venda.abertaEm).toBe(AGORA);
    expect(venda.estaAberta).toBe(true);
    expect(venda.finalizadaEm).toBeUndefined();
  });

  it("nasce sem cliente — venda de balcão é anônima por padrão", () => {
    expect(abrir().clienteId).toBeUndefined();
  });

  it("aceita cliente informado na abertura", () => {
    expect(abrir({ clienteId: CLIENTE }).clienteId?.equals(CLIENTE)).toBe(true);
  });

  it("deixa de estar aberta ao finalizar", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("24,80"));
    venda.finalizar(AGORA);

    expect(venda.estaAberta).toBe(false);
  });

  it("rejeita número de venda inválido", () => {
    const resultado = Venda.iniciar({
      id: VENDA_ID,
      numero: 0,
      sessaoCaixaId: CAIXA,
      operadorId: OPERADOR,
      estacaoId: ESTACAO,
      abertaEm: AGORA,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_NUMERO_INVALIDO");
    }
  });
});

describe("Venda — itens", () => {
  it("numera os itens em sequência, como exige o XML fiscal", () => {
    const venda = vendaComItens();

    expect(venda.itens.map((i) => i.numero)).toEqual([1, 2]);
  });

  it("calcula o subtotal", () => {
    // 2 × 9,90 + 1 × 5,00 = 24,80
    expect(vendaComItens().subtotal.formatar()).toBe("R$ 24,80");
  });

  it("congela descrição e preço no momento da venda", () => {
    // Se o produto mudar de preço amanhã, esta venda não muda.
    const venda = abrir();
    venda.adicionarItem(item());

    expect(venda.itens[0]?.descricao).toBe("Refrigerante Cola 2L");
    expect(venda.itens[0]?.precoUnitario.formatar()).toBe("R$ 9,90");
  });

  it("calcula item pesável com preço por quilo", () => {
    const venda = abrir();
    venda.adicionarItem(
      item({
        descricao: "Picanha",
        quantidade: kg("1,250"),
        precoUnitario: reais("79,90"),
      }),
    );

    // 79,90 × 1,250 = 99,875 → R$ 99,88
    expect(venda.total.formatar()).toBe("R$ 99,88");
  });

  it("localiza item pelo número", () => {
    expect(vendaComItens().encontrarItem(2)?.descricao).toBe("Pão");
    expect(vendaComItens().encontrarItem(99)).toBeUndefined();
  });

  it("remove item", () => {
    const venda = vendaComItens();

    expect(venda.removerItem(1).isOk()).toBe(true);
    expect(venda.quantidadeItens).toBe(1);
    expect(venda.total.formatar()).toBe("R$ 5,00");
  });

  it("recusa remover item inexistente", () => {
    const resultado = vendaComItens().removerItem(99);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_ITEM_NAO_ENCONTRADO");
    }
  });

  it("altera a quantidade de um item", () => {
    const venda = vendaComItens();

    expect(venda.alterarQuantidadeItem(1, un("3")).isOk()).toBe(true);
    expect(venda.subtotal.formatar()).toBe("R$ 34,70");
  });

  it("recusa alterar quantidade de item inexistente", () => {
    expect(vendaComItens().alterarQuantidadeItem(99, un("1")).isErr()).toBe(true);
  });

  it("recusa quantidade em unidade diferente da do item", () => {
    const resultado = vendaComItens().alterarQuantidadeItem(1, kg("1"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_UNIDADE_DIFERENTE");
    }
  });

  it("recusa item com quantidade zero", () => {
    const resultado = abrir().adicionarItem(item({ quantidade: un("0") }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_QUANTIDADE_INVALIDA");
    }
  });

  it("recusa item sem descrição", () => {
    const resultado = abrir().adicionarItem(item({ descricao: "   " }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_DESCRICAO_VAZIA");
    }
  });

  it("recusa item com preço negativo", () => {
    const resultado = abrir().adicionarItem(item({ precoUnitario: reais("-1,00") }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_PRECO_NEGATIVO");
    }
  });

  it("aceita item com preço zero — brinde e bonificação existem", () => {
    expect(
      abrir()
        .adicionarItem(item({ precoUnitario: reais("0,00") }))
        .isOk(),
    ).toBe(true);
  });
});

describe("Venda — desconto no item", () => {
  it("abate do total", () => {
    const venda = vendaComItens();

    expect(venda.aplicarDescontoItem(1, reais("2,00")).isOk()).toBe(true);
    expect(venda.total.formatar()).toBe("R$ 22,80");
  });

  it("recusa desconto maior que o item", () => {
    const resultado = vendaComItens().aplicarDescontoItem(2, reais("6,00"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ITEM_DESCONTO_MAIOR_QUE_ITEM");
      expect(resultado.error.mensagem).toContain("R$ 5,00");
    }
  });

  it("recusa desconto negativo", () => {
    expect(vendaComItens().aplicarDescontoItem(1, reais("-1,00")).isErr()).toBe(true);
  });

  it("recusa desconto em item inexistente", () => {
    expect(vendaComItens().aplicarDescontoItem(99, reais("1,00")).isErr()).toBe(true);
  });

  it("reduz o desconto quando a quantidade cai e o torna maior que o item", () => {
    const venda = abrir();
    venda.adicionarItem(item({ quantidade: un("10") })); // R$ 99,00
    venda.aplicarDescontoItem(1, reais("50,00"));

    venda.alterarQuantidadeItem(1, un("1")); // agora vale R$ 9,90

    expect(venda.itens[0]?.desconto.formatar()).toBe("R$ 9,90");
    expect(venda.total.ehZero()).toBe(true);
  });
});

describe("Venda — desconto na venda e rateio", () => {
  it("abate do total", () => {
    const venda = vendaComItens();

    expect(venda.aplicarDescontoVenda(reais("4,80")).isOk()).toBe(true);
    expect(venda.total.formatar()).toBe("R$ 20,00");
  });

  it("🔑 rateia entre os itens sem perder centavo ao finalizar", () => {
    // É a condição que a SEFAZ confere: a soma dos itens tem que fechar com o
    // total. Um centavo perdido no rateio faz a nota ser rejeitada.
    const venda = vendaComItens();
    venda.aplicarDescontoVenda(reais("1,00"));
    venda.registrarPagamento("DINHEIRO", reais("23,80"));
    venda.finalizar(AGORA);

    const somaItens = venda.itens.reduce(
      (soma, atual) => soma.somar(atual.total),
      Dinheiro.zero(),
    );

    expect(somaItens.centavos).toBe(venda.total.centavos);
    expect(venda.total.formatar()).toBe("R$ 23,80");
  });

  it("rateia proporcionalmente ao valor de cada item", () => {
    const venda = vendaComItens(); // 19,80 e 5,00
    venda.aplicarDescontoVenda(reais("2,48")); // 10% de 24,80
    venda.registrarPagamento("DINHEIRO", reais("22,32"));
    venda.finalizar(AGORA);

    expect(venda.itens[0]?.descontoRateado.formatar()).toBe("R$ 1,98");
    expect(venda.itens[1]?.descontoRateado.formatar()).toBe("R$ 0,50");
  });

  it("distribui a sobra quando o rateio não é exato", () => {
    const venda = abrir();
    venda.adicionarItem(item({ precoUnitario: reais("1,00") }));
    venda.adicionarItem(item({ precoUnitario: reais("1,00") }));
    venda.adicionarItem(item({ precoUnitario: reais("1,00") }));
    venda.aplicarDescontoVenda(reais("1,00"));
    venda.registrarPagamento("DINHEIRO", reais("2,00"));
    venda.finalizar(AGORA);

    const rateados = venda.itens.map((i) => i.descontoRateado.centavos);

    expect(rateados).toEqual([34n, 33n, 33n]);
    expect(rateados.reduce((a, b) => a + b, 0n)).toBe(100n);
  });

  it("zera o rateio quando não há desconto de venda", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("24,80"));
    venda.finalizar(AGORA);

    expect(venda.itens.every((i) => i.descontoRateado.ehZero())).toBe(true);
  });

  it("recusa desconto maior que a venda", () => {
    const resultado = vendaComItens().aplicarDescontoVenda(reais("25,00"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_DESCONTO_MAIOR_QUE_TOTAL");
    }
  });

  it("recusa desconto negativo", () => {
    expect(vendaComItens().aplicarDescontoVenda(reais("-1,00")).isErr()).toBe(true);
  });

  it("considera o desconto dos itens ao limitar o desconto da venda", () => {
    const venda = vendaComItens();
    venda.aplicarDescontoItem(1, reais("19,80"));

    // Sobrou R$ 5,00 de margem para desconto.
    expect(venda.aplicarDescontoVenda(reais("5,00")).isOk()).toBe(true);
    expect(venda.aplicarDescontoVenda(reais("5,01")).isErr()).toBe(true);
  });

  it("zera o desconto da venda quando um item é adicionado depois", () => {
    // O desconto foi negociado sobre outro conjunto de itens.
    const venda = vendaComItens();
    venda.aplicarDescontoVenda(reais("4,80"));

    venda.adicionarItem(item({ precoUnitario: reais("1,00") }));

    expect(venda.descontoVenda.ehZero()).toBe(true);
  });

  it("zera o desconto da venda quando um item é removido", () => {
    const venda = vendaComItens();
    venda.aplicarDescontoVenda(reais("4,80"));

    venda.removerItem(1);

    expect(venda.descontoVenda.ehZero()).toBe(true);
  });

  it("zera o desconto da venda quando a quantidade muda", () => {
    const venda = vendaComItens();
    venda.aplicarDescontoVenda(reais("4,80"));

    venda.alterarQuantidadeItem(1, un("5"));

    expect(venda.descontoVenda.ehZero()).toBe(true);
  });
});

describe("Venda — pagamentos", () => {
  it("aceita pagamento em dinheiro", () => {
    const venda = vendaComItens();

    expect(venda.registrarPagamento("DINHEIRO", reais("24,80")).isOk()).toBe(true);
    expect(venda.faltaPagar.ehZero()).toBe(true);
  });

  it("aceita pagamento dividido entre formas — rotina no balcão", () => {
    const venda = vendaComItens();

    venda.registrarPagamento("CARTAO_DEBITO", reais("20,00"));
    venda.registrarPagamento("DINHEIRO", reais("4,80"));

    expect(venda.totalPago.formatar()).toBe("R$ 24,80");
    expect(venda.faltaPagar.ehZero()).toBe(true);
  });

  it("calcula quanto ainda falta", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("PIX", reais("10,00"));

    expect(venda.faltaPagar.formatar()).toBe("R$ 14,80");
  });

  it("recusa pagamento antes de haver item", () => {
    const resultado = abrir().registrarPagamento("DINHEIRO", reais("10,00"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_SEM_ITENS");
    }
  });

  it("recusa pagamento com valor zero", () => {
    expect(vendaComItens().registrarPagamento("DINHEIRO", reais("0,00")).isErr()).toBe(
      true,
    );
  });

  it("remove pagamento registrado por engano", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("10,00"));

    expect(venda.removerPagamento(0).isOk()).toBe(true);
    expect(venda.pagamentos).toHaveLength(0);
  });

  it("recusa remover pagamento inexistente", () => {
    const resultado = vendaComItens().removerPagamento(5);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_PAGAMENTO_NAO_ENCONTRADO");
    }
  });

  it("guarda a autorização da maquininha", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("CARTAO_CREDITO", reais("24,80"), {
      autorizacao: "NSU123456",
      parcelas: 3,
    });

    expect(venda.pagamentos[0]?.autorizacao).toBe("NSU123456");
    expect(venda.pagamentos[0]?.parcelas).toBe(3);
  });
});

describe("Venda — troco", () => {
  it("calcula troco sobre pagamento em dinheiro", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("50,00"));

    expect(venda.troco.formatar()).toBe("R$ 25,20");
  });

  it("não devolve troco de cartão — excedente em cartão é cobrança a mais", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("CARTAO_DEBITO", reais("50,00"));

    expect(venda.troco.ehZero()).toBe(true);
  });

  it("limita o troco ao dinheiro efetivamente recebido", () => {
    const venda = vendaComItens(); // R$ 24,80
    venda.registrarPagamento("CARTAO_DEBITO", reais("20,00"));
    venda.registrarPagamento("DINHEIRO", reais("10,00"));

    // Excedente de R$ 5,20, todo coberto pelo dinheiro recebido.
    expect(venda.troco.formatar()).toBe("R$ 5,20");
  });

  it("não devolve troco quando o pagamento é exato", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("24,80"));

    expect(venda.troco.ehZero()).toBe(true);
  });

  it("desconta o troco do valor que fica na gaveta", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("50,00"));

    // Entraram R$ 50,00, saíram R$ 25,20 de troco.
    expect(venda.valorEmGaveta.formatar()).toBe("R$ 24,80");
  });

  it("não conta cartão nem PIX na gaveta", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("PIX", reais("24,80"));

    expect(venda.valorEmGaveta.ehZero()).toBe(true);
  });
});

describe("Venda — crediário", () => {
  it("recusa crediário sem cliente identificado", () => {
    // Vender fiado sem saber para quem é dinheiro que ninguém recebe depois.
    const resultado = vendaComItens().registrarPagamento("CREDIARIO", reais("24,80"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CREDIARIO_SEM_CLIENTE");
    }
  });

  it("aceita crediário com cliente identificado", () => {
    const venda = abrir({ clienteId: CLIENTE });
    venda.adicionarItem(item());

    expect(venda.registrarPagamento("CREDIARIO", reais("9,90")).isOk()).toBe(true);
  });

  it("🔑 crediário conta como A RECEBER, não como recebido em caixa", () => {
    // Somá-lo como dinheiro faria o caixa fechar com sobra inexistente.
    const venda = abrir({ clienteId: CLIENTE });
    venda.adicionarItem(item());
    venda.registrarPagamento("CREDIARIO", reais("9,90"));

    expect(venda.valorAReceber.formatar()).toBe("R$ 9,90");
    expect(venda.valorEmGaveta.ehZero()).toBe(true);
    expect(venda.faltaPagar.ehZero()).toBe(true);
  });

  it("separa a parte fiada da parte recebida numa venda mista", () => {
    const venda = abrir({ clienteId: CLIENTE });
    venda.adicionarItem(item({ quantidade: un("2") })); // R$ 19,80
    venda.registrarPagamento("DINHEIRO", reais("10,00"));
    venda.registrarPagamento("CREDIARIO", reais("9,80"));

    expect(venda.valorEmGaveta.formatar()).toBe("R$ 10,00");
    expect(venda.valorAReceber.formatar()).toBe("R$ 9,80");
  });

  it("permite identificar o cliente depois de iniciada a venda", () => {
    const venda = vendaComItens();

    expect(venda.identificarCliente(CLIENTE).isOk()).toBe(true);
    expect(venda.registrarPagamento("CREDIARIO", reais("24,80")).isOk()).toBe(true);
  });

  it("recusa remover o cliente quando há crediário lançado", () => {
    const venda = abrir({ clienteId: CLIENTE });
    venda.adicionarItem(item());
    venda.registrarPagamento("CREDIARIO", reais("9,90"));

    const resultado = venda.identificarCliente(undefined);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_CLIENTE_OBRIGATORIO");
    }
  });

  it("permite remover o cliente quando não há crediário", () => {
    const venda = abrir({ clienteId: CLIENTE });
    venda.adicionarItem(item());

    expect(venda.identificarCliente(undefined).isOk()).toBe(true);
  });
});

describe("Venda — finalização", () => {
  it("finaliza e registra o evento", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("24,80"));

    expect(venda.finalizar(AGORA).isOk()).toBe(true);
    expect(venda.status).toBe("FINALIZADA");
    expect(venda.finalizadaEm).toBe(AGORA);
    expect(venda.eventos[0]?.tipo).toBe("VendaFinalizada");
  });

  it("leva os itens no evento, para a baixa de estoque", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("24,80"));
    venda.finalizar(AGORA);

    const evento = venda.coletarEventos()[0];

    expect(evento).toMatchObject({ tipo: "VendaFinalizada", numero: 1 });
  });

  it("recusa finalizar venda vazia", () => {
    const resultado = abrir().finalizar(AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_SEM_ITENS");
    }
  });

  it("recusa finalizar com pagamento insuficiente", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("10,00"));

    const resultado = venda.finalizar(AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_PAGAMENTO_INSUFICIENTE");
      expect(resultado.error.mensagem).toContain("R$ 14,80");
    }
  });

  it("finaliza com pagamento maior que o total, gerando troco", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("50,00"));

    expect(venda.finalizar(AGORA).isOk()).toBe(true);
  });
});

describe("Venda — imutabilidade após finalizar", () => {
  function finalizada(): Venda {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("24,80"));
    venda.finalizar(AGORA);
    return venda;
  }

  it.each([
    ["adicionar item", (v: Venda) => v.adicionarItem(item())],
    ["remover item", (v: Venda) => v.removerItem(1)],
    ["alterar quantidade", (v: Venda) => v.alterarQuantidadeItem(1, un("5"))],
    ["desconto no item", (v: Venda) => v.aplicarDescontoItem(1, reais("1,00"))],
    ["desconto na venda", (v: Venda) => v.aplicarDescontoVenda(reais("1,00"))],
    ["pagamento", (v: Venda) => v.registrarPagamento("DINHEIRO", reais("1,00"))],
    ["remover pagamento", (v: Venda) => v.removerPagamento(0)],
    ["identificar cliente", (v: Venda) => v.identificarCliente(CLIENTE)],
    ["finalizar de novo", (v: Venda) => v.finalizar(AGORA)],
  ])("recusa %s numa venda finalizada", (_descricao, acao) => {
    const resultado = acao(finalizada());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_NAO_ESTA_ABERTA");
    }
  });

  it("informa com clareza que a venda já foi finalizada", () => {
    const resultado = finalizada().adicionarItem(item());

    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("Esta venda já foi finalizada.");
    }
  });
});

describe("Venda — cancelamento", () => {
  it("cancela venda finalizada e registra o evento de estorno", () => {
    const venda = vendaComItens();
    venda.registrarPagamento("DINHEIRO", reais("24,80"));
    venda.finalizar(AGORA);
    venda.coletarEventos();

    expect(venda.cancelar("Cliente desistiu", GERENTE, AGORA).isOk()).toBe(true);
    expect(venda.status).toBe("CANCELADA");
    expect(venda.eventos[0]?.tipo).toBe("VendaCancelada");
  });

  it("não gera evento ao descartar venda ainda aberta", () => {
    // Venda aberta nunca saiu do caixa: não movimentou estoque nem dinheiro.
    const venda = vendaComItens();

    expect(venda.cancelar("Desistência", GERENTE, AGORA).isOk()).toBe(true);
    expect(venda.eventos).toHaveLength(0);
  });

  it("exige motivo", () => {
    const resultado = vendaComItens().cancelar("   ", GERENTE, AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_MOTIVO_OBRIGATORIO");
    }
  });

  it("recusa cancelar duas vezes", () => {
    const venda = vendaComItens();
    venda.cancelar("Desistência", GERENTE, AGORA);

    const resultado = venda.cancelar("De novo", GERENTE, AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_JA_CANCELADA");
    }
  });

  it("recusa alterar venda cancelada", () => {
    const venda = vendaComItens();
    venda.cancelar("Desistência", GERENTE, AGORA);

    const resultado = venda.adicionarItem(item());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("Esta venda foi cancelada.");
    }
  });
});

describe("Venda — reconstituição", () => {
  // Reimpressão de cupom e consulta de venda passam por aqui. O que se cobra
  // é fidelidade: os mesmos valores do cupom original, inclusive se a regra de
  // rateio tiver mudado desde então.
  const item = (
    numero: number,
    dados: DadosItemVenda,
    desconto: string,
    rateado: string,
  ) => VendaItem.reconstituir(numero, dados, reais(desconto), reais(rateado));

  function reconstituida(): Venda {
    return Venda.reconstituir({
      id: VENDA_ID,
      numero: 42,
      sessaoCaixaId: CAIXA,
      operadorId: OPERADOR,
      estacaoId: ESTACAO,
      clienteId: CLIENTE,
      abertaEm: AGORA,
      status: "FINALIZADA",
      finalizadaEm: new Date("2026-07-30T12:05:00.000Z"),
      descontoVenda: reais("1,00"),
      itens: [
        item(
          1,
          {
            produtoId: PRODUTO_A,
            descricao: "REFRI",
            quantidade: un("2"),
            precoUnitario: reais("9,90"),
          },
          "0,00",
          "0,60",
        ),
        item(
          2,
          {
            produtoId: PRODUTO_B,
            descricao: "PAO",
            quantidade: kg("0,500"),
            precoUnitario: reais("26,00"),
          },
          "0,00",
          "0,40",
        ),
      ],
      pagamentos: [Pagamento.criar("DINHEIRO", reais("31,40")).unwrap()],
    });
  }

  it("volta com status, número e cliente", () => {
    const venda = reconstituida();

    expect(venda.numero).toBe(42);
    expect(venda.status).toBe("FINALIZADA");
    expect(venda.estaAberta).toBe(false);
    expect(venda.clienteId?.equals(CLIENTE)).toBe(true);
    expect(venda.finalizadaEm?.toISOString()).toBe("2026-07-30T12:05:00.000Z");
  });

  it("🔑 devolve exatamente o total do cupom original", () => {
    const venda = reconstituida();

    // 19,80 + 13,00 = 32,80, menos 1,00 de desconto na venda.
    expect(venda.subtotal.formatar()).toBe("R$ 32,80");
    expect(venda.descontoVenda.formatar()).toBe("R$ 1,00");
    expect(venda.total.formatar()).toBe("R$ 31,80");
  });

  it("preserva o desconto rateado item a item — é o que a SEFAZ conferiu", () => {
    const venda = reconstituida();

    expect(venda.itens[0]?.descontoRateado.formatar()).toBe("R$ 0,60");
    expect(venda.itens[1]?.descontoRateado.formatar()).toBe("R$ 0,40");
  });

  it("não registra evento algum — reconstituir não é um fato novo", () => {
    expect(reconstituida().eventos).toHaveLength(0);
  });

  it("continua a numeração de itens de onde parou", () => {
    const venda = Venda.reconstituir({
      id: VENDA_ID,
      numero: 7,
      sessaoCaixaId: CAIXA,
      operadorId: OPERADOR,
      estacaoId: ESTACAO,
      clienteId: undefined,
      abertaEm: AGORA,
      status: "ABERTA",
      finalizadaEm: undefined,
      descontoVenda: Dinheiro.zero(),
      itens: [
        item(
          1,
          {
            produtoId: PRODUTO_A,
            descricao: "REFRI",
            quantidade: un("1"),
            precoUnitario: reais("9,90"),
          },
          "0,00",
          "0,00",
        ),
      ],
      pagamentos: [],
    });

    const novo = venda
      .adicionarItem({
        produtoId: PRODUTO_B,
        descricao: "PAO",
        quantidade: un("1"),
        precoUnitario: reais("2,00"),
      })
      .unwrap();

    expect(novo.numero).toBe(2);
  });

  it("venda vazia reconstituída começa a numerar do primeiro item", () => {
    const venda = Venda.reconstituir({
      id: VENDA_ID,
      numero: 8,
      sessaoCaixaId: CAIXA,
      operadorId: OPERADOR,
      estacaoId: ESTACAO,
      clienteId: undefined,
      abertaEm: AGORA,
      status: "ABERTA",
      finalizadaEm: undefined,
      descontoVenda: Dinheiro.zero(),
      itens: [],
      pagamentos: [],
    });

    const novo = venda
      .adicionarItem({
        produtoId: PRODUTO_A,
        descricao: "REFRI",
        quantidade: un("1"),
        precoUnitario: reais("9,90"),
      })
      .unwrap();

    expect(novo.numero).toBe(1);
  });
});
