import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { CredencialHash } from "./CredencialHash.js";
import { Matricula } from "./Matricula.js";
import { Papel } from "./Papel.js";
import { type CodigoPapelPadrao, papelPadrao } from "./papeisPadrao.js";
import { type AcaoSolicitada, avaliar, podeAutorizar } from "./PoliticaAutorizacao.js";
import { Usuario } from "./Usuario.js";

const PAPEL_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fb001").unwrap();

let contador = 0;
function proximoId(): Identificador {
  contador += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-b${contador.toString().padStart(11, "0")}`,
  ).unwrap();
}

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function comPapel(codigo: CodigoPapelPadrao): Usuario {
  return Usuario.criar({
    id: proximoId(),
    matricula: Matricula.criar("1").unwrap(),
    nome: `Usuário ${codigo}`,
    papel: Papel.criar(papelPadrao(codigo, PAPEL_ID)).unwrap(),
    hashPin: CredencialHash.criar("$argon2id$x", "argon2id").unwrap(),
  }).unwrap();
}

describe("Autorização — verificação simples de permissão", () => {
  it("permite o que o papel concede", () => {
    const acao: AcaoSolicitada = { tipo: "PERMISSAO", permissao: "venda:criar" };

    expect(avaliar(comPapel("OPERADOR_CAIXA"), acao).tipo).toBe("PERMITIDO");
  });

  it("🔑 nega por padrão o que o papel não menciona", () => {
    // Permissão ausente é permissão negada. É isso que impede que uma
    // funcionalidade nova abra acesso por esquecimento.
    const acao: AcaoSolicitada = { tipo: "PERMISSAO", permissao: "config:fiscal" };

    expect(avaliar(comPapel("OPERADOR_CAIXA"), acao).tipo).toBe("NEGADO");
  });

  it("🔑 o contador não escreve nada — nem no fiscal", () => {
    const contadorUsuario = comPapel("CONTADOR");

    expect(
      avaliar(contadorUsuario, { tipo: "PERMISSAO", permissao: "fiscal:emitir" }).tipo,
    ).toBe("NEGADO");
    expect(
      avaliar(contadorUsuario, { tipo: "PERMISSAO", permissao: "venda:criar" }).tipo,
    ).toBe("NEGADO");
    expect(
      avaliar(contadorUsuario, { tipo: "PERMISSAO", permissao: "relatorio:financeiro" })
        .tipo,
    ).toBe("PERMITIDO");
  });

  it("🔑 o operador de caixa não vê o custo do produto", () => {
    // Em boa parte das lojas o custo de compra é informação estratégica.
    // Separar isso de `produto:editar` evita vazamento interno.
    expect(
      avaliar(comPapel("OPERADOR_CAIXA"), {
        tipo: "PERMISSAO",
        permissao: "produto:ver_custo",
      }).tipo,
    ).toBe("NEGADO");

    expect(
      avaliar(comPapel("ESTOQUISTA"), {
        tipo: "PERMISSAO",
        permissao: "produto:ver_custo",
      }).tipo,
    ).toBe("PERMITIDO");
  });

  it("nega tudo para usuário desativado, mesmo com o papel certo", () => {
    const usuario = comPapel("ADMIN");
    usuario.desativar();

    const decisao = avaliar(usuario, { tipo: "PERMISSAO", permissao: "venda:criar" });

    expect(decisao.tipo).toBe("NEGADO");
    if (decisao.tipo === "NEGADO") {
      expect(decisao.motivo).toBe("Este usuário não tem mais acesso.");
    }
  });
});

describe("Autorização — desconto", () => {
  it("permite desconto dentro do limite do operador", () => {
    const decisao = avaliar(comPapel("OPERADOR_CAIXA"), {
      tipo: "DESCONTO_ITEM",
      percentualBps: 500,
    });

    expect(decisao.tipo).toBe("PERMITIDO");
  });

  it("🔑 desconto acima do limite pede supervisor, não bloqueia", () => {
    // Bloquear puro faz a equipe procurar contorno — normalmente o supervisor
    // logando no lugar do operador, o que atribui a venda à pessoa errada.
    const decisao = avaliar(comPapel("OPERADOR_CAIXA"), {
      tipo: "DESCONTO_ITEM",
      percentualBps: 1200,
    });

    expect(decisao.tipo).toBe("REQUER_SUPERVISOR");
    if (decisao.tipo === "REQUER_SUPERVISOR") {
      expect(decisao.permissaoNecessaria).toBe("venda:desconto_acima_limite");
      expect(decisao.motivo).toBe("Desconto acima do seu limite de 5% no item.");
    }
  });

  it("distingue o limite do item do limite da venda", () => {
    const operador = comPapel("OPERADOR_CAIXA");

    // 4% passa no item (teto 5%) e não passa na venda (teto 3%).
    expect(avaliar(operador, { tipo: "DESCONTO_ITEM", percentualBps: 400 }).tipo).toBe(
      "PERMITIDO",
    );
    expect(avaliar(operador, { tipo: "DESCONTO_VENDA", percentualBps: 400 }).tipo).toBe(
      "REQUER_SUPERVISOR",
    );
  });

  it("o supervisor tem teto maior, e ainda assim tem teto", () => {
    const supervisor = comPapel("SUPERVISOR");

    expect(avaliar(supervisor, { tipo: "DESCONTO_ITEM", percentualBps: 1500 }).tipo).toBe(
      "PERMITIDO",
    );
    expect(avaliar(supervisor, { tipo: "DESCONTO_ITEM", percentualBps: 1501 }).tipo).toBe(
      "REQUER_SUPERVISOR",
    );
  });

  it("formata percentual quebrado na mensagem", () => {
    const papelQuebrado = Papel.criar({
      id: PAPEL_ID,
      codigo: "TESTE",
      nome: "Teste",
      permissoes: ["venda:desconto"],
      limites: { descontoMaximoItemBps: 1550 },
    }).unwrap();

    const usuario = comPapel("OPERADOR_CAIXA");
    usuario.alterarPapel(papelQuebrado);

    const decisao = avaliar(usuario, { tipo: "DESCONTO_ITEM", percentualBps: 2000 });

    expect(decisao.tipo).toBe("REQUER_SUPERVISOR");
    if (decisao.tipo === "REQUER_SUPERVISOR") {
      expect(decisao.motivo).toContain("15,5%");
    }
  });

  it.each([[-1], [10_001]])("recusa percentual absurdo (%i bps)", (percentualBps) => {
    const decisao = avaliar(comPapel("OPERADOR_CAIXA"), {
      tipo: "DESCONTO_ITEM",
      percentualBps,
    });

    expect(decisao.tipo).toBe("NEGADO");
  });

  it("nega desconto a quem não tem a permissão base", () => {
    expect(
      avaliar(comPapel("ESTOQUISTA"), { tipo: "DESCONTO_ITEM", percentualBps: 100 }).tipo,
    ).toBe("NEGADO");
  });
});

describe("Autorização — sangria e estorno", () => {
  it("🔑 o operador de caixa não sangra a gaveta nem com supervisor ao lado", () => {
    // Sem a permissão base, nem se discute limite: quem executa a sangria é o
    // supervisor, com a própria conta.
    const decisao = avaliar(comPapel("OPERADOR_CAIXA"), {
      tipo: "SANGRIA",
      valor: reais("50,00"),
    });

    expect(decisao.tipo).toBe("NEGADO");
  });

  it("permite sangria do supervisor dentro do teto", () => {
    expect(
      avaliar(comPapel("SUPERVISOR"), { tipo: "SANGRIA", valor: reais("500,00") }).tipo,
    ).toBe("PERMITIDO");
  });

  it("sangria acima do teto do supervisor pede autorização", () => {
    const decisao = avaliar(comPapel("SUPERVISOR"), {
      tipo: "SANGRIA",
      valor: reais("500,01"),
    });

    expect(decisao.tipo).toBe("REQUER_SUPERVISOR");
    if (decisao.tipo === "REQUER_SUPERVISOR") {
      expect(decisao.motivo).toBe("Sangria acima do seu limite de R$ 500,00.");
    }
  });

  it("🔑 o gerente não tem teto de sangria", () => {
    expect(
      avaliar(comPapel("GERENTE"), { tipo: "SANGRIA", valor: reais("99999,00") }).tipo,
    ).toBe("PERMITIDO");
  });

  it("aplica teto próprio ao estorno em dinheiro", () => {
    const supervisor = comPapel("SUPERVISOR");

    expect(
      avaliar(supervisor, { tipo: "ESTORNO_EM_DINHEIRO", valor: reais("200,00") }).tipo,
    ).toBe("PERMITIDO");

    const acima = avaliar(supervisor, {
      tipo: "ESTORNO_EM_DINHEIRO",
      valor: reais("250,00"),
    });
    expect(acima.tipo).toBe("REQUER_SUPERVISOR");
    if (acima.tipo === "REQUER_SUPERVISOR") {
      expect(acima.motivo).toContain("Estorno em dinheiro");
    }
  });

  it("recusa valor negativo", () => {
    expect(
      avaliar(comPapel("SUPERVISOR"), {
        tipo: "SANGRIA",
        valor: reais("100,00").negar(),
      }).tipo,
    ).toBe("NEGADO");
  });
});

describe("Autorização — cancelamento de venda", () => {
  it("🔑 o operador de caixa não cancela venda finalizada", () => {
    expect(
      avaliar(comPapel("OPERADOR_CAIXA"), {
        tipo: "CANCELAR_VENDA",
        minutosDesdeFinalizacao: 1,
      }).tipo,
    ).toBe("NEGADO");
  });

  it("o supervisor cancela dentro da janela de 30 minutos", () => {
    const supervisor = comPapel("SUPERVISOR");

    expect(
      avaliar(supervisor, { tipo: "CANCELAR_VENDA", minutosDesdeFinalizacao: 30 }).tipo,
    ).toBe("PERMITIDO");

    const fora = avaliar(supervisor, {
      tipo: "CANCELAR_VENDA",
      minutosDesdeFinalizacao: 31,
    });
    expect(fora.tipo).toBe("REQUER_SUPERVISOR");
    if (fora.tipo === "REQUER_SUPERVISOR") {
      expect(fora.motivo).toBe("Só é possível cancelar até 30 minutos após a venda.");
    }
  });

  it("o gerente cancela venda de ontem", () => {
    expect(
      avaliar(comPapel("GERENTE"), {
        tipo: "CANCELAR_VENDA",
        minutosDesdeFinalizacao: 60 * 24,
      }).tipo,
    ).toBe("PERMITIDO");
  });
});

describe("Autorização — quem pode liberar", () => {
  const descontoAlto: AcaoSolicitada = { tipo: "DESCONTO_ITEM", percentualBps: 1200 };

  function decisaoDe(usuario: Usuario, acao: AcaoSolicitada) {
    const decisao = avaliar(usuario, acao);
    if (decisao.tipo !== "REQUER_SUPERVISOR") {
      throw new Error("fixture inválida: a decisão deveria exigir supervisor");
    }
    return decisao;
  }

  it("o supervisor libera o desconto que o operador não podia dar", () => {
    const decisao = decisaoDe(comPapel("OPERADOR_CAIXA"), descontoAlto);

    expect(podeAutorizar(comPapel("SUPERVISOR"), decisao, descontoAlto)).toBe(true);
  });

  it("🔑 dois operadores não se autorizam mutuamente", () => {
    // Sem esta regra, o buraco seria óbvio: o colega ao lado libera o desconto
    // que ele próprio não pode dar.
    const decisao = decisaoDe(comPapel("OPERADOR_CAIXA"), descontoAlto);

    expect(podeAutorizar(comPapel("OPERADOR_CAIXA"), decisao, descontoAlto)).toBe(false);
  });

  it("🔑 nem o supervisor libera acima do próprio teto", () => {
    // A segunda metade da regra: ter a permissão não basta, o limite dele
    // também precisa comportar a operação.
    const acaoAcimaDeTodos: AcaoSolicitada = {
      tipo: "DESCONTO_ITEM",
      percentualBps: 2000,
    };
    const decisao = decisaoDe(comPapel("OPERADOR_CAIXA"), acaoAcimaDeTodos);

    expect(podeAutorizar(comPapel("SUPERVISOR"), decisao, acaoAcimaDeTodos)).toBe(false);
    expect(podeAutorizar(comPapel("GERENTE"), decisao, acaoAcimaDeTodos)).toBe(true);
  });

  it("usuário desativado não autoriza nada", () => {
    const decisao = decisaoDe(comPapel("OPERADOR_CAIXA"), descontoAlto);
    const supervisor = comPapel("SUPERVISOR");
    supervisor.desativar();

    expect(podeAutorizar(supervisor, decisao, descontoAlto)).toBe(false);
  });

  it("o estoquista não libera desconto — não tem a permissão exigida", () => {
    const decisao = decisaoDe(comPapel("OPERADOR_CAIXA"), descontoAlto);

    expect(podeAutorizar(comPapel("ESTOQUISTA"), decisao, descontoAlto)).toBe(false);
  });
});
