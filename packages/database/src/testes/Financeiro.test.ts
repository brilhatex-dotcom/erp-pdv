import { Dinheiro, Identificador, Titulo } from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TituloRepositorioPrisma } from "../repositorios/TituloRepositorioPrisma.js";

import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

/**
 * O financeiro contra o PostgreSQL de verdade.
 *
 * O que só o banco prova aqui é o **gatilho append-only** das baixas. Um
 * repositório em memória aceitaria alterar um recebimento sem reclamar, e o
 * defeito — valor sumindo do extrato do cliente — só apareceria na loja, num
 * acerto de contas em que o lojista não tem como explicar o que houve.
 */

const prisma = criarClienteDeTeste();

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3ea${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

const CLIENTE = proximoId();
const VENDA = proximoId();
const OPERADOR = proximoId();
const EMISSAO = new Date("2026-08-01T12:00:00.000Z");

function repositorio(): TituloRepositorioPrisma {
  return new TituloRepositorioPrisma(prisma);
}

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function titulo(sobrescritas: Partial<Parameters<typeof Titulo.criar>[0]> = {}): Titulo {
  return Titulo.criar({
    id: proximoId(),
    tipo: "RECEBER",
    origem: "VENDA",
    documentoId: VENDA,
    contraparteId: CLIENTE,
    contraparteNome: "Ana Maria de Souza",
    valorOriginal: reais("100,00"),
    vencimento: new Date("2026-08-31T12:00:00.000Z"),
    emitidoEm: EMISSAO,
    ...sobrescritas,
  }).unwrap();
}

function pagamentoDe(valor: string) {
  return {
    id: proximoId(),
    valor: reais(valor),
    ocorridaEm: new Date("2026-08-10T12:00:00.000Z"),
    usuarioId: OPERADOR,
    forma: "DINHEIRO",
  };
}

beforeAll(() => {
  prepararBanco();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
});

describe("gravação e leitura", () => {
  it("grava e relê o título inteiro", async () => {
    const original = titulo({
      descricao: "Venda 42",
      parcela: { numero: 2, de: 3 },
    });

    await repositorio().salvar(original);

    const lido = await repositorio().porId(original.id);

    expect(lido?.tipo).toBe("RECEBER");
    expect(lido?.origem).toBe("VENDA");
    expect(lido?.contraparteNome).toBe("Ana Maria de Souza");
    expect(lido?.valorOriginal.paraDecimal()).toBe("100.00");
    expect(lido?.parcela).toEqual({ numero: 2, de: 3 });
    expect(lido?.descricao).toBe("Venda 42");
    expect(lido?.situacao).toBe("ABERTO");
  });

  it("título inexistente devolve indefinido", async () => {
    expect(await repositorio().porId(proximoId())).toBeUndefined();
  });

  it("🔑 o saldo volta calculado das baixas, não de uma coluna", async () => {
    // Não há coluna de saldo. Se houvesse, ela poderia divergir dos lançamentos
    // — e ninguém saberia qual das duas está certa.
    const conta = titulo();
    conta.registrarBaixa(pagamentoDe("30,00"));
    await repositorio().salvar(conta);

    const lido = await repositorio().porId(conta.id);

    expect(lido?.saldo.paraDecimal()).toBe("70.00");
    expect(lido?.situacao).toBe("PARCIAL");
    expect(lido?.baixas).toHaveLength(1);
  });

  it("conta manual sem contraparte cadastrada é gravada", async () => {
    const luz = titulo({
      tipo: "PAGAR",
      origem: "MANUAL",
      documentoId: undefined,
      contraparteId: undefined,
      contraparteNome: "Companhia de Energia",
    });

    await repositorio().salvar(luz);

    const lido = await repositorio().porId(luz.id);
    expect(lido?.contraparteId).toBeUndefined();
    expect(lido?.origem).toBe("MANUAL");
  });
});

describe("append-only das baixas", () => {
  it("🔑 o banco recusa alterar um recebimento", async () => {
    // A garantia é do esquema, não do repositório: qualquer caminho futuro que
    // tente corrigir uma baixa com UPDATE encontra a mesma parede.
    const conta = titulo();
    const pagamento = pagamentoDe("30,00");
    conta.registrarBaixa(pagamento);
    await repositorio().salvar(conta);

    await expect(
      prisma.baixaTitulo.update({
        where: { id: pagamento.id.valor },
        data: { valor: 1n },
      }),
    ).rejects.toThrow();
  });

  it("🔑 o banco recusa apagar um recebimento", async () => {
    const conta = titulo();
    const pagamento = pagamentoDe("30,00");
    conta.registrarBaixa(pagamento);
    await repositorio().salvar(conta);

    await expect(
      prisma.baixaTitulo.delete({ where: { id: pagamento.id.valor } }),
    ).rejects.toThrow();
  });

  it("🔑 salvar de novo não tenta regravar as baixas que já estão lá", async () => {
    // O agregado devolve a lista inteira a cada gravação. Sem `skipDuplicates`,
    // a segunda gravação tentaria inserir tudo outra vez e estouraria — não no
    // gatilho, mas na chave primária, o que dá no mesmo para o operador.
    const conta = titulo();
    conta.registrarBaixa(pagamentoDe("30,00"));
    await repositorio().salvar(conta);

    conta.registrarBaixa(pagamentoDe("20,00"));
    await repositorio().salvar(conta);

    const lido = await repositorio().porId(conta.id);
    expect(lido?.baixas).toHaveLength(2);
    expect(lido?.saldo.paraDecimal()).toBe("50.00");
  });

  it("🔑 o mesmo recebimento não é estornado duas vezes, nem por fora", async () => {
    // Índice único sobre `estorna_id`. Sem ele, dois cliques no botão
    // devolveriam o dobro ao saldo e a dívida cresceria sozinha.
    const conta = titulo();
    const pagamento = pagamentoDe("30,00");
    conta.registrarBaixa(pagamento);
    conta.estornarBaixa(pagamento.id, {
      id: proximoId(),
      ocorridaEm: EMISSAO,
      usuarioId: OPERADOR,
    });
    await repositorio().salvar(conta);

    await expect(
      prisma.baixaTitulo.create({
        data: {
          id: proximoId().valor,
          tituloId: conta.id.valor,
          tipo: "ESTORNO",
          valor: 3000n,
          ocorridaEm: EMISSAO,
          usuarioId: OPERADOR.valor,
          estornaId: pagamento.id.valor,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("consultas do balcão", () => {
  it("🔑 responde quanto a contraparte ainda deve", async () => {
    // É a pergunta que decide se a próxima venda a prazo pode sair.
    const aberto = titulo({ valorOriginal: reais("100,00") });
    const parcial = titulo({ valorOriginal: reais("50,00") });
    parcial.registrarBaixa(pagamentoDe("20,00"));

    const quitado = titulo({ valorOriginal: reais("40,00") });
    quitado.registrarBaixa(pagamentoDe("40,00"));

    const cancelado = titulo({ valorOriginal: reais("70,00") });
    cancelado.cancelar(EMISSAO, "Duplicidade");

    for (const conta of [aberto, parcial, quitado, cancelado]) {
      await repositorio().salvar(conta);
    }

    const devendo = await repositorio().emAbertoDaContraparte(CLIENTE, "RECEBER");

    // Quitado e cancelado ficam de fora: cobrar quem já pagou é o erro que mais
    // custa relacionamento.
    expect(devendo).toHaveLength(2);
    const soma = devendo.reduce(
      (acumulado, conta) => acumulado.somar(conta.saldo),
      Dinheiro.zero(),
    );
    expect(soma.paraDecimal()).toBe("130.00");
  });

  it("acha os títulos de uma venda", async () => {
    const primeira = titulo({ parcela: { numero: 1, de: 2 } });
    const segunda = titulo({ parcela: { numero: 2, de: 2 } });
    await repositorio().salvar(primeira);
    await repositorio().salvar(segunda);
    await repositorio().salvar(titulo({ documentoId: proximoId() }));

    expect(await repositorio().porDocumento(VENDA)).toHaveLength(2);
  });

  it("🔑 a lista de cobrança vem do mais antigo para o mais novo", async () => {
    // Quem está devendo há mais tempo aparece primeiro — é a ordem em que o
    // lojista liga.
    await repositorio().salvar(
      titulo({ vencimento: new Date("2026-09-15T12:00:00.000Z") }),
    );
    await repositorio().salvar(
      titulo({ vencimento: new Date("2026-08-05T12:00:00.000Z") }),
    );
    await repositorio().salvar(
      titulo({ vencimento: new Date("2026-08-20T12:00:00.000Z") }),
    );

    const achados = await repositorio().buscar({ tipo: "RECEBER", limite: 20 });

    expect(achados.map((conta) => conta.vencimento.toISOString())).toEqual([
      "2026-08-05T12:00:00.000Z",
      "2026-08-20T12:00:00.000Z",
      "2026-09-15T12:00:00.000Z",
    ]);
  });

  it("🔑 apenas em aberto exclui quitados, mesmo sem coluna de status", async () => {
    // O filtro de saldo é aplicado fora do banco, porque somar baixas em SQL
    // duplicaria em outra linguagem a regra que já existe no domínio.
    const aberto = titulo();
    const quitado = titulo();
    quitado.registrarBaixa(pagamentoDe("100,00"));

    await repositorio().salvar(aberto);
    await repositorio().salvar(quitado);

    const achados = await repositorio().buscar({ apenasEmAberto: true, limite: 20 });

    expect(achados).toHaveLength(1);
    expect(achados[0]?.id.valor).toBe(aberto.id.valor);
  });

  it("filtra por tipo", async () => {
    await repositorio().salvar(titulo());
    await repositorio().salvar(
      titulo({
        tipo: "PAGAR",
        origem: "MANUAL",
        documentoId: undefined,
        contraparteId: undefined,
        contraparteNome: "Aluguel",
      }),
    );

    expect(await repositorio().buscar({ tipo: "PAGAR", limite: 20 })).toHaveLength(1);
  });

  it("filtra por contraparte", async () => {
    const outro = proximoId();
    await repositorio().salvar(titulo());
    await repositorio().salvar(
      titulo({ contraparteId: outro, contraparteNome: "Outro Cliente" }),
    );

    const achados = await repositorio().buscar({ contraparteId: outro, limite: 20 });

    expect(achados).toHaveLength(1);
    expect(achados[0]?.contraparteNome).toBe("Outro Cliente");
  });

  it("filtra vencidos até uma data", async () => {
    await repositorio().salvar(
      titulo({ vencimento: new Date("2026-08-05T12:00:00.000Z") }),
    );
    await repositorio().salvar(
      titulo({ vencimento: new Date("2026-12-31T12:00:00.000Z") }),
    );

    const vencidos = await repositorio().buscar({
      vencidosAte: new Date("2026-09-01T00:00:00.000Z"),
      limite: 20,
    });

    expect(vencidos).toHaveLength(1);
  });

  it("respeita o limite", async () => {
    for (let i = 0; i < 5; i += 1) await repositorio().salvar(titulo());

    expect(await repositorio().buscar({ limite: 2 })).toHaveLength(2);
  });
});
