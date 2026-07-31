import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { type DadosSessaoCaixa, type ResumoVenda, SessaoCaixa } from "./SessaoCaixa.js";

const SESSAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5b01").unwrap();
const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5b02").unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5b03").unwrap();
const GERENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5b04").unwrap();
const VENDA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5b05").unwrap();
const AGORA = new Date("2026-07-30T08:00:00.000Z");

let contador = 0;
function proximoId(): Identificador {
  contador += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-9${contador.toString().padStart(11, "0")}`,
  ).unwrap();
}

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function abrir(sobrescritas: Partial<DadosSessaoCaixa> = {}): SessaoCaixa {
  const resultado = SessaoCaixa.abrir({
    id: SESSAO,
    estacaoId: ESTACAO,
    operadorId: OPERADOR,
    fundoTroco: reais("100,00"),
    abertaEm: AGORA,
    ...sobrescritas,
  });

  if (resultado.isErr()) {
    throw new Error(`fixture inválida: ${resultado.error.toString()}`);
  }
  return resultado.unwrap();
}

function venda(sobrescritas: Partial<ResumoVenda> = {}): ResumoVenda {
  return {
    vendaId: VENDA,
    total: reais("50,00"),
    pagamentos: [{ forma: "DINHEIRO", valor: reais("50,00") }],
    troco: Dinheiro.zero(),
    ...sobrescritas,
  };
}

describe("SessaoCaixa — abertura", () => {
  it("abre com fundo de troco", () => {
    const caixa = abrir();

    expect(caixa.status).toBe("ABERTA");
    expect(caixa.fundoTroco.formatar()).toBe("R$ 100,00");
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");
  });

  it("guarda estação e operador", () => {
    const caixa = abrir();

    expect(caixa.estacaoId.equals(ESTACAO)).toBe(true);
    expect(caixa.operadorId.equals(OPERADOR)).toBe(true);
    expect(caixa.abertaEm).toBe(AGORA);
    expect(caixa.fechadaEm).toBeUndefined();
    expect(caixa.estaAberta).toBe(true);
  });

  it("aceita abrir sem fundo de troco", () => {
    expect(abrir({ fundoTroco: Dinheiro.zero() }).esperadoEmDinheiro.ehZero()).toBe(true);
  });

  it("rejeita fundo de troco negativo", () => {
    const resultado = SessaoCaixa.abrir({
      id: SESSAO,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("-1,00"),
      abertaEm: AGORA,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_FUNDO_NEGATIVO");
    }
  });

  it("nasce sem vendas e sem conferência", () => {
    const caixa = abrir();

    expect(caixa.quantidadeVendas).toBe(0);
    expect(caixa.totalVendido.ehZero()).toBe(true);
    expect(caixa.conferencia).toBeUndefined();
  });
});

describe("SessaoCaixa — vendas", () => {
  it("acumula venda em dinheiro na gaveta", () => {
    const caixa = abrir();
    caixa.registrarVenda(venda());

    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 150,00");
    expect(caixa.quantidadeVendas).toBe(1);
    expect(caixa.totalVendido.formatar()).toBe("R$ 50,00");
  });

  it("desconta o troco devolvido da gaveta", () => {
    const caixa = abrir();
    caixa.registrarVenda(
      venda({
        pagamentos: [{ forma: "DINHEIRO", valor: reais("100,00") }],
        troco: reais("50,00"),
      }),
    );

    // 100 de fundo + 100 recebidos − 50 de troco = 150
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 150,00");
    expect(caixa.trocoDevolvido.formatar()).toBe("R$ 50,00");
  });

  it("🔑 cartão e PIX não entram na gaveta", () => {
    const caixa = abrir();
    caixa.registrarVenda(
      venda({ pagamentos: [{ forma: "CARTAO_DEBITO", valor: reais("50,00") }] }),
    );
    caixa.registrarVenda(
      venda({ pagamentos: [{ forma: "PIX", valor: reais("30,00") }] }),
    );

    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");
    expect(caixa.recebidoEm("CARTAO_DEBITO").formatar()).toBe("R$ 50,00");
    expect(caixa.recebidoEm("PIX").formatar()).toBe("R$ 30,00");
  });

  it("🔑 crediário conta como A RECEBER, fora da gaveta", () => {
    // Somá-lo faria o caixa acusar falta todo dia, e o operador aprenderia a
    // ignorar a divergência — justamente o sinal que precisa ser levado a sério.
    const caixa = abrir();
    caixa.registrarVenda(
      venda({ pagamentos: [{ forma: "CREDIARIO", valor: reais("50,00") }] }),
    );

    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");
    expect(caixa.totalAReceber.formatar()).toBe("R$ 50,00");
  });

  it("separa as formas numa venda dividida", () => {
    const caixa = abrir();
    caixa.registrarVenda(
      venda({
        total: reais("100,00"),
        pagamentos: [
          { forma: "DINHEIRO", valor: reais("40,00") },
          { forma: "CARTAO_CREDITO", valor: reais("60,00") },
        ],
      }),
    );

    expect(caixa.recebidoEm("DINHEIRO").formatar()).toBe("R$ 40,00");
    expect(caixa.recebidoEm("CARTAO_CREDITO").formatar()).toBe("R$ 60,00");
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 140,00");
  });

  it("acumula várias vendas na mesma forma", () => {
    const caixa = abrir();
    caixa.registrarVenda(venda());
    caixa.registrarVenda(venda());

    expect(caixa.recebidoEm("DINHEIRO").formatar()).toBe("R$ 100,00");
    expect(caixa.quantidadeVendas).toBe(2);
  });

  it("devolve zero para forma sem recebimento", () => {
    expect(abrir().recebidoEm("CHEQUE").ehZero()).toBe(true);
  });
});

describe("SessaoCaixa — cancelamento", () => {
  it("estorna os valores da venda cancelada", () => {
    const caixa = abrir();
    const resumo = venda();
    caixa.registrarVenda(resumo);

    caixa.registrarCancelamento(resumo);

    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");
    expect(caixa.quantidadeVendas).toBe(0);
    expect(caixa.totalVendido.ehZero()).toBe(true);
  });

  it("estorna também o troco devolvido", () => {
    const caixa = abrir();
    const resumo = venda({
      pagamentos: [{ forma: "DINHEIRO", valor: reais("100,00") }],
      troco: reais("50,00"),
    });
    caixa.registrarVenda(resumo);

    caixa.registrarCancelamento(resumo);

    expect(caixa.trocoDevolvido.ehZero()).toBe(true);
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");
  });

  it("estorna crediário do total a receber", () => {
    const caixa = abrir();
    const resumo = venda({
      pagamentos: [{ forma: "CREDIARIO", valor: reais("50,00") }],
    });
    caixa.registrarVenda(resumo);

    caixa.registrarCancelamento(resumo);

    expect(caixa.totalAReceber.ehZero()).toBe(true);
  });
});

describe("SessaoCaixa — sangria", () => {
  it("retira dinheiro da gaveta", () => {
    const caixa = abrir();

    const resultado = caixa.registrarSangria(
      proximoId(),
      reais("60,00"),
      "Retirada para o cofre",
      OPERADOR,
      AGORA,
    );

    expect(resultado.isOk()).toBe(true);
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 40,00");
    expect(caixa.sangrias.formatar()).toBe("R$ 60,00");
  });

  it("guarda quem autorizou", () => {
    const caixa = abrir();

    const movimento = caixa
      .registrarSangria(proximoId(), reais("50,00"), "Cofre", OPERADOR, AGORA, GERENTE)
      .unwrap();

    expect(movimento.autorizadoPorId?.equals(GERENTE)).toBe(true);
    expect(movimento.usuarioId.equals(OPERADOR)).toBe(true);
  });

  it("recusa retirar mais do que há na gaveta", () => {
    // Aceitar criaria uma falta inventada pelo próprio registro.
    const resultado = abrir().registrarSangria(
      proximoId(),
      reais("150,00"),
      "Cofre",
      OPERADOR,
      AGORA,
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_SANGRIA_MAIOR_QUE_SALDO");
      expect(resultado.error.mensagem).toContain("R$ 100,00");
    }
  });

  it("permite retirar exatamente o disponível", () => {
    const caixa = abrir();

    expect(
      caixa
        .registrarSangria(proximoId(), reais("100,00"), "Cofre", OPERADOR, AGORA)
        .isOk(),
    ).toBe(true);
    expect(caixa.esperadoEmDinheiro.ehZero()).toBe(true);
  });

  it("exige motivo", () => {
    const resultado = abrir().registrarSangria(
      proximoId(),
      reais("50,00"),
      "   ",
      OPERADOR,
      AGORA,
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("MOVIMENTO_CAIXA_MOTIVO_OBRIGATORIO");
      expect(resultado.error.mensagem).toBe("Informe o motivo da sangria.");
    }
  });

  it("rejeita valor zero", () => {
    const resultado = abrir().registrarSangria(
      proximoId(),
      Dinheiro.zero(),
      "Cofre",
      OPERADOR,
      AGORA,
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("MOVIMENTO_CAIXA_VALOR_INVALIDO");
    }
  });

  it("considera vendas ao calcular o disponível", () => {
    const caixa = abrir();
    caixa.registrarVenda(venda());

    expect(
      caixa
        .registrarSangria(proximoId(), reais("150,00"), "Cofre", OPERADOR, AGORA)
        .isOk(),
    ).toBe(true);
  });
});

describe("SessaoCaixa — suprimento", () => {
  it("acrescenta dinheiro à gaveta", () => {
    const caixa = abrir();

    expect(
      caixa
        .registrarSuprimento(proximoId(), reais("50,00"), "Troco", OPERADOR, AGORA)
        .isOk(),
    ).toBe(true);
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 150,00");
    expect(caixa.suprimentos.formatar()).toBe("R$ 50,00");
  });

  it("exige motivo", () => {
    const resultado = abrir().registrarSuprimento(
      proximoId(),
      reais("50,00"),
      "",
      OPERADOR,
      AGORA,
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("Informe o motivo do suprimento.");
    }
  });

  it("registra o movimento na lista", () => {
    const caixa = abrir();
    caixa.registrarSuprimento(proximoId(), reais("50,00"), "Troco", OPERADOR, AGORA);
    caixa.registrarSangria(proximoId(), reais("20,00"), "Cofre", OPERADOR, AGORA);

    expect(caixa.movimentos).toHaveLength(2);
    expect(caixa.movimentos.map((m) => m.tipo)).toEqual(["SUPRIMENTO", "SANGRIA"]);
  });
});

describe("SessaoCaixa — fechamento", () => {
  it("fecha sem divergência quando a contagem bate", () => {
    const caixa = abrir();
    caixa.registrarVenda(venda());

    const conferencia = caixa.fechar(reais("150,00"), AGORA).unwrap();

    expect(conferencia.esperadoEmDinheiro.formatar()).toBe("R$ 150,00");
    expect(conferencia.divergenciaEmDinheiro.ehZero()).toBe(true);
    expect(caixa.status).toBe("FECHADA");
  });

  it("acusa falta quando conta menos que o esperado", () => {
    const caixa = abrir();
    caixa.registrarVenda(venda());

    const conferencia = caixa.fechar(reais("140,00"), AGORA).unwrap();

    expect(conferencia.divergenciaEmDinheiro.formatar()).toBe("-R$ 10,00");
  });

  it("acusa sobra quando conta mais que o esperado", () => {
    const caixa = abrir();
    caixa.registrarVenda(venda());

    const conferencia = caixa.fechar(reais("155,00"), AGORA).unwrap();

    expect(conferencia.divergenciaEmDinheiro.formatar()).toBe("R$ 5,00");
  });

  it("🔑 divergência NÃO impede o fechamento", () => {
    // Bloquear deixaria o caixa aberto indefinidamente, com a loja parada — e a
    // diferença continuaria existindo de qualquer forma.
    const caixa = abrir();

    expect(caixa.fechar(reais("0,00"), AGORA).isOk()).toBe(true);
    expect(caixa.status).toBe("FECHADA");
  });

  it("detalha a composição do esperado, para o operador entender", () => {
    const caixa = abrir();
    caixa.registrarVenda(
      venda({
        pagamentos: [{ forma: "DINHEIRO", valor: reais("100,00") }],
        troco: reais("50,00"),
      }),
    );
    caixa.registrarSuprimento(proximoId(), reais("20,00"), "Troco", OPERADOR, AGORA);
    caixa.registrarSangria(proximoId(), reais("30,00"), "Cofre", OPERADOR, AGORA);

    const c = caixa.fechar(reais("140,00"), AGORA).unwrap();

    expect(c.fundoTroco.formatar()).toBe("R$ 100,00");
    expect(c.recebidoEmDinheiro.formatar()).toBe("R$ 100,00");
    expect(c.trocoDevolvido.formatar()).toBe("R$ 50,00");
    expect(c.suprimentos.formatar()).toBe("R$ 20,00");
    expect(c.sangrias.formatar()).toBe("R$ 30,00");
    // 100 + 100 − 50 + 20 − 30 = 140
    expect(c.esperadoEmDinheiro.formatar()).toBe("R$ 140,00");
  });

  it("confere cada forma recebida", () => {
    const caixa = abrir();
    caixa.registrarVenda(
      venda({ pagamentos: [{ forma: "CARTAO_DEBITO", valor: reais("80,00") }] }),
    );

    const c = caixa
      .fechar(reais("100,00"), AGORA, { CARTAO_DEBITO: reais("75,00") })
      .unwrap();

    const cartao = c.porForma.find((f) => f.forma.codigo === "CARTAO_DEBITO");

    expect(cartao?.esperado.formatar()).toBe("R$ 80,00");
    expect(cartao?.contado?.formatar()).toBe("R$ 75,00");
    expect(cartao?.divergencia?.formatar()).toBe("-R$ 5,00");
  });

  it("deixa a divergência indefinida quando a forma não foi conferida", () => {
    const caixa = abrir();
    caixa.registrarVenda(
      venda({ pagamentos: [{ forma: "PIX", valor: reais("30,00") }] }),
    );

    const pix = caixa
      .fechar(reais("100,00"), AGORA)
      .unwrap()
      .porForma.find((f) => f.forma.codigo === "PIX");

    expect(pix?.esperado.formatar()).toBe("R$ 30,00");
    expect(pix?.contado).toBeUndefined();
    expect(pix?.divergencia).toBeUndefined();
  });

  it("🔑 não confronta crediário com contagem", () => {
    const caixa = abrir();
    caixa.registrarVenda(
      venda({ pagamentos: [{ forma: "CREDIARIO", valor: reais("50,00") }] }),
    );

    const c = caixa.fechar(reais("100,00"), AGORA).unwrap();

    expect(c.porForma.some((f) => f.forma.codigo === "CREDIARIO")).toBe(false);
    expect(c.totalAReceber.formatar()).toBe("R$ 50,00");
    expect(c.divergenciaEmDinheiro.ehZero()).toBe(true);
  });

  it("resume o movimento do dia", () => {
    const caixa = abrir();
    caixa.registrarVenda(venda());
    caixa.registrarVenda(venda({ total: reais("30,00") }));

    const c = caixa.fechar(reais("180,00"), AGORA).unwrap();

    expect(c.quantidadeVendas).toBe(2);
    expect(c.totalVendido.formatar()).toBe("R$ 80,00");
  });

  it("registra o evento de fechamento", () => {
    const caixa = abrir();
    caixa.fechar(reais("100,00"), AGORA);

    expect(caixa.eventos[0]?.tipo).toBe("CaixaFechado");
  });

  it("guarda a conferência para consulta posterior", () => {
    const caixa = abrir();
    caixa.fechar(reais("90,00"), AGORA);

    expect(caixa.conferencia?.divergenciaEmDinheiro.formatar()).toBe("-R$ 10,00");
    expect(caixa.fechadaEm).toBe(AGORA);
  });

  it("rejeita contagem negativa", () => {
    const resultado = abrir().fechar(reais("-1,00"), AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_CONTAGEM_NEGATIVA");
    }
  });
});

describe("SessaoCaixa — caixa fechado", () => {
  function fechada(): SessaoCaixa {
    const caixa = abrir();
    caixa.fechar(reais("100,00"), AGORA);
    return caixa;
  }

  it.each([
    ["registrar venda", (c: SessaoCaixa) => c.registrarVenda(venda())],
    ["registrar cancelamento", (c: SessaoCaixa) => c.registrarCancelamento(venda())],
    [
      "sangria",
      (c: SessaoCaixa) =>
        c.registrarSangria(proximoId(), reais("10,00"), "x", OPERADOR, AGORA),
    ],
    [
      "suprimento",
      (c: SessaoCaixa) =>
        c.registrarSuprimento(proximoId(), reais("10,00"), "x", OPERADOR, AGORA),
    ],
    ["fechar de novo", (c: SessaoCaixa) => c.fechar(reais("100,00"), AGORA)],
  ])("recusa %s num caixa fechado", (_descricao, acao) => {
    const resultado = acao(fechada());

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_NAO_ESTA_ABERTO");
      expect(resultado.error.mensagem).toBe("Este caixa já foi fechado.");
    }
  });

  it("deixa de estar aberto", () => {
    expect(fechada().estaAberta).toBe(false);
  });
});
