import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";

import {
  cadastrarUsuario,
  cadastrarUsuarioComPermissoes,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
  proximoId,
} from "./apoio.js";

/**
 * Contas a receber e a pagar, pela fronteira HTTP.
 *
 * O que esta suíte guarda é a separação entre **ver** e **mexer em dinheiro**.
 * Quem consulta quanto o cliente deve não pode quitar a dívida dele — e essa é
 * a diferença entre um controle de fiado e um buraco no caixa.
 */

let servidor: FastifyInstance;
let container: Container;

const PIN = "419273";

beforeAll(async () => {
  prepararBanco();
  const montado = await montarServidorDeTeste();
  servidor = montado.servidor;
  container = montado.container;
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
});

beforeEach(async () => {
  await limparBanco(container);
});

type Cabecalho = { readonly authorization: string };

async function comoFinanceiro(matricula = "1"): Promise<Cabecalho> {
  await cadastrarUsuario(container, {
    matricula,
    nome: "Fernanda Financeiro",
    papel: "FINANCEIRO",
    pin: PIN,
  });

  const { token } = await logar(servidor, matricula, PIN);

  return { authorization: `Bearer ${token}` };
}

async function comQuePode(
  permissoes: readonly ("financeiro:ver" | "financeiro:lancar")[],
  matricula = "9",
): Promise<Cabecalho> {
  await cadastrarUsuarioComPermissoes(container, {
    matricula,
    nome: "Consulta Apenas",
    pin: PIN,
    permissoes,
  });

  const { token } = await logar(servidor, matricula, PIN);

  return { authorization: `Bearer ${token}` };
}

function post(url: string, headers: Cabecalho, payload: Record<string, unknown> = {}) {
  return servidor.inject({ method: "POST", url, headers, payload });
}

function put(url: string, headers: Cabecalho, payload: Record<string, unknown>) {
  return servidor.inject({ method: "PUT", url, headers, payload });
}

function get(url: string, headers: Cabecalho) {
  return servidor.inject({ method: "GET", url, headers });
}

function contaDeLuz(sobrescritas: Record<string, unknown> = {}) {
  return {
    tipo: "PAGAR",
    contraparteNome: "Companhia de Energia",
    valor: "34000",
    vencimento: "2026-08-15T00:00:00.000Z",
    ...sobrescritas,
  };
}

async function lancar(
  cabecalho: Cabecalho,
  corpo: Record<string, unknown> = contaDeLuz(),
): Promise<string> {
  const resposta = await post("/api/financeiro/titulos", cabecalho, corpo);
  const { itens } = resposta.json<{ itens: { id: string }[] }>();

  return itens[0]?.id ?? "";
}

describe("lançamento", () => {
  it("🔑 lança a conta de luz sem exigir cadastro da concessionária", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await post("/api/financeiro/titulos", cabecalho, contaDeLuz());

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({
      itens: [
        {
          tipo: "PAGAR",
          origem: "MANUAL",
          contraparteNome: "Companhia de Energia",
          valorOriginal: "34000",
          saldo: "34000",
          situacao: "ABERTO",
        },
      ],
    });
  });

  it("duplicata em três vezes devolve três títulos", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await post(
      "/api/financeiro/titulos",
      cabecalho,
      contaDeLuz({ valor: "100000", parcelas: 3 }),
    );

    const { itens } = resposta.json<{ itens: { valorOriginal: string }[] }>();

    expect(itens).toHaveLength(3);
    expect(itens.map((item) => item.valorOriginal)).toEqual(["33334", "33333", "33333"]);
  });

  it("recusa corpo sem valor", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await post("/api/financeiro/titulos", cabecalho, {
      tipo: "PAGAR",
      contraparteNome: "Aluguel",
      vencimento: "2026-08-15T00:00:00.000Z",
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa contraparte que não existe", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await post(
      "/api/financeiro/titulos",
      cabecalho,
      contaDeLuz({ contraparteId: proximoId().valor }),
    );

    expect(resposta.statusCode).toBe(404);
  });
});

describe("autorização", () => {
  it("🔑 quem só consulta não dá baixa", async () => {
    // É a diferença entre um controle de fiado e um buraco no caixa: juntar as
    // duas permissões daria a quem consulta o poder de quitar uma dívida.
    const gerente = await comoFinanceiro();
    const id = await lancar(gerente);

    const soVe = await comQuePode(["financeiro:ver"]);

    const consulta = await get("/api/financeiro/titulos", soVe);
    expect(consulta.statusCode).toBe(200);

    const baixa = await post(`/api/financeiro/titulos/${id}/recebimentos`, soVe, {
      valor: "1000",
    });
    expect(baixa.statusCode).toBe(403);
  });

  it("quem não tem financeiro nenhum não vê a lista", async () => {
    await cadastrarUsuario(container, {
      matricula: "7",
      nome: "Operador de Caixa",
      papel: "OPERADOR_CAIXA",
      pin: PIN,
    });
    const { token } = await logar(servidor, "7", PIN);

    const resposta = await get("/api/financeiro/titulos", {
      authorization: `Bearer ${token}`,
    });

    expect(resposta.statusCode).toBe(403);
  });

  it("exige autenticação", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: "/api/financeiro/titulos",
    });

    expect(resposta.statusCode).toBe(401);
  });
});

describe("recebimento", () => {
  it("🔑 baixa parcial devolve o saldo novo com o histórico", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const resposta = await post(`/api/financeiro/titulos/${id}/recebimentos`, cabecalho, {
      valor: "10000",
      forma: "PIX",
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      saldo: "24000",
      totalBaixado: "10000",
      situacao: "PARCIAL",
      baixas: [{ tipo: "PAGAMENTO", valor: "10000", forma: "PIX" }],
    });
  });

  it("🔑 recebimento acima do saldo é recusado com a mensagem do domínio", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const resposta = await post(`/api/financeiro/titulos/${id}/recebimentos`, cabecalho, {
      valor: "99999999",
    });

    // 422, e não 400: o corpo estava bem formado — o que a requisição violou
    // foi uma regra de negócio. É o mapeamento que o projeto já usa.
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "BAIXA_ACIMA_DO_SALDO" } });
  });

  it("🔑 estorno devolve o saldo e deixa os dois lançamentos", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const comBaixa = await post(`/api/financeiro/titulos/${id}/recebimentos`, cabecalho, {
      valor: "10000",
    });
    const baixaId = comBaixa.json<{ baixas: { id: string }[] }>().baixas[0]?.id ?? "";

    const resposta = await post(
      `/api/financeiro/titulos/${id}/recebimentos/${baixaId}/estorno`,
      cabecalho,
      { observacao: "Lançado no fornecedor errado" },
    );

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ saldo: "34000", situacao: "ABERTO" });
    expect(resposta.json<{ baixas: unknown[] }>().baixas).toHaveLength(2);
  });

  it("o mesmo recebimento não é estornado duas vezes", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const comBaixa = await post(`/api/financeiro/titulos/${id}/recebimentos`, cabecalho, {
      valor: "10000",
    });
    const baixaId = comBaixa.json<{ baixas: { id: string }[] }>().baixas[0]?.id ?? "";

    await post(
      `/api/financeiro/titulos/${id}/recebimentos/${baixaId}/estorno`,
      cabecalho,
    );

    const segundo = await post(
      `/api/financeiro/titulos/${id}/recebimentos/${baixaId}/estorno`,
      cabecalho,
    );

    expect(segundo.statusCode).toBe(422);
    expect(segundo.json()).toMatchObject({ erro: { codigo: "BAIXA_JA_ESTORNADA" } });
  });

  it("recusa id de título malformado", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await post("/api/financeiro/titulos/abc/recebimentos", cabecalho, {
      valor: "100",
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa valor ausente", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const resposta = await post(
      `/api/financeiro/titulos/${id}/recebimentos`,
      cabecalho,
      {},
    );

    expect(resposta.statusCode).toBe(400);
  });

  it("título inexistente devolve 404", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await post(
      `/api/financeiro/titulos/${proximoId().valor}/recebimentos`,
      cabecalho,
      { valor: "100" },
    );

    expect(resposta.statusCode).toBe(404);
  });

  it("estorno com id de baixa malformado é recusado", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const resposta = await post(
      `/api/financeiro/titulos/${id}/recebimentos/xyz/estorno`,
      cabecalho,
    );

    expect(resposta.statusCode).toBe(400);
  });
});

describe("consulta", () => {
  it("🔑 lista por vencimento, do mais antigo — é a ordem em que o lojista liga", async () => {
    const cabecalho = await comoFinanceiro();

    await lancar(cabecalho, contaDeLuz({ vencimento: "2026-09-10T00:00:00.000Z" }));
    await lancar(cabecalho, contaDeLuz({ vencimento: "2026-08-01T00:00:00.000Z" }));

    const resposta = await get("/api/financeiro/titulos", cabecalho);

    const { itens } = resposta.json<{ itens: { vencimento: string }[] }>();
    expect(itens.map((item) => item.vencimento)).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-09-10T00:00:00.000Z",
    ]);
  });

  it("🔑 o servidor decide o que está vencido, não a tela", async () => {
    // A regra compara por dia. Repeti-la na tela abriria a porta para as duas
    // discordarem por causa de fuso — e o cliente ser cobrado um dia antes.
    const cabecalho = await comoFinanceiro();
    await lancar(cabecalho, contaDeLuz({ vencimento: "2020-01-01T00:00:00.000Z" }));

    const { itens } = (await get("/api/financeiro/titulos", cabecalho)).json<{
      itens: { vencido: boolean; diasEmAtraso: number }[];
    }>();

    expect(itens[0]?.vencido).toBe(true);
    expect(itens[0]?.diasEmAtraso).toBeGreaterThan(0);
  });

  it("filtra por tipo", async () => {
    const cabecalho = await comoFinanceiro();
    await lancar(cabecalho);

    const pagar = await get("/api/financeiro/titulos?tipo=PAGAR", cabecalho);
    const receber = await get("/api/financeiro/titulos?tipo=RECEBER", cabecalho);

    expect(pagar.json<{ itens: unknown[] }>().itens).toHaveLength(1);
    expect(receber.json<{ itens: unknown[] }>().itens).toHaveLength(0);
  });

  it("filtra por vencidos até uma data", async () => {
    const cabecalho = await comoFinanceiro();
    await lancar(cabecalho, contaDeLuz({ vencimento: "2026-08-01T00:00:00.000Z" }));
    await lancar(cabecalho, contaDeLuz({ vencimento: "2026-12-31T00:00:00.000Z" }));

    const resposta = await get(
      "/api/financeiro/titulos?vencidosAte=2026-09-01T00:00:00.000Z",
      cabecalho,
    );

    expect(resposta.json<{ itens: unknown[] }>().itens).toHaveLength(1);
  });

  it("filtra por contraparte", async () => {
    const cabecalho = await comoFinanceiro();
    await lancar(cabecalho);

    const resposta = await get(
      `/api/financeiro/titulos?contraparteId=${proximoId().valor}`,
      cabecalho,
    );

    expect(resposta.json<{ itens: unknown[] }>().itens).toHaveLength(0);
  });

  it("consulta inválida é recusada", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await get("/api/financeiro/titulos?limite=9999", cabecalho);

    expect(resposta.statusCode).toBe(400);
  });

  it("detalha um título com as baixas", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);
    await post(`/api/financeiro/titulos/${id}/recebimentos`, cabecalho, {
      valor: "5000",
    });

    const resposta = await get(`/api/financeiro/titulos/${id}`, cabecalho);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<{ baixas: unknown[] }>().baixas).toHaveLength(1);
  });

  it("título inexistente devolve 404 no detalhe", async () => {
    const cabecalho = await comoFinanceiro();

    const resposta = await get(`/api/financeiro/titulos/${proximoId().valor}`, cabecalho);

    expect(resposta.statusCode).toBe(404);
  });

  it("detalhe com id malformado é recusado", async () => {
    const cabecalho = await comoFinanceiro();

    expect((await get("/api/financeiro/titulos/abc", cabecalho)).statusCode).toBe(400);
  });

  it("🔑 responde quanto a contraparte deve, com o total já somado", async () => {
    // A tela de venda a prazo pergunta isso antes de liberar o fiado. Devolver
    // a lista para somar no cliente gastaria rede com gente esperando.
    const cabecalho = await comoFinanceiro();
    const contraparteId = proximoId().valor;

    await lancar(
      cabecalho,
      contaDeLuz({ tipo: "PAGAR", contraparteNome: "Fornecedor", valor: "10000" }),
    );

    const resposta = await get(`/api/financeiro/em-aberto/${contraparteId}`, cabecalho);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ total: "0", vencido: "0", quantidade: 0 });
  });

  it("em aberto com id malformado é recusado", async () => {
    const cabecalho = await comoFinanceiro();

    expect((await get("/api/financeiro/em-aberto/abc", cabecalho)).statusCode).toBe(400);
  });
});

describe("adiamento e cancelamento", () => {
  it("adia o vencimento", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const resposta = await put(`/api/financeiro/titulos/${id}/vencimento`, cabecalho, {
      vencimento: "2026-09-15T00:00:00.000Z",
      motivo: "Renegociado",
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ vencimento: "2026-09-15T00:00:00.000Z" });
  });

  it("não antecipa o vencimento", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const resposta = await put(`/api/financeiro/titulos/${id}/vencimento`, cabecalho, {
      vencimento: "2026-08-01T00:00:00.000Z",
    });

    expect(resposta.statusCode).toBe(422);
  });

  it("adiamento sem data é recusado", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    expect(
      (await put(`/api/financeiro/titulos/${id}/vencimento`, cabecalho, {})).statusCode,
    ).toBe(400);
  });

  it("adiamento com id malformado é recusado", async () => {
    const cabecalho = await comoFinanceiro();

    expect(
      (
        await put("/api/financeiro/titulos/abc/vencimento", cabecalho, {
          vencimento: "2026-09-15T00:00:00.000Z",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("cancela com motivo", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    const resposta = await post(`/api/financeiro/titulos/${id}/cancelamento`, cabecalho, {
      motivo: "Lançado em duplicidade",
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ situacao: "CANCELADO" });
  });

  it("🔑 não cancela título com recebimento", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);
    await post(`/api/financeiro/titulos/${id}/recebimentos`, cabecalho, {
      valor: "5000",
    });

    const resposta = await post(`/api/financeiro/titulos/${id}/cancelamento`, cabecalho, {
      motivo: "Erro",
    });

    expect(resposta.statusCode).toBe(422);
    expect(resposta.json()).toMatchObject({ erro: { codigo: "TITULO_COM_BAIXA" } });
  });

  it("cancelamento sem motivo é recusado", async () => {
    const cabecalho = await comoFinanceiro();
    const id = await lancar(cabecalho);

    expect(
      (await post(`/api/financeiro/titulos/${id}/cancelamento`, cabecalho, {}))
        .statusCode,
    ).toBe(400);
  });

  it("cancelamento com id malformado é recusado", async () => {
    const cabecalho = await comoFinanceiro();

    expect(
      (
        await post("/api/financeiro/titulos/abc/cancelamento", cabecalho, {
          motivo: "Erro",
        })
      ).statusCode,
    ).toBe(400);
  });
});
