import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { type DadosTitulo, ehOrigemTitulo, ehTipoTitulo, Titulo } from "./Titulo.js";

/**
 * O título a receber e a pagar.
 *
 * É a caderneta do lojista. Os dois erros que custam dinheiro de verdade são:
 * saldo que não fecha com o que foi pago, e recebimento que some do histórico.
 * O primeiro faz o lojista cobrar errado; o segundo faz o cliente perder a
 * confiança — e a caderneta só funciona sobre confiança.
 */

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3e8${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

const EMISSAO = new Date("2026-08-01T12:00:00.000Z");
const VENCIMENTO = new Date("2026-08-31T12:00:00.000Z");
const CLIENTE = proximoId();
const VENDA = proximoId();
const OPERADOR = proximoId();

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function dados(sobrescritas: Partial<DadosTitulo> = {}): DadosTitulo {
  return {
    id: proximoId(),
    tipo: "RECEBER",
    origem: "VENDA",
    documentoId: VENDA,
    contraparteId: CLIENTE,
    contraparteNome: "Ana Maria de Souza",
    valorOriginal: reais("100,00"),
    vencimento: VENCIMENTO,
    emitidoEm: EMISSAO,
    ...sobrescritas,
  };
}

function titulo(sobrescritas: Partial<DadosTitulo> = {}): Titulo {
  return Titulo.criar(dados(sobrescritas)).unwrap();
}

function pagamentoDe(valor: string, quando = new Date("2026-08-10T12:00:00.000Z")) {
  return {
    id: proximoId(),
    valor: reais(valor),
    ocorridaEm: quando,
    usuarioId: OPERADOR,
    forma: "DINHEIRO",
  };
}

describe("cadastro", () => {
  it("nasce aberto, com o saldo cheio", () => {
    const conta = titulo();

    expect(conta.situacao).toBe("ABERTO");
    expect(conta.saldo.paraDecimal()).toBe("100.00");
    expect(conta.totalBaixado.ehZero()).toBe(true);
  });

  it("guarda o nome de quem deve, congelado no lançamento", () => {
    // O cliente pode ser renomeado depois; a caderneta precisa continuar
    // dizendo em nome de quem a dívida foi feita.
    expect(titulo().contraparteNome).toBe("Ana Maria de Souza");
  });

  it("🔑 guarda a trilha inteira: de onde veio, de quem é e quando nasceu", () => {
    // Meses depois, a pergunta do lojista é "de que compra é esta dívida". Sem
    // origem e documento, a resposta é adivinhação.
    const conta = titulo({ descricao: "Fiado do mês" });

    expect(conta.tipo).toBe("RECEBER");
    expect(conta.origem).toBe("VENDA");
    expect(conta.documentoId?.valor).toBe(VENDA.valor);
    expect(conta.contraparteId?.valor).toBe(CLIENTE.valor);
    expect(conta.valorOriginal.paraDecimal()).toBe("100.00");
    expect(conta.emitidoEm.toISOString()).toBe(EMISSAO.toISOString());
    expect(conta.vencimento.toISOString()).toBe(VENCIMENTO.toISOString());
    expect(conta.descricao).toBe("Fiado do mês");
    expect(conta.canceladoEm).toBeUndefined();
    expect(conta.motivoCancelamento).toBeUndefined();
    expect(conta.baixas).toHaveLength(0);
    expect(conta.parcela).toBeUndefined();
  });

  it("nome da contraparte em branco é recusado", () => {
    const resultado = Titulo.criar(dados({ contraparteNome: "   " }));

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error[0]?.codigo).toBe("TITULO_CONTRAPARTE_OBRIGATORIA");
  });

  it("aceita conta a pagar sem contraparte cadastrada", () => {
    // A conta de luz não tem fornecedor no cadastro, e exigi-lo faria o lojista
    // cadastrar a concessionária para lançar uma despesa.
    const conta = Titulo.criar(
      dados({
        tipo: "PAGAR",
        origem: "MANUAL",
        documentoId: undefined,
        contraparteId: undefined,
        contraparteNome: "Companhia de Energia",
      }),
    );

    expect(conta.isOk()).toBe(true);
  });

  it("🔑 título de venda sem cliente é recusado", () => {
    // Fiado sem devedor é a caderneta perdendo a única coisa que a torna útil.
    const resultado = Titulo.criar(dados({ contraparteId: undefined }));

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error[0]?.codigo).toBe("TITULO_CONTRAPARTE_OBRIGATORIA");
  });

  it("título de venda sem documento é recusado", () => {
    const resultado = Titulo.criar(dados({ documentoId: undefined }));

    expect(resultado.isErr()).toBe(true);
  });

  it("valor zero é recusado", () => {
    expect(Titulo.criar(dados({ valorOriginal: Dinheiro.zero() })).isErr()).toBe(true);
  });

  it("guarda a parcela para o carnê", () => {
    expect(titulo({ parcela: { numero: 2, de: 6 } }).parcela).toEqual({
      numero: 2,
      de: 6,
    });
  });

  it("parcela impossível é recusada", () => {
    expect(Titulo.criar(dados({ parcela: { numero: 7, de: 6 } })).isErr()).toBe(true);
    expect(Titulo.criar(dados({ parcela: { numero: 0, de: 6 } })).isErr()).toBe(true);
  });

  it("descrição longa demais é recusada", () => {
    expect(Titulo.criar(dados({ descricao: "x".repeat(201) })).isErr()).toBe(true);
  });
});

describe("baixa", () => {
  it("🔑 pagamento parcial deixa o título parcial, com o saldo certo", () => {
    // É o caso da caderneta: o cliente paga R$ 30 hoje e o resto depois.
    const conta = titulo();

    expect(conta.registrarBaixa(pagamentoDe("30,00")).isOk()).toBe(true);

    expect(conta.situacao).toBe("PARCIAL");
    expect(conta.saldo.paraDecimal()).toBe("70.00");
    expect(conta.totalBaixado.paraDecimal()).toBe("30.00");
  });

  it("vários pagamentos somam até quitar", () => {
    const conta = titulo();

    conta.registrarBaixa(pagamentoDe("30,00"));
    conta.registrarBaixa(pagamentoDe("50,00"));
    conta.registrarBaixa(pagamentoDe("20,00"));

    expect(conta.situacao).toBe("QUITADO");
    expect(conta.saldo.ehZero()).toBe(true);
    expect(conta.baixas).toHaveLength(3);
  });

  it("🔑 pagamento acima do saldo é recusado", () => {
    // Aceitar produziria saldo negativo, que na tela vira "a loja deve ao
    // cliente" — e o operador que digitou um zero a mais só descobriria no
    // acerto de contas, meses depois.
    const conta = titulo();
    conta.registrarBaixa(pagamentoDe("90,00"));

    const resultado = conta.registrarBaixa(pagamentoDe("20,00"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("BAIXA_ACIMA_DO_SALDO");
    expect(conta.saldo.paraDecimal()).toBe("10.00");
  });

  it("valor zero ou negativo é recusado", () => {
    const conta = titulo();

    expect(
      conta.registrarBaixa({ ...pagamentoDe("10,00"), valor: Dinheiro.zero() }).isErr(),
    ).toBe(true);
  });

  it("título quitado não aceita nova baixa", () => {
    const conta = titulo();
    conta.registrarBaixa(pagamentoDe("100,00"));

    const resultado = conta.registrarBaixa(pagamentoDe("10,00"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("TITULO_JA_QUITADO");
  });

  it("título cancelado não aceita baixa", () => {
    const conta = titulo();
    conta.cancelar(EMISSAO, "Lançado em duplicidade");

    expect(conta.registrarBaixa(pagamentoDe("10,00")).isErr()).toBe(true);
  });
});

describe("estorno", () => {
  it("🔑 devolve o saldo sem apagar o histórico", () => {
    // O caso real é o recebimento lançado no cliente errado, com dois homônimos
    // na lista. Os dois lançamentos ficam à vista, que é o que permite explicar
    // ao cliente o que houve.
    const conta = titulo();
    const pagamento = pagamentoDe("40,00");
    conta.registrarBaixa(pagamento);

    const resultado = conta.estornarBaixa(pagamento.id, {
      id: proximoId(),
      ocorridaEm: new Date("2026-08-11T12:00:00.000Z"),
      usuarioId: OPERADOR,
      observacao: "Lançado no cliente errado",
    });

    expect(resultado.isOk()).toBe(true);
    expect(conta.saldo.paraDecimal()).toBe("100.00");
    expect(conta.situacao).toBe("ABERTO");
    // Os dois continuam lá: o pagamento e o estorno.
    expect(conta.baixas).toHaveLength(2);
  });

  it("estorno reabre título quitado", () => {
    const conta = titulo();
    const pagamento = pagamentoDe("100,00");
    conta.registrarBaixa(pagamento);
    expect(conta.situacao).toBe("QUITADO");

    conta.estornarBaixa(pagamento.id, {
      id: proximoId(),
      ocorridaEm: EMISSAO,
      usuarioId: OPERADOR,
    });

    expect(conta.situacao).toBe("ABERTO");
  });

  it("🔑 a mesma baixa não é estornada duas vezes", () => {
    // Sem esta guarda, dois cliques no botão devolveriam o dobro ao saldo e a
    // dívida do cliente cresceria sozinha.
    const conta = titulo();
    const pagamento = pagamentoDe("40,00");
    conta.registrarBaixa(pagamento);

    conta.estornarBaixa(pagamento.id, {
      id: proximoId(),
      ocorridaEm: EMISSAO,
      usuarioId: OPERADOR,
    });

    const segundo = conta.estornarBaixa(pagamento.id, {
      id: proximoId(),
      ocorridaEm: EMISSAO,
      usuarioId: OPERADOR,
    });

    expect(segundo.isErr()).toBe(true);
    if (segundo.isErr()) expect(segundo.error.codigo).toBe("BAIXA_JA_ESTORNADA");
    expect(conta.saldo.paraDecimal()).toBe("100.00");
  });

  it("baixa inexistente não é estornada", () => {
    const resultado = titulo().estornarBaixa(proximoId(), {
      id: proximoId(),
      ocorridaEm: EMISSAO,
      usuarioId: OPERADOR,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("BAIXA_NAO_ENCONTRADA");
  });
});

describe("vencimento", () => {
  it("🔑 vence no fim do dia, não na hora exata", () => {
    // Para o lojista, um título que vence hoje não está vencido às 8h e vencido
    // às 18h. Comparar instantes colocaria na lista de cobrança quem ainda tem
    // o dia inteiro para pagar.
    const conta = titulo();

    expect(conta.estaVencidoEm(new Date("2026-08-31T23:59:00.000Z"))).toBe(false);
    expect(conta.estaVencidoEm(new Date("2026-09-01T00:01:00.000Z"))).toBe(true);
  });

  it("conta os dias de atraso para a cobrança", () => {
    const conta = titulo();

    expect(conta.diasEmAtrasoEm(new Date("2026-09-05T08:00:00.000Z"))).toBe(5);
    expect(conta.diasEmAtrasoEm(new Date("2026-08-20T08:00:00.000Z"))).toBe(0);
  });

  it("🔑 título quitado nunca está vencido", () => {
    // Um quitado aparecendo na lista de cobrança faria o lojista ligar para
    // quem já pagou — o erro que mais custa relacionamento.
    const conta = titulo();
    conta.registrarBaixa(pagamentoDe("100,00"));

    expect(conta.estaVencidoEm(new Date("2026-12-01T12:00:00.000Z"))).toBe(false);
    expect(conta.diasEmAtrasoEm(new Date("2026-12-01T12:00:00.000Z"))).toBe(0);
  });

  it("título cancelado nunca está vencido", () => {
    const conta = titulo();
    conta.cancelar(EMISSAO, "Duplicidade");

    expect(conta.estaVencidoEm(new Date("2026-12-01T12:00:00.000Z"))).toBe(false);
  });
});

describe("adiamento", () => {
  it("adia para frente — é a renegociação de balcão", () => {
    const conta = titulo();

    const resultado = conta.adiarVencimento(
      new Date("2026-09-20T12:00:00.000Z"),
      "Cliente pediu prazo",
    );

    expect(resultado.isOk()).toBe(true);
    expect(conta.vencimento.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(conta.descricao).toBe("Cliente pediu prazo");
  });

  it("🔑 não antecipa o vencimento", () => {
    // Antecipar transformaria em atraso uma dívida em dia, e o relatório de
    // cobrança passaria a chamar quem não devia ser chamado.
    const conta = titulo();

    const resultado = conta.adiarVencimento(new Date("2026-08-10T12:00:00.000Z"));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("VENCIMENTO_NAO_ADIADO");
    expect(conta.vencimento.toISOString()).toBe(VENCIMENTO.toISOString());
  });

  it("a mesma data não é adiamento", () => {
    expect(titulo().adiarVencimento(VENCIMENTO).isErr()).toBe(true);
  });

  it("título quitado não tem vencimento a adiar", () => {
    const conta = titulo();
    conta.registrarBaixa(pagamentoDe("100,00"));

    expect(conta.adiarVencimento(new Date("2026-09-20T12:00:00.000Z")).isErr()).toBe(
      true,
    );
  });

  it("título cancelado não adia", () => {
    const conta = titulo();
    conta.cancelar(EMISSAO, "Duplicidade");

    expect(conta.adiarVencimento(new Date("2026-09-20T12:00:00.000Z")).isErr()).toBe(
      true,
    );
  });
});

describe("cancelamento", () => {
  it("exige motivo por escrito", () => {
    // Um título que some sem explicação é exatamente a brecha que o controle de
    // fiado existe para fechar.
    const conta = titulo();

    const resultado = conta.cancelar(EMISSAO, "   ");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("MOTIVO_OBRIGATORIO");
    expect(conta.situacao).toBe("ABERTO");
  });

  it("cancela com motivo e sai de aberto", () => {
    const conta = titulo();

    expect(conta.cancelar(EMISSAO, "Venda cancelada").isOk()).toBe(true);
    expect(conta.situacao).toBe("CANCELADO");
    expect(conta.motivoCancelamento).toBe("Venda cancelada");
    expect(conta.canceladoEm?.toISOString()).toBe(EMISSAO.toISOString());
    expect(conta.estaCancelado).toBe(true);
  });

  it("🔑 título com recebimento não cancela", () => {
    // Cancelar levaria junto o dinheiro que entrou, sem deixar rastro. O
    // caminho é estornar antes.
    const conta = titulo();
    conta.registrarBaixa(pagamentoDe("30,00"));

    const resultado = conta.cancelar(EMISSAO, "Erro de lançamento");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("TITULO_COM_BAIXA");
  });

  it("depois de estornar, cancela", () => {
    const conta = titulo();
    const pagamento = pagamentoDe("30,00");
    conta.registrarBaixa(pagamento);
    conta.estornarBaixa(pagamento.id, {
      id: proximoId(),
      ocorridaEm: EMISSAO,
      usuarioId: OPERADOR,
    });

    expect(conta.cancelar(EMISSAO, "Erro de lançamento").isOk()).toBe(true);
  });

  it("não cancela duas vezes", () => {
    const conta = titulo();
    conta.cancelar(EMISSAO, "Duplicidade");

    expect(conta.cancelar(EMISSAO, "De novo").isErr()).toBe(true);
  });
});

describe("reconstituição", () => {
  it("não revalida o que já está no banco", () => {
    const antigo = Titulo.reconstituir(dados({ contraparteNome: "" }));

    expect(antigo.contraparteNome).toBe("");
  });

  it("volta com as baixas e o saldo calculado", () => {
    const pagamento = pagamentoDe("25,00");

    const conta = Titulo.reconstituir(
      dados({ baixas: [{ ...pagamento, tipo: "PAGAMENTO" }] }),
    );

    expect(conta.saldo.paraDecimal()).toBe("75.00");
    expect(conta.situacao).toBe("PARCIAL");
  });
});

describe("guardas de tipo", () => {
  it("reconhece tipo e origem", () => {
    expect(ehTipoTitulo("RECEBER")).toBe(true);
    expect(ehTipoTitulo("PAGAR")).toBe(true);
    expect(ehTipoTitulo("TALVEZ")).toBe(false);

    expect(ehOrigemTitulo("VENDA")).toBe(true);
    expect(ehOrigemTitulo("COMPRA")).toBe(true);
    expect(ehOrigemTitulo("MANUAL")).toBe(true);
    expect(ehOrigemTitulo("SONHO")).toBe(false);
  });
});
