import { MovimentoEstoque } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type Balcao,
  CLIENTE,
  CLIENTE_SEM_FIADO,
  CREDENCIAL_GERENTE,
  CREDENCIAL_SUPERVISOR,
  EAN_REFRI,
  ESTACAO,
  GERENTE,
  montarBalcao,
  OPERADOR,
  OUTRA_ESTACAO,
  quantidade,
  reais,
  REFRI,
  SUPERVISOR,
} from "../../testes/balcao.js";
import { formatarPercentual } from "./apoio.js";

/**
 * As regras que a loja liga e desliga, e os exemplos que o dono confere.
 */

let balcao: Balcao;

beforeEach(() => {
  balcao = montarBalcao();
});

/** Entrada de estoque, para os testes que dependem de saldo. */
async function entrada(unidades: string, custo = "5,00"): Promise<void> {
  await balcao.estoque.registrar(
    MovimentoEstoque.criar({
      id: balcao.geradorId.proximo(),
      produtoId: REFRI,
      tipo: "ENTRADA",
      quantidade: quantidade(unidades, "UN"),
      custoUnitario: reais(custo),
      origem: { tipo: "MANUAL" },
      usuarioId: GERENTE,
      ocorridoEm: new Date(),
    }).unwrap(),
  );
}

describe("Exemplos do balcão", () => {
  it("🔑 R$ 20,00/kg × 350 g = R$ 7,00", async () => {
    const venda = await balcao.vendaCom({
      codigo: "QJO001",
      quantidade: quantidade("350", "G"),
    });

    expect(venda.itens[0]?.quantidade.formatar()).toBe("0,35 kg");
    expect(venda.total.formatar()).toBe("R$ 7,00");
  });

  it("🔑 R$ 12,50 pagos com R$ 20,00 em dinheiro: troco de R$ 7,50", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const pago = (
      await balcao.registrarPagamento.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        forma: "DINHEIRO",
        valor: reais("20,00"),
      })
    ).unwrap();

    expect(pago.faltaPagar.formatar()).toBe("R$ 0,00");
    expect(pago.troco.formatar()).toBe("R$ 7,50");
  });

  it("🔑 R$ 50,00 = R$ 20,00 em dinheiro + R$ 30,00 no Pix: saldo zero, sem troco", async () => {
    const venda = await balcao.vendaCom({
      codigo: "BOL001",
      quantidade: quantidade("4", "UN"),
    });
    expect(venda.total.formatar()).toBe("R$ 50,00");

    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "DINHEIRO",
      valor: reais("20,00"),
    });
    const pago = (
      await balcao.registrarPagamento.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        forma: "PIX",
        valor: reais("30,00"),
      })
    ).unwrap();

    expect(pago.faltaPagar.formatar()).toBe("R$ 0,00");
    expect(pago.troco.formatar()).toBe("R$ 0,00");
  });
});

describe("Bipada", () => {
  it("🔑 reler o mesmo produto soma na mesma linha e avisa que somou", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI);

    const segunda = (
      await balcao.adicionarItem.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        codigo: EAN_REFRI,
      })
    ).unwrap();

    expect(segunda.somado).toBe(true);
    expect(segunda.item.numero).toBe(1);
    expect(segunda.venda.itens).toHaveLength(1);
    expect(segunda.item.quantidade.formatar()).toBe("2 un");
  });

  it("🔑 pesável sem peso é recusado com o produto — a tela abre o campo de peso", async () => {
    const venda = await balcao.vendaCom();

    const resultado = await balcao.adicionarItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      codigo: "QJO001",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("PRODUTO_EXIGE_PESO");
    expect(resultado.isErr() && resultado.error.detalhes).toEqual({
      produto: {
        id: expect.any(String) as string,
        codigo: "QJO001",
        descricao: "Queijo Minas Frescal",
        precoVenda: "2000",
        unidade: "KG",
      },
    });
    expect(venda.itens).toHaveLength(0);
  });

  it("a venda offline importada aceita o pesável como veio da estação", async () => {
    const venda = await balcao.vendaCom();

    const resultado = await balcao.adicionarItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      codigo: "QJO001",
      origem: "IMPORTACAO",
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("unidade que não converte é recusada com a unidade do produto", async () => {
    const venda = await balcao.vendaCom();

    const resultado = await balcao.adicionarItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      codigo: "QJO001",
      quantidade: quantidade("1", "L"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe(
      "PRODUTO_UNIDADE_INCOMPATIVEL",
    );
    expect(resultado.isErr() && resultado.error.mensagem).toContain("quilo");
  });

  it("🔑 o custo da venda é o médio do estoque — e fica congelado no item", async () => {
    await entrada("10", "5,00");
    const venda = await balcao.vendaCom(EAN_REFRI);

    expect(venda.itens[0]?.custoUnitario?.formatar()).toBe("R$ 5,00");
  });

  it("sem compra lançada, vale o custo do cadastro", async () => {
    const venda = await balcao.vendaCom(EAN_REFRI);

    expect(venda.itens[0]?.custoUnitario?.formatar()).toBe("R$ 6,50");
  });

  it("🔑 sem custo nenhum, fica desconhecido — e não zero, que inventaria margem", async () => {
    const venda = await balcao.vendaCom("BOL001");

    expect(venda.itens[0]?.custoUnitario).toBeUndefined();
  });
});

describe("Venda sem estoque", () => {
  it("🔑 regra AUTORIZAR: o operador pede, o supervisor libera e fica registrado", async () => {
    balcao = montarBalcao({ configuracao: { vendaSemEstoque: "AUTORIZAR" } });
    const venda = await balcao.vendaCom();

    const pedido = { vendaId: venda.id, operadorId: OPERADOR, codigo: EAN_REFRI };
    const semLiberacao = await balcao.adicionarItem.executar(pedido);

    expect(semLiberacao.isErr() && semLiberacao.error.codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );
    expect(venda.itens).toHaveLength(0);

    const liberada = await balcao.adicionarItem.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_SUPERVISOR,
    });

    expect(liberada.isOk()).toBe(true);
    const [registro] = balcao.auditoria.da("VENDA_SEM_ESTOQUE");
    expect(registro?.autorizadoPorId?.equals(SUPERVISOR)).toBe(true);
    expect(registro?.descricao).toContain("disponível: nada");
  });

  it("🔑 confere o total na venda: com 3 no estoque, a quarta bipada é a que falta", async () => {
    balcao = montarBalcao({ configuracao: { vendaSemEstoque: "BLOQUEAR" } });
    await entrada("3");
    const venda = await balcao.vendaCom(EAN_REFRI, EAN_REFRI, EAN_REFRI);

    const quarta = await balcao.adicionarItem.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      codigo: EAN_REFRI,
    });

    expect(quarta.isErr() && quarta.error.codigo).toBe("ESTOQUE_INSUFICIENTE");
    expect(quarta.isErr() && quarta.error.mensagem).toContain("disponível: 3 un");
    expect(venda.itens[0]?.quantidade.formatar()).toBe("3 un");
  });

  it("🔑 a venda offline importada não passa pela regra — ela já aconteceu", async () => {
    balcao = montarBalcao({ configuracao: { vendaSemEstoque: "BLOQUEAR" } });
    const venda = await balcao.vendaCom();

    const importados = [];
    for (let vez = 0; vez < 2; vez += 1) {
      importados.push(
        await balcao.adicionarItem.executar({
          vendaId: venda.id,
          operadorId: OPERADOR,
          codigo: EAN_REFRI,
          origem: "IMPORTACAO",
        }),
      );
    }

    expect(importados.every((resultado) => resultado.isOk())).toBe(true);
    // Linha a linha, como no comprovante que o cliente levou.
    expect(venda.itens).toHaveLength(2);
    expect(balcao.auditoria.registros).toHaveLength(0);
  });
});

describe("Pagamento — confirmação", () => {
  it("🔑 pagamento simulado só existe no treinamento", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const real = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "PIX",
      valor: reais("12,50"),
      confirmacao: "SIMULADA",
    });
    expect(real.isErr() && real.error.codigo).toBe("PAGAMENTO_SIMULADO_RECUSADO");

    const treino = montarBalcao({ permiteSimulacao: true });
    const vendaDeTreino = await treino.vendaCom("BOL001");
    const simulado = (
      await treino.registrarPagamento.executar({
        vendaId: vendaDeTreino.id,
        operadorId: OPERADOR,
        forma: "PIX",
        valor: reais("12,50"),
        confirmacao: "SIMULADA",
      })
    ).unwrap();

    expect(simulado.pagamento.confirmacao).toBe("SIMULADA");
  });

  it("🔑 o navegador não declara 'confirmado pela integração'", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "PIX",
      valor: reais("12,50"),
      confirmacao: "INTEGRACAO",
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe(
      "PAGAMENTO_INTEGRACAO_INDISPONIVEL",
    );
  });

  it("Pix sem integração fica marcado como confirmado à mão", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const pago = (
      await balcao.registrarPagamento.executar({
        vendaId: venda.id,
        operadorId: OPERADOR,
        forma: "PIX",
        valor: reais("12,50"),
      })
    ).unwrap();

    expect(pago.pagamento.confirmacao).toBe("MANUAL");
  });

  it("🔑 o reenvio com a mesma chave não duplica o pagamento", async () => {
    const venda = await balcao.vendaCom("BOL001");
    const pedido = {
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "DINHEIRO" as const,
      valor: reais("5,00"),
      chave: "pag-0001",
    };

    await balcao.registrarPagamento.executar(pedido);
    const reenvio = (await balcao.registrarPagamento.executar(pedido)).unwrap();

    expect(venda.pagamentos).toHaveLength(1);
    expect(reenvio.faltaPagar.formatar()).toBe("R$ 7,50");
  });

  it("chave repetida com outro valor não é reenvio: a venda recusa", async () => {
    const venda = await balcao.vendaCom("BOL001");

    await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "DINHEIRO",
      valor: reais("5,00"),
      chave: "pag-0001",
    });
    const outro = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "DINHEIRO",
      valor: reais("6,00"),
      chave: "pag-0001",
    });

    expect(outro.isErr()).toBe(true);
    expect(venda.pagamentos).toHaveLength(1);
  });

  it("recusa venda inexistente", async () => {
    const venda = await balcao.vendaCom("BOL001");
    balcao.vendas.itens.clear();

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "PIX",
      valor: reais("1,00"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_NAO_ENCONTRADA");
  });
});

describe("Pagamento — fiado", () => {
  async function vendaDaCliente(clienteId = CLIENTE, codigo = "BOL001") {
    const venda = await balcao.vendaCom(codigo);
    await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId });
    return venda;
  }

  it("🔑 loja que não vende fiado recusa, e diz onde ligar", async () => {
    balcao = montarBalcao({ configuracao: { recursos: ["VENDA_POR_PESO"] } });
    const venda = await vendaDaCliente();

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("12,50"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("FIADO_DESLIGADO");
  });

  it("cliente sem limite não compra fiado", async () => {
    const venda = await vendaDaCliente(CLIENTE_SEM_FIADO);

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("12,50"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("CLIENTE_SEM_FIADO");
  });

  it("sem cliente, quem recusa é a venda", async () => {
    const venda = await balcao.vendaCom("BOL001");

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("12,50"),
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("cliente apagado entre a identificação e o pagamento é recusado", async () => {
    const venda = await vendaDaCliente();
    balcao.clientes.itens.delete(CLIENTE.valor);

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("12,50"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("CLIENTE_NAO_ENCONTRADO");
  });

  it("🔑 dentro do limite, o operador segue sozinho — é a caderneta de sempre", async () => {
    const venda = await vendaDaCliente();

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("12,50"),
    });

    expect(resultado.isOk()).toBe(true);
    expect(balcao.auditoria.registros).toHaveLength(0);
  });

  it("🔑 acima do limite, quem libera é quem define limite — o gerente", async () => {
    // Limite de R$ 100,00; 9 bolos = R$ 112,50.
    const venda = await balcao.vendaCom({
      codigo: "BOL001",
      quantidade: quantidade("9", "UN"),
    });
    await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId: CLIENTE });

    const pedido = {
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO" as const,
      valor: reais("112,50"),
    };

    const semLiberacao = await balcao.registrarPagamento.executar(pedido);
    expect(semLiberacao.isErr() && semLiberacao.error.mensagem).toContain("R$ 12,50");

    const comSupervisor = await balcao.registrarPagamento.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_SUPERVISOR,
    });
    expect(comSupervisor.isErr() && comSupervisor.error.codigo).toBe(
      "SUPERVISOR_SEM_ALCADA",
    );

    const comGerente = await balcao.registrarPagamento.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_GERENTE,
    });
    expect(comGerente.isOk()).toBe(true);

    const [registro] = balcao.auditoria.da("FIADO_ACIMA_DO_LIMITE");
    expect(registro?.autorizadoPorId?.equals(GERENTE)).toBe(true);
    expect(registro?.dados?.["excedente"]).toBe("1250");
  });

  it("🔑 a venda offline importada não reconfere o limite — o fiado já foi entregue", async () => {
    const venda = await balcao.vendaCom({
      codigo: "BOL001",
      quantidade: quantidade("9", "UN"),
    });
    await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId: CLIENTE });

    const resultado = await balcao.registrarPagamento.executar({
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO",
      valor: reais("112,50"),
      origem: "IMPORTACAO",
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("o reenvio do fiado já aceito não pede o gerente de novo", async () => {
    const venda = await balcao.vendaCom({
      codigo: "BOL001",
      quantidade: quantidade("9", "UN"),
    });
    await balcao.identificarCliente.executar({ vendaId: venda.id, clienteId: CLIENTE });
    const pedido = {
      vendaId: venda.id,
      operadorId: OPERADOR,
      forma: "CREDIARIO" as const,
      valor: reais("112,50"),
      chave: "fiado-01",
    };

    await balcao.registrarPagamento.executar({
      ...pedido,
      credencialSupervisor: CREDENCIAL_GERENTE,
    });
    const reenvio = await balcao.registrarPagamento.executar(pedido);

    expect(reenvio.isOk()).toBe(true);
  });
});

describe("Abertura da venda", () => {
  it("🔑 o mesmo id devolve a mesma venda — o primeiro bipe pode ser repetido", async () => {
    const id = balcao.geradorId.proximo();

    const primeira = (
      await balcao.iniciarVenda.executar({ id, estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    const repetida = (
      await balcao.iniciarVenda.executar({ id, estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    expect(repetida).toBe(primeira);
    expect(balcao.vendas.itens.size).toBe(1);
  });

  it("o mesmo id vindo de outro caixa é recusado", async () => {
    const id = balcao.geradorId.proximo();
    await balcao.iniciarVenda.executar({ id, estacaoId: ESTACAO, operadorId: OPERADOR });

    const resultado = await balcao.iniciarVenda.executar({
      id,
      estacaoId: OUTRA_ESTACAO,
      operadorId: OPERADOR,
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("VENDA_DE_OUTRA_ESTACAO");
  });
});

describe("Fechamento com vendas em aberto", () => {
  it("🔑 venda guardada com itens impede o fechamento, e diz quantas são", async () => {
    const guardada = await balcao.vendaCom("BOL001");
    await balcao.suspenderVenda.executar({ vendaId: guardada.id });

    const resultado = await balcao.fecharCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      contadoEmDinheiro: reais("100,00"),
    });

    expect(resultado.isErr() && resultado.error.codigo).toBe("CAIXA_COM_VENDAS_ABERTAS");
    expect(resultado.isErr() && resultado.error.mensagem).toContain(
      "Há 1 venda guardada",
    );
  });

  it("a mensagem concorda em número com várias", async () => {
    await balcao.vendaCom("BOL001");
    await balcao.vendaCom(EAN_REFRI);

    const resultado = await balcao.fecharCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      contadoEmDinheiro: reais("100,00"),
    });

    expect(resultado.isErr() && resultado.error.mensagem).toContain("Há 2 vendas");
  });

  it("🔑 a venda vazia esquecida aberta é descartada no fechamento", async () => {
    const vazia = await balcao.vendaCom();

    const fechado = (
      await balcao.fecharCaixa.executar({
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        contadoEmDinheiro: reais("100,00"),
      })
    ).unwrap();

    expect(vazia.status).toBe("CANCELADA");
    expect(fechado.conferencia.divergenciaEmDinheiro.ehZero()).toBe(true);
    expect(balcao.auditoria.da("CAIXA_FECHADO")[0]?.descricao).toContain("sem diferença");
  });

  it("🔑 o fechamento mostra descontos, cancelamentos e devoluções do turno", async () => {
    const comDesconto = await balcao.vendaCom("BOL001");
    await balcao.aplicarDesconto.executar({
      vendaId: comDesconto.id,
      operadorId: OPERADOR,
      alvo: { tipo: "ITEM", numero: 1 },
      valor: reais("0,50"),
    });
    await balcao.registrarPagamento.executar({
      vendaId: comDesconto.id,
      operadorId: OPERADOR,
      forma: "DINHEIRO",
      valor: reais("12,00"),
    });
    await balcao.finalizarVenda.executar({ vendaId: comDesconto.id });

    const cancelada = await balcao.vendaConcluida(
      [{ forma: "PIX", valor: "9,90" }],
      EAN_REFRI,
    );
    await balcao.cancelarVenda.executar({
      vendaId: cancelada.id,
      operadorId: GERENTE,
      motivo: "Erro",
    });

    const fechado = (
      await balcao.fecharCaixa.executar({
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        contadoEmDinheiro: reais("110,00"),
      })
    ).unwrap();

    expect(fechado.conferencia.descontos.formatar()).toBe("R$ 0,50");
    expect(fechado.conferencia.cancelamentos.quantidade).toBe(1);
    expect(fechado.conferencia.cancelamentos.total.formatar()).toBe("R$ 9,90");
    expect(fechado.conferencia.esperadoEmDinheiro.formatar()).toBe("R$ 112,00");
    // R$ 2,00 a menos na gaveta: falta, registrada sem bloquear.
    expect(balcao.auditoria.da("CAIXA_FECHADO")[0]?.descricao).toContain(
      "falta de R$ 2,00",
    );
  });

  it("sobra também aparece no registro", async () => {
    const fechado = await balcao.fecharCaixa.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      contadoEmDinheiro: reais("101,00"),
    });

    expect(fechado.isOk()).toBe(true);
    expect(balcao.auditoria.da("CAIXA_FECHADO")[0]?.descricao).toContain(
      "sobra de R$ 1,00",
    );
  });
});

describe("Apoio", () => {
  it("formata o percentual como o dono lê", () => {
    expect(formatarPercentual(1000)).toBe("10%");
    expect(formatarPercentual(1050)).toBe("10,5%");
    expect(formatarPercentual(525)).toBe("5,25%");
    expect(formatarPercentual(5)).toBe("0,05%");
  });
});
