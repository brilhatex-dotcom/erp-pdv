import { Identificador } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type Balcao,
  CAIXA,
  CLIENTE,
  CREDENCIAL_GERENTE,
  CREDENCIAL_SUPERVISOR,
  EAN_REFRI,
  GERENTE,
  montarBalcao,
  OPERADOR,
  quantidade,
  reais,
  REFRI,
  SUPERVISOR,
} from "../../testes/balcao.js";

/**
 * Cancelamento — a operação que desfaz uma venda.
 *
 * Aberta, ela é descartada: nada saiu do estoque nem entrou no caixa. Concluída,
 * tudo volta junto, na mesma transação: estoque, caixa e fiado. O que se
 * confere aqui é que nada fica pela metade, e que o registro diz quem pediu,
 * quem liberou e por quê.
 */

let balcao: Balcao;

beforeEach(() => {
  balcao = montarBalcao();
});

const MINUTO = 60_000;

describe("Cancelar venda aberta (descartar)", () => {
  it("venda vazia some sem pedir nada e sem registro", async () => {
    const venda = await balcao.vendaCom();

    const saida = (
      await balcao.cancelarVenda.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        motivo: "Cliente desistiu",
      })
    ).unwrap();

    expect(saida.venda.status).toBe("CANCELADA");
    expect(saida.estornada).toBe(false);
    expect(saida.estornos).toEqual([]);
    expect(balcao.auditoria.registros).toHaveLength(0);
  });

  it("🔑 com itens, fica registrada com o motivo e o que havia nela", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI, "BOL001");

    (
      await balcao.cancelarVenda.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        motivo: "Cliente desistiu",
      })
    ).unwrap();

    const [registro] = balcao.auditoria.da("VENDA_DESCARTADA");
    expect(registro?.descricao).toContain("2 item(ns), R$ 22,40");
    expect(registro?.descricao).toContain("Cliente desistiu");
    expect(venda.cancelamento?.solicitadoPorId.equals(OPERADOR)).toBe(true);
  });

  it("🔑 o Pix já registrado aparece como estorno a fazer — o operador devolve", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "PIX",
      valor: reais("5,00"),
    });

    const saida = (
      await balcao.cancelarVenda.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        motivo: "Cliente desistiu",
      })
    ).unwrap();

    expect(saida.estornos.map((estorno) => estorno.valor.formatar())).toEqual([
      "R$ 5,00",
    ]);
    // Nada saiu do estoque, nada entrou no caixa.
    expect(balcao.estoque.movimentos).toHaveLength(0);
  });

  it("sem a alçada de tirar item, o descarte pede o supervisor", async () => {
    balcao = montarBalcao({ operadorSem: ["venda:remover_item"] });
    const venda = await balcao.vendaCom("BOL001");

    const pedido = { vendaId: venda.id, operadorId: OPERADOR, motivo: "Desistiu" };
    const semLiberacao = await balcao.cancelarVenda.executar(pedido);

    expect(semLiberacao.isErr() && semLiberacao.error.codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );

    const liberada = await balcao.cancelarVenda.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_SUPERVISOR,
    });

    expect(liberada.isOk()).toBe(true);
    expect(venda.cancelamento?.autorizadoPorId?.equals(SUPERVISOR)).toBe(true);
  });

  it("motivo em branco é recusado", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.cancelarVenda.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      motivo: "  ",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_MOTIVO_OBRIGATORIO");
    expect(venda.status).toBe("ABERTA");
  });

  it("recusa venda inexistente", async () => {
    const resultado = await balcao.cancelarVenda.executar({
      vendaId: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e5bffff").unwrap(),
      operadorId: OPERADOR,
      motivo: "Teste",
    });

    expect(resultado.isErr()).toBe(true);
  });
});

describe("Cancelar venda concluída", () => {
  it("🔑 o operador pede, o supervisor libera, e tudo volta na mesma transação", async () => {
    // R$ 12,50 + R$ 9,90 pagos com R$ 50,00: troco de R$ 27,60.
    const venda = await balcao.vendaConcluida(
      [{ forma: "DINHEIRO", valor: "50,00" }],
      "BOL001",
      EAN_REFRI,
    );
    const caixa = (await balcao.caixas.porId(CAIXA))!;
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 122,40");

    const pedido = {
      vendaId: venda.id,
      operadorId: OPERADOR,
      motivo: "Cliente desistiu da compra",
    };

    const semLiberacao = await balcao.cancelarVenda.executar(pedido);
    expect(semLiberacao.isErr() && semLiberacao.error.codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );

    const saida = (
      await balcao.cancelarVenda.executar({
        ...pedido,
        credencialSupervisor: CREDENCIAL_SUPERVISOR,
      })
    ).unwrap();

    expect(saida.estornada).toBe(true);
    // Volta ao cliente o que ficou na gaveta: R$ 50,00 − R$ 27,60 de troco.
    expect(saida.estornos).toEqual([{ forma: "Dinheiro", valor: reais("22,40") }]);

    // Estoque: uma saída por item na venda, um estorno por item no cancelamento.
    const estornos = balcao.estoque.movimentos.filter((m) => m.tipo === "ESTORNO_VENDA");
    expect(estornos).toHaveLength(2);

    // Caixa: o esperado volta ao fundo de troco, e o cancelamento aparece.
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");
    expect(caixa.cancelamentos.quantidade).toBe(1);
    expect(caixa.cancelamentos.total.formatar()).toBe("R$ 22,40");

    const [registro] = balcao.auditoria.da("VENDA_CANCELADA");
    expect(registro?.usuarioId?.equals(OPERADOR)).toBe(true);
    expect(registro?.autorizadoPorId?.equals(SUPERVISOR)).toBe(true);
    expect(registro?.descricao).toContain("Cliente desistiu da compra");

    expect(balcao.outbox.eventos.some((evento) => evento.tipo === "VendaCancelada")).toBe(
      true,
    );
  });

  it("🔑 o supervisor só libera dentro da janela dele; depois, o gerente", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "12,50" }],
      "BOL001",
    );
    balcao.relogio.avancar(45 * MINUTO);

    const pedido = {
      vendaId: venda.id,
      operadorId: OPERADOR,
      motivo: "Erro de lançamento",
    };

    const comSupervisor = await balcao.cancelarVenda.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_SUPERVISOR,
    });
    expect(comSupervisor.isErr() && comSupervisor.error.codigo).toBe(
      "SUPERVISOR_SEM_ALCADA",
    );

    const comGerente = await balcao.cancelarVenda.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_GERENTE,
    });
    expect(comGerente.isOk()).toBe(true);
    expect(venda.cancelamento?.autorizadoPorId?.equals(GERENTE)).toBe(true);
  });

  it("o supervisor cancela a própria venda sem pedir ninguém", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "12,50" }],
      "BOL001",
    );

    const saida = await balcao.cancelarVenda.executar({
      vendaId: venda.id,
      operadorId: SUPERVISOR,
      motivo: "Erro de lançamento",
    });

    expect(saida.isOk()).toBe(true);
    expect(venda.cancelamento?.autorizadoPorId).toBeUndefined();
  });

  it("🔑 depois do caixa fechado, o caminho é a devolução", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "12,50" }],
      "BOL001",
    );
    (await balcao.caixas.porId(CAIXA))!.fechar(reais("100,00"), new Date());

    const resultado = await balcao.cancelarVenda.executar({
      vendaId: venda.id,
      operadorId: GERENTE,
      motivo: "Cliente voltou",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_DE_CAIXA_FECHADO");
    expect(resultado.isErr() && resultado.error.mensagem).toContain("devolução");
  });

  it("venda com devolução não se cancela — o resto é outra devolução", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "22,40" }],
      "BOL001",
      EAN_REFRI,
    );
    (
      await balcao.registrarDevolucao.executar({
        vendaId: venda.id,
        estacaoId: venda.estacaoId,
        operadorId: SUPERVISOR,
        itens: [{ numeroItem: 2, quantidade: quantidade("1", "UN"), destino: "ESTOQUE" }],
        formaReembolso: "PIX",
        motivo: "Refrigerante quente",
      })
    ).unwrap();

    const resultado = await balcao.cancelarVenda.executar({
      vendaId: venda.id,
      operadorId: GERENTE,
      motivo: "Desistiu do resto",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_COM_DEVOLUCAO");
  });

  it("🔑 cancelar venda no fiado cancela o título junto", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId: CLIENTE });
    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("12,50"),
    });
    await balcao.finalizarVenda.executar({ vendaId: venda.id });

    const [titulo] = await balcao.titulos.porDocumento(venda.id);
    expect(titulo?.saldo.formatar()).toBe("R$ 12,50");

    const saida = (
      await balcao.cancelarVenda.executar({
        vendaId: venda.id,
        operadorId: GERENTE,
        motivo: "Lançado no cliente errado",
      })
    ).unwrap();

    expect(titulo?.estaCancelado).toBe(true);
    // Fiado não devolve dinheiro: a dívida é que some.
    expect(saida.estornos).toEqual([]);
  });

  it("🔑 fiado já parcialmente pago trava o cancelamento — estorne o recebimento antes", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId: CLIENTE });
    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("12,50"),
    });
    await balcao.finalizarVenda.executar({ vendaId: venda.id });

    const [titulo] = await balcao.titulos.porDocumento(venda.id);
    titulo!
      .registrarBaixa({
        id: balcao.geradorId.proximo(),
        valor: reais("5,00"),
        ocorridaEm: new Date(),
        usuarioId: OPERADOR,
        forma: "DINHEIRO",
      })
      .unwrap();

    const resultado = await balcao.cancelarVenda.executar({
      vendaId: venda.id,
      operadorId: GERENTE,
      motivo: "Lançado no cliente errado",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_COM_FIADO_RECEBIDO");
    expect(venda.status).toBe("FINALIZADA");
    expect(balcao.estoque.movimentos.some((m) => m.tipo === "ESTORNO_VENDA")).toBe(false);
  });

  it("cancelar duas vezes é recusado", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "9,90" }],
      EAN_REFRI,
    );
    const pedido = { vendaId: venda.id, operadorId: GERENTE, motivo: "Erro" };

    await balcao.cancelarVenda.executar(pedido);
    const segunda = await balcao.cancelarVenda.executar(pedido);

    expect(segunda.isErr() && segunda.error.codigo).toBe("VENDA_JA_CANCELADA");
    expect(
      balcao.estoque.movimentos.filter((m) => m.tipo === "ESTORNO_VENDA"),
    ).toHaveLength(1);
  });

  it("o estoque volta na unidade e na quantidade vendidas", async () => {
    const venda = await balcao.vendaConcluida([{ forma: "PIX", valor: "19,80" }], {
      codigo: EAN_REFRI,
      quantidade: quantidade("2", "UN"),
    });

    await balcao.cancelarVenda.executar({
      vendaId: venda.id,
      operadorId: GERENTE,
      motivo: "Erro",
    });

    const saldo = await balcao.estoque.saldo(REFRI, "UN");
    expect(saldo.quantidade.formatar()).toBe("0 un");
  });
});
