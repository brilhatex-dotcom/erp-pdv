import { Identificador } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type Balcao,
  BOLO,
  CAIXA,
  CLIENTE,
  CREDENCIAL_GERENTE,
  CREDENCIAL_SUPERVISOR,
  EAN_REFRI,
  ESTACAO,
  montarBalcao,
  OPERADOR,
  OUTRA_ESTACAO,
  quantidade,
  reais,
  SUPERVISOR,
} from "../../testes/balcao.js";

/**
 * Corrigir a venda em andamento — a rotina do balcão.
 *
 * O que importa aqui, além da conta: **quem** pode diminuir a venda e o
 * **registro** de que diminuiu. Tirar item depois de cobrar é o desvio mais
 * antigo do varejo, e a correção legítima precisa deixar rastro sem atrasar a
 * fila.
 */

let balcao: Balcao;

beforeEach(() => {
  balcao = montarBalcao();
});

const INEXISTENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e5bffff").unwrap();

describe("Alterar quantidade", () => {
  it("aumentar não pede nada nem vai para a auditoria — é o mesmo que bipar de novo", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI);

    const alterada = (
      await balcao.alterarQuantidade.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        numeroItem: 1,
        quantidade: quantidade("3", "UN"),
      })
    ).unwrap();

    expect(alterada.total.formatar()).toBe("R$ 29,70");
    expect(balcao.auditoria.registros).toHaveLength(0);
  });

  it("🔑 diminuir fica registrado com o antes e o depois", async () => {
    const venda = await balcao.vendaCom({
      codigo: EAN_REFRI,
      quantidade: quantidade("3", "UN"),
    });

    const alterada = (
      await balcao.alterarQuantidade.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        numeroItem: 1,
        quantidade: quantidade("1", "UN"),
      })
    ).unwrap();

    expect(alterada.total.formatar()).toBe("R$ 9,90");

    const [registro] = balcao.auditoria.da("QUANTIDADE_REDUZIDA");
    expect(registro?.usuarioId?.equals(OPERADOR)).toBe(true);
    expect(registro?.autorizadoPorId).toBeUndefined();
    expect(registro?.dados).toEqual({ numeroItem: 1, de: "3000", para: "1000" });
  });

  it("🔑 350 g de queijo a R$ 20,00/kg custam R$ 7,00 — a conversão é do servidor", async () => {
    const venda = await balcao.vendaCom({
      codigo: "QJO001",
      quantidade: quantidade("1", "KG"),
    });

    const alterada = (
      await balcao.alterarQuantidade.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        numeroItem: 1,
        quantidade: quantidade("350", "G"),
      })
    ).unwrap();

    expect(alterada.itens[0]?.quantidade.formatar()).toBe("0,35 kg");
    expect(alterada.total.formatar()).toBe("R$ 7,00");
  });

  it("recusa unidade que não converte para a do item", async () => {
    const venda = await balcao.vendaCom("QJO001");

    const resultado = await balcao.alterarQuantidade.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 1,
      quantidade: quantidade("2", "UN"),
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("loja que tirou a permissão do operador pede o supervisor, e grava os dois nomes", async () => {
    balcao = montarBalcao({ operadorSem: ["venda:remover_item"] });
    const venda = await balcao.vendaCom({
      codigo: EAN_REFRI,
      quantidade: quantidade("2", "UN"),
    });

    const pedido = {
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 1,
      quantidade: quantidade("1", "UN"),
    };

    const semLiberacao = await balcao.alterarQuantidade.executar(pedido);
    expect(semLiberacao.isErr() && semLiberacao.error.codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );

    const liberada = await balcao.alterarQuantidade.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_SUPERVISOR,
    });

    expect(liberada.isOk()).toBe(true);
    const [registro] = balcao.auditoria.da("QUANTIDADE_REDUZIDA");
    expect(registro?.autorizadoPorId?.equals(SUPERVISOR)).toBe(true);
  });

  it("recusa item que não existe na venda", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI);

    const resultado = await balcao.alterarQuantidade.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 9,
      quantidade: quantidade("2", "UN"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_ITEM_NAO_ENCONTRADO");
  });

  it("recusa venda inexistente", async () => {
    const resultado = await balcao.alterarQuantidade.executar({
      vendaId: INEXISTENTE,
      operadorId: OPERADOR,
      numeroItem: 1,
      quantidade: quantidade("2", "UN"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_NAO_ENCONTRADA");
  });

  it("quantidade zero é recusada pela venda, sem auditoria", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI);

    const resultado = await balcao.alterarQuantidade.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 1,
      quantidade: quantidade("0", "UN"),
    });

    expect(resultado.isErr()).toBe(true);
    expect(balcao.auditoria.registros).toHaveLength(0);
  });

  it("a liberação negada não altera nada", async () => {
    balcao = montarBalcao({ operadorSem: ["venda:remover_item"] });
    const venda = await balcao.vendaCom({
      codigo: EAN_REFRI,
      quantidade: quantidade("2", "UN"),
    });

    const resultado = await balcao.alterarQuantidade.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 1,
      quantidade: quantidade("1", "UN"),
      credencialSupervisor: { matricula: "7", pin: "000000" },
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe(
      "SUPERVISOR_CREDENCIAL_INVALIDA",
    );
    expect(venda.itens[0]?.quantidade.formatar()).toBe("2 un");
  });
});

describe("Remover item", () => {
  it("🔑 tira o item e registra o que saiu e quanto valia", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI, "BOL001");

    const alterada = (
      await balcao.removerItem.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        numeroItem: 2,
      })
    ).unwrap();

    expect(alterada.total.formatar()).toBe("R$ 9,90");

    const [registro] = balcao.auditoria.da("ITEM_REMOVIDO");
    expect(registro?.descricao).toContain("Bolo de Fubá");
    expect(registro?.descricao).toContain("R$ 12,50");
    expect(registro?.dados).toEqual({ numeroItem: 2, valor: "1250" });
  });

  it("sem a permissão, pede o supervisor", async () => {
    balcao = montarBalcao({ operadorSem: ["venda:remover_item"] });
    const venda = await balcao.vendaCom(EAN_REFRI);

    const resultado = await balcao.removerItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 1,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("AUTORIZACAO_NECESSARIA");
    expect(venda.itens).toHaveLength(1);
  });

  it("recusa item que não existe", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI);

    const resultado = await balcao.removerItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 5,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_ITEM_NAO_ENCONTRADO");
  });

  it("recusa venda inexistente", async () => {
    const resultado = await balcao.removerItem.executar({
      vendaId: INEXISTENTE,
      operadorId: OPERADOR,
      numeroItem: 1,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("venda já paga não perde item", async () => {
    // O pagamento cobre a venda: tirar um item agora deixaria o cliente com
    // troco a receber que ninguém calculou.
    const venda = await balcao.vendaCom(EAN_REFRI);
    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "PIX",
      valor: reais("9,90"),
    });
    await balcao.finalizarVenda.executar({ vendaId: venda.id });

    const resultado = await balcao.removerItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      numeroItem: 1,
    });

    expect(resultado.isErr()).toBe(true);
    expect(balcao.auditoria.da("ITEM_REMOVIDO")).toHaveLength(0);
  });
});

describe("Remover pagamento", () => {
  it("🔑 tirar o débito tocado por engano devolve o valor ao que falta, e fica registrado", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CARTAO_DEBITO",
      valor: reais("12,50"),
    });

    const alterada = (
      await balcao.removerPagamento.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        indice: 0,
      })
    ).unwrap();

    expect(alterada.pagamentos).toHaveLength(0);
    expect(alterada.faltaPagar.formatar()).toBe("R$ 12,50");

    const [registro] = balcao.auditoria.da("PAGAMENTO_REMOVIDO");
    expect(registro?.dados).toEqual({ forma: "CARTAO_DEBITO", valor: "1250" });
  });

  it("recusa índice fora da lista", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.removerPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      indice: 3,
    });

    expect(resultado.isErr()).toBe(true);
    expect(balcao.auditoria.registros).toHaveLength(0);
  });

  it("recusa venda inexistente", async () => {
    const resultado = await balcao.removerPagamento.executar({
      vendaId: INEXISTENTE,
      operadorId: OPERADOR,
      indice: 0,
    });

    expect(resultado.isErr()).toBe(true);
  });
});

describe("Desconto", () => {
  it("exige reais ou percentual — nunca os dois, nunca nenhum", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const nenhum = await balcao.aplicarDesconto.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "VENDA" },
    });
    const ambos = await balcao.aplicarDesconto.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "VENDA" },
      valor: reais("1,00"),
      percentualBps: 100,
    });

    expect(nenhum.isErr() && nenhum.error.codigo).toBe("DESCONTO_FORMATO");
    expect(ambos.isErr() && ambos.error.codigo).toBe("DESCONTO_FORMATO");
  });

  it("🔑 dentro da alçada do operador: aplica e registra", async () => {
    // 5% de R$ 12,50 = R$ 0,625, truncado em R$ 0,62: o operador que pode dar
    // 5% e pede 5% não chama ninguém.
    const venda = await balcao.vendaCom("BOL001");

    const alterada = (
      await balcao.aplicarDesconto.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        alvo: { tipo: "ITEM", numero: 1 },
        percentualBps: 500,
      })
    ).unwrap();

    expect(alterada.total.formatar()).toBe("R$ 11,88");

    const [registro] = balcao.auditoria.da("DESCONTO_ITEM");
    expect(registro?.descricao).toContain("R$ 0,62");
    expect(registro?.autorizadoPorId).toBeUndefined();
    expect(registro?.dados?.["numeroItem"]).toBe(1);
  });

  it("🔑 acima da alçada pede o supervisor; liberado, guarda quem liberou", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const pedido = {
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "ITEM" as const, numero: 1 },
      valor: reais("2,50"), // 20%
    };

    const semLiberacao = await balcao.aplicarDesconto.executar(pedido);
    expect(semLiberacao.isErr() && semLiberacao.error.codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );
    expect(venda.total.formatar()).toBe("R$ 12,50");

    // O supervisor vai até 15% no item: 20% é do gerente.
    const comSupervisor = await balcao.aplicarDesconto.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_SUPERVISOR,
    });
    expect(comSupervisor.isErr() && comSupervisor.error.codigo).toBe(
      "SUPERVISOR_SEM_ALCADA",
    );

    const comGerente = await balcao.aplicarDesconto.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_GERENTE,
    });

    expect(comGerente.unwrap().total.formatar()).toBe("R$ 10,00");
    expect(balcao.auditoria.da("DESCONTO_ITEM")[0]?.autorizadoPorId).toBeDefined();
  });

  it("no total da venda, em reais", async () => {
    // 3% de R$ 22,40 = R$ 0,672: R$ 0,60 está dentro da alçada da venda.
    const venda = await balcao.vendaCom(EAN_REFRI, "BOL001");

    const alterada = (
      await balcao.aplicarDesconto.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        alvo: { tipo: "VENDA" },
        valor: reais("0,60"),
      })
    ).unwrap();

    expect(alterada.total.formatar()).toBe("R$ 21,80");
    expect(balcao.auditoria.da("DESCONTO_VENDA")).toHaveLength(1);
  });

  it("desconto maior que o valor é recusado antes de chamar alguém", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.aplicarDesconto.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "ITEM", numero: 1 },
      valor: reais("13,00"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("DESCONTO_MAIOR_QUE_VALOR");
    expect(balcao.outbox.eventos).toHaveLength(0);
  });

  it("desconto zero tira o desconto, sem pedir nada e sem registro", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.aplicarDesconto.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "ITEM", numero: 1 },
      valor: reais("0,50"),
    });

    const alterada = (
      await balcao.aplicarDesconto.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        alvo: { tipo: "ITEM", numero: 1 },
        valor: reais("0,00"),
      })
    ).unwrap();

    expect(alterada.total.formatar()).toBe("R$ 12,50");
    expect(balcao.auditoria.da("DESCONTO_ITEM")).toHaveLength(1);
  });

  it("recusa item que não existe", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.aplicarDesconto.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "ITEM", numero: 7 },
      percentualBps: 100,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_ITEM_NAO_ENCONTRADO");
  });

  it("recusa venda inexistente", async () => {
    const resultado = await balcao.aplicarDesconto.executar({
      vendaId: INEXISTENTE,
      operadorId: OPERADOR,
      alvo: { tipo: "VENDA" },
      percentualBps: 100,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("percentual fracionado aparece como o dono lê: 2,5%", async () => {
    // 2 kg de queijo a R$ 20,00 = R$ 40,00; 2,5% = R$ 1,00 exato.
    const venda = await balcao.vendaCom({
      codigo: "QJO001",
      quantidade: quantidade("2", "KG"),
    });

    await balcao.aplicarDesconto.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "VENDA" },
      percentualBps: 250,
    });

    expect(balcao.auditoria.da("DESCONTO_VENDA")[0]?.descricao).toContain(
      "R$ 1,00 (2,5%)",
    );
  });

  it("o registro mostra o percentual que de fato saiu, não o digitado", async () => {
    // 2,5% de R$ 12,50 = R$ 0,3125 → R$ 0,31, que é 2,48% do bolo. O dono
    // confere o dinheiro; o percentual ao lado precisa ser o desse dinheiro.
    const venda = await balcao.vendaCom("BOL001");

    await balcao.aplicarDesconto.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      alvo: { tipo: "VENDA" },
      percentualBps: 250,
    });

    expect(balcao.auditoria.da("DESCONTO_VENDA")[0]?.descricao).toContain(
      "R$ 0,31 (2,48%)",
    );
  });
});

describe("Cliente na venda", () => {
  it("põe e tira o cliente", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const com = (
      await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId: CLIENTE })
    ).unwrap();
    expect(com.clienteId?.equals(CLIENTE)).toBe(true);

    const sem = (
      await balcao.identificarCliente.executar({ vendaId: venda.id })
    ).unwrap();
    expect(sem.clienteId).toBeUndefined();
  });

  it("recusa cliente que não existe", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.identificarCliente.executar({
      vendaId: venda.id,
      clienteId: INEXISTENTE,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("CLIENTE_NAO_ENCONTRADO");
  });

  it("🔑 cliente desativado não entra — o mau pagador continuaria comprando fiado", async () => {
    (await balcao.clientes.porId(CLIENTE))?.desativar();
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.identificarCliente.executar({
      vendaId: venda.id,
      clienteId: CLIENTE,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("CLIENTE_INATIVO");
  });

  it("recusa venda inexistente", async () => {
    const resultado = await balcao.identificarCliente.executar({ vendaId: INEXISTENTE });

    expect(resultado.isErr()).toBe(true);
  });

  it("venda concluída não troca de cliente", async () => {
    const venda = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "12,50" }],
      "BOL001",
    );

    const resultado = await balcao.identificarCliente.executar({ vendaId: venda.id });

    expect(resultado.isErr()).toBe(true);
  });
});

describe("Guardar e retomar", () => {
  it("🔑 guarda com rótulo, e o operador retoma no mesmo caixa", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const guardada = (
      await balcao.suspenderVenda.executar({ vendaId: venda.id, rotulo: "Dona Maria" })
    ).unwrap();

    expect(guardada.estaSuspensa).toBe(true);
    expect(guardada.suspensao?.rotulo).toBe("Dona Maria");

    const retomada = (
      await balcao.retomarVenda.executar({ vendaId: venda.id, estacaoId: ESTACAO })
    ).unwrap();

    expect(retomada.estaSuspensa).toBe(false);
    expect(retomada.itens).toHaveLength(1);
  });

  it("venda vazia não se guarda", async () => {
    const venda = await balcao.vendaCom();

    const resultado = await balcao.suspenderVenda.executar({ vendaId: venda.id });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_SEM_ITENS");
  });

  it("recusa guardar venda inexistente", async () => {
    const resultado = await balcao.suspenderVenda.executar({ vendaId: INEXISTENTE });

    expect(resultado.isErr()).toBe(true);
  });

  it("🔑 só o caixa que guardou retoma", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.suspenderVenda.executar({ vendaId: venda.id });

    const resultado = await balcao.retomarVenda.executar({
      vendaId: venda.id,
      estacaoId: OUTRA_ESTACAO,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_DE_OUTRA_ESTACAO");
  });

  it("🔑 venda de caixa fechado não volta — o turno já foi conferido", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.suspenderVenda.executar({ vendaId: venda.id });

    (await balcao.caixas.porId(CAIXA))?.fechar(reais("100,00"), new Date());

    const resultado = await balcao.retomarVenda.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_DE_CAIXA_FECHADO");
  });

  it("recusa retomar venda inexistente", async () => {
    const resultado = await balcao.retomarVenda.executar({
      vendaId: INEXISTENTE,
      estacaoId: ESTACAO,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("retomar a que já está aberta não é erro — o reenvio da tela não pode falhar", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.retomarVenda.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("venda cancelada não volta", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.suspenderVenda.executar({ vendaId: venda.id });
    await balcao.cancelarVenda.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      motivo: "Cliente não voltou",
    });

    const resultado = await balcao.retomarVenda.executar({
      vendaId: venda.id,
      estacaoId: ESTACAO,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("guardada, não aceita item novo", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.suspenderVenda.executar({ vendaId: venda.id });

    const resultado = await balcao.adicionarItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      codigo: EAN_REFRI,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_SUSPENSA");
  });

  it("o bolo continua sendo do mesmo produto depois de guardado", async () => {
    const venda = await balcao.vendaCom("BOL001");
    await balcao.suspenderVenda.executar({ vendaId: venda.id });

    expect(venda.itens[0]?.produtoId.equals(BOLO)).toBe(true);
  });
});
