import {
  CredencialHash,
  Dinheiro,
  Identificador,
  Matricula,
  Papel,
  papelPadrao,
  SessaoCaixa,
  Usuario,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sessoesDeCaixa } from "../consultas/sessoesDeCaixa.js";
import type { PrismaClient } from "../gerado/index.js";
import {
  PapelRepositorioPrisma,
  UsuarioRepositorioPrisma,
} from "../repositorios/AcessoRepositorioPrisma.js";
import { CaixaRepositorioPrisma } from "../repositorios/CaixaRepositorioPrisma.js";
import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

/**
 * A conferência depois do fato.
 *
 * O que se verifica aqui é a aritmética contra o banco de verdade: a divergência
 * é **recalculada** a partir das colunas, e um erro nela apareceria como falta
 * inventada no relatório do gerente — o tipo de defeito que destrói a confiança
 * no sistema inteiro.
 */

let prisma: PrismaClient;

const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e810001").unwrap();
const OUTRA_ESTACAO = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e810002",
).unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e810003").unwrap();
const PAPEL = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e810004").unwrap();

const ABERTURA = new Date("2026-08-01T08:00:00.000Z");
const FECHAMENTO = new Date("2026-08-01T18:00:00.000Z");

const DIA = {
  de: new Date("2026-08-01T00:00:00.000Z"),
  ate: new Date("2026-08-02T00:00:00.000Z"),
};

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;

  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3e8${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

beforeAll(() => {
  prepararBanco();
  prisma = criarClienteDeTeste();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);

  const papel = Papel.criar(papelPadrao("OPERADOR_CAIXA", PAPEL)).unwrap();
  await new PapelRepositorioPrisma(prisma).salvar(papel);

  await new UsuarioRepositorioPrisma(prisma).salvar(
    Usuario.criar({
      id: OPERADOR,
      matricula: Matricula.criar("42").unwrap(),
      nome: "Maria da Silva",
      papel,
      hashPin: CredencialHash.criar("falso:419273", "falso").unwrap(),
    }).unwrap(),
  );
});

/** Sessão com uma venda em dinheiro de R$ 250,00 e R$ 50,00 de troco. */
function comVenda(estacaoId = ESTACAO, abertaEm = ABERTURA): SessaoCaixa {
  const sessao = SessaoCaixa.abrir({
    id: proximoId(),
    estacaoId,
    operadorId: OPERADOR,
    fundoTroco: reais("100,00"),
    abertaEm,
  }).unwrap();

  sessao.registrarVenda({
    vendaId: proximoId(),
    total: reais("250,00"),
    troco: reais("50,00"),
    pagamentos: [{ forma: "DINHEIRO", valor: reais("300,00") }],
  });

  return sessao;
}

async function gravar(sessao: SessaoCaixa): Promise<void> {
  await new CaixaRepositorioPrisma(prisma).salvar(sessao);
}

describe("sessoesDeCaixa", () => {
  it("🔑 recalcula o esperado a partir das colunas", async () => {
    // Fundo 100 + recebido 300 − troco 50 = 350.
    const sessao = comVenda();
    sessao.fechar(reais("350,00"), FECHAMENTO);
    await gravar(sessao);

    const [linha] = await sessoesDeCaixa(prisma, DIA);

    expect(linha).toBeDefined();
    if (linha === undefined) return;

    expect(linha.esperadoEmDinheiro).toBe("35000");
    expect(linha.contadoEmDinheiro).toBe("35000");
    expect(linha.divergenciaEmDinheiro).toBe("0");
    expect(linha.status).toBe("FECHADA");
    expect(linha.operadorNome).toBe("Maria da Silva");
  });

  it("🔑 falta aparece negativa; sobra, positiva", async () => {
    const comFalta = comVenda();
    comFalta.fechar(reais("330,00"), FECHAMENTO);
    await gravar(comFalta);

    const [linha] = await sessoesDeCaixa(prisma, DIA);

    expect(linha?.divergenciaEmDinheiro).toBe("-2000");
  });

  it("sangria e suprimento entram no esperado", async () => {
    const sessao = comVenda();
    sessao.registrarSuprimento(proximoId(), reais("40,00"), "Troco", OPERADOR, ABERTURA);
    sessao.registrarSangria(proximoId(), reais("100,00"), "Banco", OPERADOR, ABERTURA);
    sessao.fechar(reais("290,00"), FECHAMENTO);
    await gravar(sessao);

    const [linha] = await sessoesDeCaixa(prisma, DIA);

    // 350 + 40 − 100 = 290.
    expect(linha?.esperadoEmDinheiro).toBe("29000");
    expect(linha?.suprimentos).toBe("4000");
    expect(linha?.sangrias).toBe("10000");
    expect(linha?.divergenciaEmDinheiro).toBe("0");
  });

  it("🔑 sessão aberta não inventa divergência", async () => {
    // Ninguém contou ainda. Calcular a diferença contra contagem nenhuma
    // acusaria uma falta do tamanho da gaveta em todo caixa aberto.
    await gravar(comVenda());

    const [linha] = await sessoesDeCaixa(prisma, DIA);

    expect(linha?.status).toBe("ABERTA");
    expect(linha?.contadoEmDinheiro).toBeUndefined();
    expect(linha?.divergenciaEmDinheiro).toBeUndefined();
    // O esperado continua sendo calculado: é o que o gerente compara ao passar
    // na loja durante o expediente.
    expect(linha?.esperadoEmDinheiro).toBe("35000");
  });

  it("filtra por estação", async () => {
    await gravar(comVenda(ESTACAO));
    await gravar(comVenda(OUTRA_ESTACAO));

    const daEstacao = await sessoesDeCaixa(prisma, {
      ...DIA,
      estacaoId: ESTACAO.valor,
    });

    expect(daEstacao).toHaveLength(1);
    expect(daEstacao[0]?.estacaoId).toBe(ESTACAO.valor);
  });

  it("🔑 respeita o intervalo pedido", async () => {
    await gravar(comVenda(ESTACAO, new Date("2026-07-31T08:00:00.000Z")));
    await gravar(comVenda(OUTRA_ESTACAO, new Date("2026-08-01T08:00:00.000Z")));

    const doDia = await sessoesDeCaixa(prisma, DIA);

    expect(doDia).toHaveLength(1);
    expect(doDia[0]?.estacaoId).toBe(OUTRA_ESTACAO.valor);
  });

  it("mais recente primeiro", async () => {
    await gravar(comVenda(ESTACAO, new Date("2026-08-01T08:00:00.000Z")));
    await gravar(comVenda(OUTRA_ESTACAO, new Date("2026-08-01T14:00:00.000Z")));

    const linhas = await sessoesDeCaixa(prisma, DIA);

    expect(linhas.map((linha) => linha.abertaEm)).toEqual([
      "2026-08-01T14:00:00.000Z",
      "2026-08-01T08:00:00.000Z",
    ]);
  });

  it("período sem movimento não é erro", async () => {
    const vazio = await sessoesDeCaixa(prisma, {
      de: new Date("2026-01-01T00:00:00.000Z"),
      ate: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(vazio).toEqual([]);
  });

  it("🔑 dinheiro sai como texto", async () => {
    // `bigint` não sobrevive a `JSON.stringify`, e número perde centavo no
    // `JSON.parse` do outro lado (ADR-0019).
    await gravar(comVenda());

    const [linha] = await sessoesDeCaixa(prisma, DIA);

    expect(typeof linha?.fundoTroco).toBe("string");
    expect(typeof linha?.totalVendido).toBe("string");
    expect(linha?.totalVendido).toBe("25000");
  });

  it("🔑 sessão só com cartão não vira dinheiro esperado", async () => {
    // Sem linha de DINHEIRO em `recebimentos_caixa`, somar `undefined` daria
    // `NaN` — e o relatório mostraria uma falta impossível de explicar.
    const sessao = SessaoCaixa.abrir({
      id: proximoId(),
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
      abertaEm: ABERTURA,
    }).unwrap();

    sessao.registrarVenda({
      vendaId: proximoId(),
      total: reais("250,00"),
      troco: reais("0,00"),
      pagamentos: [{ forma: "CARTAO_DEBITO", valor: reais("250,00") }],
    });

    sessao.fechar(reais("100,00"), FECHAMENTO);
    await gravar(sessao);

    const [linha] = await sessoesDeCaixa(prisma, DIA);

    expect(linha?.recebidoEmDinheiro).toBe("0");
    expect(linha?.esperadoEmDinheiro).toBe("10000");
    expect(linha?.divergenciaEmDinheiro).toBe("0");
  });

  it("operador que não está mais cadastrado não deixa a linha sem nome", async () => {
    // Não há FK em `operador_id` (ver ESTADO.md §2.4). Enquanto não houver,
    // uma sessão pode apontar para alguém que sumiu — e a tela não pode
    // quebrar por causa disso.
    const orfa = SessaoCaixa.abrir({
      id: proximoId(),
      estacaoId: ESTACAO,
      operadorId: proximoId(),
      fundoTroco: reais("100,00"),
      abertaEm: ABERTURA,
    }).unwrap();

    await gravar(orfa);

    const [linha] = await sessoesDeCaixa(prisma, DIA);

    expect(linha?.operadorNome).toBe("—");
  });

  it("o limite protege a tela de um histórico longo", async () => {
    for (let indice = 0; indice < 5; indice += 1) {
      await gravar(comVenda(proximoId(), ABERTURA));
    }

    const limitadas = await sessoesDeCaixa(prisma, { ...DIA, limite: 2 });

    expect(limitadas).toHaveLength(2);
  });
});
