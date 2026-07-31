import {
  CodigoBarras,
  Dinheiro,
  Identificador,
  LAYOUT_BALANCA_PADRAO,
  Produto,
  Quantidade,
  SessaoCaixa,
  type VendaFinalizada,
} from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import { AdicionarItemPorCodigo } from "./AdicionarItemPorCodigo.js";
import { FinalizarVenda } from "./FinalizarVenda.js";
import { IniciarVenda } from "./IniciarVenda.js";
import { RegistrarPagamento } from "./RegistrarPagamento.js";

const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f6001").unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f6002").unwrap();
const CAIXA_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f6003").unwrap();
const CLIENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f6004").unwrap();
const REFRI_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f6005").unwrap();
const PICANHA_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f6006").unwrap();
const AGORA = new Date("2026-07-30T12:00:00.000Z");

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

/** Refrigerante com EAN — produto unitário comum. */
function refrigerante(): Produto {
  return Produto.criar({
    id: REFRI_ID,
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    descricaoPdv: "REFRI COLA 2L",
    tipo: "UNITARIO",
    unidadeBase: "UN",
    precoVenda: reais("9,90"),
    custo: reais("6,50"),
    codigoBarras: CodigoBarras.criar("7891000315507").unwrap(),
  }).unwrap();
}

/** Picanha vendida por quilo — produto de balança. */
function picanha(): Produto {
  return Produto.criar({
    id: PICANHA_ID,
    sku: "CAR010",
    descricao: "Picanha Bovina",
    tipo: "PESAVEL",
    unidadeBase: "KG",
    precoVenda: reais("79,90"),
    codigoBalanca: "012345",
  }).unwrap();
}

function montar() {
  const ambiente = montarAmbiente(AGORA);

  ambiente.caixas.adicionar(
    SessaoCaixa.abrir({
      id: CAIXA_ID,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
      abertaEm: AGORA,
    }).unwrap(),
  );

  ambiente.produtos.adicionar(refrigerante());
  ambiente.produtos.adicionar(picanha());

  return {
    ...ambiente,
    iniciarVenda: new IniciarVenda(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
    adicionarItem: new AdicionarItemPorCodigo(ambiente.unitOfWork, LAYOUT_BALANCA_PADRAO),
    registrarPagamento: new RegistrarPagamento(ambiente.unitOfWork),
    finalizarVenda: new FinalizarVenda(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
  };
}

let sistema: ReturnType<typeof montar>;

beforeEach(() => {
  sistema = montar();
});

describe("Fluxo de venda — caminho feliz completo", () => {
  it("🔑 bipa, paga e fecha, propagando estoque, caixa e outbox", async () => {
    // É o teste que prova a arquitetura hexagonal: o fluxo inteiro do balcão
    // roda sem banco, sem rede e sem impressora.
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "7891000315507",
    });
    await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "7891000315507",
    });

    const pagamento = (
      await sistema.registrarPagamento.executar({
        vendaId: venda.id,
        forma: "DINHEIRO",
        valor: reais("20,00"),
      })
    ).unwrap();

    expect(pagamento.faltaPagar.ehZero()).toBe(true);
    expect(pagamento.troco.formatar()).toBe("R$ 0,20");

    const fechada = (
      await sistema.finalizarVenda.executar({ vendaId: venda.id })
    ).unwrap();

    expect(fechada.venda.status).toBe("FINALIZADA");
    expect(fechada.venda.total.formatar()).toBe("R$ 19,80");
    expect(fechada.troco.formatar()).toBe("R$ 0,20");

    // Estoque baixado: um movimento de saída por item.
    expect(sistema.estoque.movimentos).toHaveLength(2);
    expect(sistema.estoque.movimentos.every((m) => m.tipo === "SAIDA")).toBe(true);
    expect(sistema.estoque.movimentos[0]?.origem.tipo).toBe("VENDA");

    // Caixa creditado, já descontado o troco.
    const caixa = (await sistema.caixas.porId(CAIXA_ID))!;
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 119,80");
    expect(caixa.quantidadeVendas).toBe(1);

    // Evento na outbox, para o fiscal e o financeiro reagirem depois.
    expect(sistema.outbox.eventos).toHaveLength(1);
    expect(sistema.outbox.eventos[0]?.tipo).toBe("VendaFinalizada");
  });

  it("leva no evento o que a baixa de estoque precisa", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    await sistema.adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });
    await sistema.registrarPagamento.executar({
      vendaId: venda.id,
      forma: "PIX",
      valor: reais("9,90"),
    });
    await sistema.finalizarVenda.executar({ vendaId: venda.id });

    const evento = sistema.outbox.eventos[0] as VendaFinalizada;

    expect(evento.itens).toHaveLength(1);
    expect(evento.itens[0]?.produtoId.equals(REFRI_ID)).toBe(true);
    expect(evento.total.formatar()).toBe("R$ 9,90");
    expect(evento.valorAReceber.ehZero()).toBe(true);
  });
});

describe("Fluxo de venda — etiqueta de balança", () => {
  it("🔑 lê produto e peso da etiqueta, sem o operador digitar nada", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    // 2 · 012345 · 01250 · 9 → picanha, 1,250 kg
    const item = (
      await sistema.adicionarItem.executar({
        vendaId: venda.id,
        codigo: "2012345012509",
      })
    ).unwrap();

    expect(item.descricao).toBe("Picanha Bovina");
    expect(item.quantidade.formatar()).toBe("1,25 kg");
    // 79,90 × 1,250 = 99,875 → R$ 99,88
    expect(item.total.formatar()).toBe("R$ 99,88");
  });

  it("recusa etiqueta cujo produto não está cadastrado na balança", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    // 2 · 999999 · 01250 · dígito
    const resultado = await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "2999999012508",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_NAO_ENCONTRADO");
      expect(resultado.error.mensagem).toContain("cadastro da balança");
    }
  });

  it("recusa etiqueta com dígito verificador errado", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const resultado = await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "2012345012500",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("BALANCA_DIGITO_INVALIDO");
    }
  });
});

describe("Fluxo de venda — busca de produto", () => {
  it.each([
    ["código de barras", "7891000315507"],
    ["SKU", "REF001"],
    ["SKU em minúsculas", "ref001"],
  ])("encontra o produto por %s", async (_descricao, codigo) => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const item = await sistema.adicionarItem.executar({ vendaId: venda.id, codigo });

    expect(item.isOk()).toBe(true);
  });

  it("usa a descrição curta do PDV no item", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const item = (
      await sistema.adicionarItem.executar({
        vendaId: venda.id,
        codigo: "7891000315507",
      })
    ).unwrap();

    expect(item.descricao).toBe("REFRI COLA 2L");
  });

  it("assume quantidade 1 quando não informada", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const item = (
      await sistema.adicionarItem.executar({
        vendaId: venda.id,
        codigo: "REF001",
      })
    ).unwrap();

    expect(item.quantidade.formatar()).toBe("1 un");
  });

  it("aceita quantidade digitada pelo operador", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const item = (
      await sistema.adicionarItem.executar({
        vendaId: venda.id,
        codigo: "REF001",
        quantidade: Quantidade.de("6", "UN").unwrap(),
      })
    ).unwrap();

    expect(item.total.formatar()).toBe("R$ 59,40");
  });

  it("recusa código inexistente com mensagem acionável", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const resultado = await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "0000000000000",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.mensagem).toBe("Produto não encontrado. Confira o código.");
    }
  });

  it("recusa produto inativo", async () => {
    const inativo = refrigerante();
    inativo.desativar(AGORA);
    sistema.produtos.adicionar(inativo);

    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const resultado = await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "REF001",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_INATIVO");
    }
  });

  it("recusa venda inexistente", async () => {
    const resultado = await sistema.adicionarItem.executar({
      vendaId: CLIENTE,
      codigo: "REF001",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_NAO_ENCONTRADA");
    }
  });
});

describe("Fluxo de venda — controle de estoque opcional", () => {
  it("permite vender sem saldo por padrão — o PDV nunca para", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const item = await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "REF001",
    });

    expect(item.isOk()).toBe(true);
  });

  it("bloqueia quando a loja exige saldo", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const resultado = await sistema.adicionarItem.executar({
      vendaId: venda.id,
      codigo: "REF001",
      exigirEstoque: true,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("ESTOQUE_INSUFICIENTE");
    }
  });
});

describe("Fluxo de venda — caixa", () => {
  it("recusa iniciar venda sem caixa aberto, com mensagem que orienta", async () => {
    const semCaixa = montarAmbiente(AGORA);
    const iniciar = new IniciarVenda(
      semCaixa.unitOfWork,
      semCaixa.relogio,
      semCaixa.geradorId,
    );

    const resultado = await iniciar.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_FECHADO");
      expect(resultado.error.mensagem).toBe("Abra o caixa antes de iniciar uma venda.");
    }
  });

  it("numera as vendas em sequência na estação", async () => {
    const primeira = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    const segunda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    expect(primeira.numero).toBe(1);
    expect(segunda.numero).toBe(2);
  });

  it("recusa finalizar quando o caixa já foi fechado", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    await sistema.adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });
    await sistema.registrarPagamento.executar({
      vendaId: venda.id,
      forma: "DINHEIRO",
      valor: reais("9,90"),
    });

    (await sistema.caixas.porId(CAIXA_ID))!.fechar(reais("100,00"), AGORA);

    const resultado = await sistema.finalizarVenda.executar({ vendaId: venda.id });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_JA_FECHADO");
    }
  });

  it("associa a venda à sessão de caixa aberta", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    expect(venda.sessaoCaixaId.equals(CAIXA_ID)).toBe(true);
  });
});

describe("Fluxo de venda — crediário", () => {
  it("🔑 lança no caixa como a receber, sem entrar na gaveta", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        clienteId: CLIENTE,
      })
    ).unwrap();

    await sistema.adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });
    await sistema.registrarPagamento.executar({
      vendaId: venda.id,
      forma: "CREDIARIO",
      valor: reais("9,90"),
    });
    await sistema.finalizarVenda.executar({ vendaId: venda.id });

    const caixa = (await sistema.caixas.porId(CAIXA_ID))!;

    expect(caixa.totalAReceber.formatar()).toBe("R$ 9,90");
    expect(caixa.esperadoEmDinheiro.formatar()).toBe("R$ 100,00");

    const evento = sistema.outbox.eventos[0] as VendaFinalizada;
    expect(evento.valorAReceber.formatar()).toBe("R$ 9,90");
  });

  it("recusa crediário sem cliente identificado", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    await sistema.adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });

    const resultado = await sistema.registrarPagamento.executar({
      vendaId: venda.id,
      forma: "CREDIARIO",
      valor: reais("9,90"),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CREDIARIO_SEM_CLIENTE");
    }
  });
});

describe("Fluxo de venda — recusas na finalização", () => {
  it("recusa finalizar venda vazia", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const resultado = await sistema.finalizarVenda.executar({ vendaId: venda.id });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_SEM_ITENS");
    }
  });

  it("recusa finalizar com pagamento insuficiente", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    await sistema.adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });
    await sistema.registrarPagamento.executar({
      vendaId: venda.id,
      forma: "DINHEIRO",
      valor: reais("5,00"),
    });

    const resultado = await sistema.finalizarVenda.executar({ vendaId: venda.id });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_PAGAMENTO_INSUFICIENTE");
    }
  });

  it("🔑 não baixa estoque nem credita caixa quando a finalização falha", async () => {
    // Meio caminho aqui seria estoque baixado de venda que não existe.
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    await sistema.adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });

    await sistema.finalizarVenda.executar({ vendaId: venda.id });

    expect(sistema.estoque.movimentos).toHaveLength(0);
    expect(sistema.outbox.eventos).toHaveLength(0);
    expect((await sistema.caixas.porId(CAIXA_ID))!.quantidadeVendas).toBe(0);
  });

  it("recusa finalizar venda inexistente", async () => {
    const resultado = await sistema.finalizarVenda.executar({ vendaId: CLIENTE });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_NAO_ENCONTRADA");
    }
  });

  it("recusa pagamento em venda inexistente", async () => {
    const resultado = await sistema.registrarPagamento.executar({
      vendaId: CLIENTE,
      forma: "DINHEIRO",
      valor: reais("10,00"),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("VENDA_NAO_ENCONTRADA");
    }
  });

  it("recusa finalizar quando a sessão de caixa sumiu", async () => {
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();
    await sistema.adicionarItem.executar({ vendaId: venda.id, codigo: "REF001" });
    sistema.caixas.itens.clear();

    const resultado = await sistema.finalizarVenda.executar({ vendaId: venda.id });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CAIXA_NAO_ENCONTRADO");
    }
  });
});

describe("Fluxo de venda — transação", () => {
  it("propaga falha de infraestrutura sem vazar exceção", async () => {
    sistema.unitOfWork.falharAoConfirmar = true;

    const resultado = await sistema.iniciarVenda.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("TRANSACAO_FALHOU");
      // Mensagem para o operador, não stack trace.
      expect(resultado.error.mensagem).toBe(
        "Não foi possível concluir a operação. Tente novamente.",
      );
    }
  });

  it("cada caso de uso roda dentro de uma transação", async () => {
    await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR });

    expect(sistema.unitOfWork.transacoes).toBe(1);
  });
});

describe("Fluxo de venda — balança com preço embutido", () => {
  /** Layout alternativo: a etiqueta traz o preço total, não o peso. */
  const LAYOUT_PRECO = {
    prefixos: ["2"],
    tamanhoCodigoProduto: 6,
    conteudo: "PRECO",
    casasDecimais: 2,
  } as const;

  it("deduz a quantidade dividindo o preço da etiqueta pelo preço unitário", async () => {
    const adicionar = new AdicionarItemPorCodigo(sistema.unitOfWork, LAYOUT_PRECO);
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    // 2 · 012345 · 09988 · 6 → R$ 99,88 de picanha a R$ 79,90/kg → 1,250 kg
    const item = (
      await adicionar.executar({ vendaId: venda.id, codigo: "2012345099883" })
    ).unwrap();

    expect(item.quantidade.formatar()).toBe("1,25 kg");
  });

  it("recusa quando o produto não tem preço para deduzir a quantidade", async () => {
    // Adivinhar seria pior que recusar: cobrar errado é o defeito mais caro
    // do balcão.
    const semPreco = Produto.criar({
      id: PICANHA_ID,
      sku: "CAR010",
      descricao: "Picanha Bovina",
      tipo: "PESAVEL",
      unidadeBase: "KG",
      precoVenda: Dinheiro.zero(),
      codigoBalanca: "012345",
    }).unwrap();
    sistema.produtos.adicionar(semPreco);

    const adicionar = new AdicionarItemPorCodigo(sistema.unitOfWork, LAYOUT_PRECO);
    const venda = (
      await sistema.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    const resultado = await adicionar.executar({
      vendaId: venda.id,
      codigo: "2012345099883",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("BALANCA_QUANTIDADE_INDETERMINADA");
      expect(resultado.error.mensagem).toContain("manualmente");
    }
  });
});
