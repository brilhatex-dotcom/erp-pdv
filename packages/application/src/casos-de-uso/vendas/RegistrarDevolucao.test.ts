import { Identificador } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type Balcao,
  BOLO,
  CAIXA,
  CLIENTE,
  CREDENCIAL_GERENTE,
  EAN_REFRI,
  ESTACAO,
  GERENTE,
  montarBalcao,
  OPERADOR,
  quantidade,
  reais,
  REFRI,
  SUPERVISOR,
} from "../../testes/balcao.js";

/**
 * Devolução — total ou parcial, ligada à venda original.
 *
 * O que não pode acontecer: a mercadoria voltar sem o dinheiro sair (ou o
 * contrário), o mesmo item voltar duas vezes, e a gaveta pagar em espécie o
 * que o cliente comprou no fiado.
 */

let balcao: Balcao;

beforeEach(() => {
  balcao = montarBalcao();
});

/** Bolo + refrigerante (R$ 22,40) pagos com R$ 50,00. */
async function vendaEmDinheiro() {
  return balcao.vendaConcluida(
    [{ forma: "DINHEIRO", valor: "50,00" }],
    "BOL001",
    EAN_REFRI,
  );
}

describe("Devolução em dinheiro", () => {
  it("🔑 devolução parcial: o refrigerante volta à prateleira e R$ 9,90 saem da gaveta", async () => {
    const venda = await vendaEmDinheiro();
    const caixa = (await balcao.caixas.porId(CAIXA))!;
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 122,40");

    const devolucao = (
      await balcao.registrarDevolucao.executar({
        vendaId: venda.id,
        estacaoId: ESTACAO,
        operadorId: SUPERVISOR,
        itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
        formaReembolso: "DINHEIRO",
        motivo: "Refrigerante quente",
      })
    ).unwrap();

    expect(devolucao.valorTotal.formatar()).toBe("R$ 9,90");

    // A gaveta: o esperado cai pelo que saiu, e o fechamento mostra a devolução.
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 112,50");
    expect(caixa.devolvidoEmDinheiro.formatar()).toBe("R$ 9,90");
    expect(caixa.devolucoes.quantidade).toBe(1);

    // O estoque: o refrigerante volta; o bolo, que ficou com o cliente, não.
    expect((await balcao.estoque.saldo(REFRI, "UN")).quantidade.formatar()).toBe("0 un");
    expect((await balcao.estoque.saldo(BOLO, "UN")).quantidade.formatar()).toBe("-1 un");

    const [registro] = balcao.auditoria.da("DEVOLUCAO");
    expect(registro?.descricao).toContain("R$ 9,90");
    expect(registro?.descricao).toContain("em dinheiro");
    expect(registro?.descricao).toContain("Refrigerante quente");

    expect(balcao.devolucoes.itens).toHaveLength(1);
    expect(
      balcao.outbox.eventos.some((evento) => evento.tipo === "DevolucaoRegistrada"),
    ).toBe(true);
  });

  it("🔑 produto estragado volta e sai como perda — os dois movimentos ficam no histórico", async () => {
    const venda = await vendaEmDinheiro();

    await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      itens: [{ numeroItem: 1, quantidade: quantidade("1", "UN"), destino: "PERDA" }],
      formaReembolso: "DINHEIRO",
      motivo: "Bolo mofado",
    });

    const doBolo = balcao.estoque.movimentos.filter((m) => m.produtoId.equals(BOLO));
    expect(doBolo.map((m) => m.tipo)).toEqual(["SAIDA", "DEVOLUCAO_CLIENTE", "PERDA"]);
    // Vendido, devolvido e perdido: o saldo continua o da venda.
    expect((await balcao.estoque.saldo(BOLO, "UN")).quantidade.formatar()).toBe("-1 un");
  });

  it("🔑 o operador não tira dinheiro da gaveta, nem para devolução", async () => {
    const venda = await vendaEmDinheiro();

    const resultado = await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "DINHEIRO",
      motivo: "Refrigerante quente",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("OPERACAO_NEGADA");
    expect(balcao.devolucoes.itens).toHaveLength(0);
  });

  it("acima do teto do supervisor, o gerente libera — e o nome dele fica na devolução", async () => {
    // 20 bolos = R$ 250,00, acima dos R$ 200,00 do supervisor.
    const venda = await balcao.vendaConcluida([{ forma: "DINHEIRO", valor: "250,00" }], {
      codigo: "BOL001",
      quantidade: quantidade("20", "UN"),
    });

    const pedido = {
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      itens: [
        {
          numeroItem: 1,
          quantidade: quantidade("20", "UN"),
          destino: "ESTOQUE" as const,
        },
      ],
      formaReembolso: "DINHEIRO" as const,
      motivo: "Encomenda cancelada",
    };

    const semLiberacao = await balcao.registrarDevolucao.executar(pedido);
    expect(semLiberacao.isErr() && semLiberacao.error.codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );

    const liberada = (
      await balcao.registrarDevolucao.executar({
        ...pedido,
        credencialSupervisor: CREDENCIAL_GERENTE,
      })
    ).unwrap();

    expect(liberada.autorizadoPorId?.equals(GERENTE)).toBe(true);
    expect(balcao.auditoria.da("DEVOLUCAO")[0]?.autorizadoPorId?.equals(GERENTE)).toBe(
      true,
    );
  });

  it("sem caixa aberto não há de onde tirar o dinheiro", async () => {
    const venda = await vendaEmDinheiro();
    (await balcao.caixas.porId(CAIXA))!.fechar(reais("122,40"), new Date());

    const resultado = await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: GERENTE,
      itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "DINHEIRO",
      motivo: "Refrigerante quente",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("DEVOLUCAO_SEM_CAIXA");
  });
});

describe("Devolução fora da gaveta", () => {
  it("Pix sem caixa aberto: fica registrada, e o fechamento não tem o que somar", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "22,40" }],
      "BOL001",
      EAN_REFRI,
    );
    (await balcao.caixas.porId(CAIXA))!.fechar(reais("100,00"), new Date());

    const devolucao = (
      await balcao.registrarDevolucao.executar({
        vendaId: venda.id,
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        itens: [{ numeroItem: 1, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
        formaReembolso: "PIX",
        motivo: "Bolo errado",
      })
    ).unwrap();

    expect(devolucao.sessaoCaixaId).toBeUndefined();
    expect(balcao.auditoria.da("DEVOLUCAO")[0]?.descricao).toContain("por Pix");
  });

  it("estorno no cartão entra no caixa aberto, mas não mexe na gaveta", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "CARTAO_DEBITO", valor: "12,50" }],
      "BOL001",
    );
    const caixa = (await balcao.caixas.porId(CAIXA))!;

    await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      itens: [{ numeroItem: 1, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "CARTAO",
      motivo: "Desistiu",
    });

    expect(caixa.devolucoes.total.formatar()).toBe("R$ 12,50");
    expect(caixa.devolvidoEmDinheiro.formatar()).toBe("R$ 0,00");
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");
    expect(balcao.auditoria.da("DEVOLUCAO")[0]?.descricao).toContain("estorno no cartão");
  });
});

describe("Devolução abatendo o fiado", () => {
  async function vendaNoFiado() {
    const venda = await balcao.vendaCom("BOL001", EAN_REFRI);
    await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId: CLIENTE });
    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("22,40"),
    });
    return (await balcao.finalizarVenda.executar({ vendaId: venda.id })).unwrap().venda;
  }

  it("🔑 a dívida cai pelo valor devolvido, sem fingir que entrou dinheiro", async () => {
    const venda = await vendaNoFiado();

    await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "ABATER_FIADO",
      motivo: "Refrigerante quente",
    });

    const [titulo] = await balcao.titulos.porDocumento(venda.id);
    expect(titulo?.saldo.formatar()).toBe("R$ 12,50");
    expect(titulo?.baixas.at(-1)?.forma).toBe("DEVOLUCAO");
  });

  it("🔑 o fiado já pago não aceita abatimento: devolva de outra forma", async () => {
    const venda = await vendaNoFiado();
    const [titulo] = await balcao.titulos.porDocumento(venda.id);
    titulo!
      .registrarBaixa({
        id: balcao.geradorId.proximo(),
        valor: reais("22,40"),
        ocorridaEm: new Date(),
        usuarioId: OPERADOR,
        forma: "DINHEIRO",
      })
      .unwrap();

    const resultado = await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "ABATER_FIADO",
      motivo: "Refrigerante quente",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("DEVOLUCAO_ACIMA_DO_FIADO");
    expect(resultado.isErr() && resultado.error.mensagem).toContain("já foi pago");
    expect(balcao.estoque.movimentos.some((m) => m.tipo === "DEVOLUCAO_CLIENTE")).toBe(
      false,
    );
  });

  it("abatimento maior que o saldo em aberto diz quanto ainda cabe", async () => {
    const venda = await vendaNoFiado();
    const [titulo] = await balcao.titulos.porDocumento(venda.id);
    titulo!
      .registrarBaixa({
        id: balcao.geradorId.proximo(),
        valor: reais("20,00"),
        ocorridaEm: new Date(),
        usuarioId: OPERADOR,
        forma: "DINHEIRO",
      })
      .unwrap();

    const resultado = await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "ABATER_FIADO",
      motivo: "Refrigerante quente",
    });

    expect(resultado.isErr() && resultado.error.mensagem).toContain("R$ 2,40");
  });

  it("🔑 o que foi comprado no fiado não sai da gaveta em espécie", async () => {
    const venda = await vendaNoFiado();

    const resultado = await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: GERENTE,
      itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "DINHEIRO",
      motivo: "Refrigerante quente",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("DEVOLUCAO_ACIMA_DO_PAGO");
  });
});

describe("Devolução — limites", () => {
  it("🔑 o mesmo item não volta duas vezes", async () => {
    const venda = await vendaEmDinheiro();
    const pedido = {
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      itens: [
        { numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" as const },
      ],
      formaReembolso: "DINHEIRO" as const,
      motivo: "Refrigerante quente",
    };

    (await balcao.registrarDevolucao.executar(pedido)).unwrap();
    const segunda = await balcao.registrarDevolucao.executar(pedido);

    expect(segunda.isErr() && segunda.error.codigo).toBe("DEVOLUCAO_ACIMA_DO_VENDIDO");
    expect(balcao.devolucoes.itens).toHaveLength(1);
  });

  it("devolução em duas vezes soma o que já voltou", async () => {
    const venda = await balcao.vendaConcluida([{ forma: "PIX", valor: "29,70" }], {
      codigo: EAN_REFRI,
      quantidade: quantidade("3", "UN"),
    });

    const devolver = (unidades: string) =>
      balcao.registrarDevolucao.executar({
        vendaId: venda.id,
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        itens: [
          { numeroItem: 1, quantidade: quantidade(unidades, "UN"), destino: "ESTOQUE" },
        ],
        formaReembolso: "PIX",
        motivo: "Sobrou da festa",
      });

    expect((await devolver("2")).isOk()).toBe(true);
    expect((await devolver("1")).isOk()).toBe(true);
    expect((await devolver("1")).isErr()).toBe(true);
  });

  it("recusa venda inexistente", async () => {
    const resultado = await balcao.registrarDevolucao.executar({
      vendaId: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e5bffff").unwrap(),
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      itens: [{ numeroItem: 1, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "PIX",
      motivo: "Teste",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_NAO_ENCONTRADA");
  });

  it("venda em andamento não tem o que devolver", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.registrarDevolucao.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      itens: [{ numeroItem: 1, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
      formaReembolso: "PIX",
      motivo: "Teste",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe(
      "DEVOLUCAO_VENDA_NAO_FINALIZADA",
    );
  });
});
