import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { type Alcada, decidir, podeAutorizar } from "./autorizacao.js";
import { HashCredencial } from "./HashCredencial.js";
import { Matricula } from "./Matricula.js";
import { type Papel, papeisDeFabrica } from "./Papel.js";
import { TENTATIVAS_ATE_BLOQUEIO, Usuario } from "./Usuario.js";

const AGORA = new Date("2026-07-31T14:00:00.000Z");
const reais = (valor: string): Dinheiro => Dinheiro.deReais(valor).unwrap();

const papel = (codigo: string): Papel => {
  const encontrado = papeisDeFabrica().find((candidato) => candidato.codigo === codigo);
  if (encontrado === undefined) throw new Error(`papel ausente: ${codigo}`);
  return encontrado;
};

let sequencia = 0;

function usuarioCom(codigoPapel: string): Usuario {
  sequencia += 1;
  const id = Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-${String(sequencia).padStart(12, "0")}`,
  ).unwrap();

  const usuario = Usuario.criar({
    id,
    matricula: Matricula.criar(String(sequencia)).unwrap(),
    nome: "Pessoa",
    papeis: [papel(codigoPapel)],
  }).unwrap();

  usuario.definirPin(HashCredencial.criar("$argon2id$hash").unwrap());
  usuario.coletarEventos();

  return usuario;
}

describe("decidir — porta fechada", () => {
  it("nega quem não tem a permissão", () => {
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(
      decidir({ usuario: operador, permissao: "venda:cancelar", agora: AGORA }),
    ).toBe("NEGADO");
  });

  it("nega usuário desativado, mesmo com a permissão", () => {
    const gerente = usuarioCom("GERENTE");
    gerente.desativar();

    expect(decidir({ usuario: gerente, permissao: "venda:criar", agora: AGORA })).toBe(
      "NEGADO",
    );
  });

  it("nega usuário bloqueado, mesmo com a permissão", () => {
    const gerente = usuarioCom("GERENTE");
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      gerente.registrarFalhaDeAcesso("PIN", AGORA);
    }

    expect(decidir({ usuario: gerente, permissao: "venda:criar", agora: AGORA })).toBe(
      "NEGADO",
    );
  });

  it("nega em vez de escalar quando a conta está bloqueada", () => {
    // Escalar aqui seria enganoso: o supervisor viria, autorizaria, e continuaria
    // não funcionando. A ordem das verificações existe para isso.
    const operador = usuarioCom("OPERADOR_CAIXA");
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      operador.registrarFalhaDeAcesso("PIN", AGORA);
    }

    const alcada: Alcada = { tipo: "DESCONTO_ITEM", centesimosDePorCento: 2_000 };

    expect(
      decidir({ usuario: operador, permissao: "venda:desconto", alcada, agora: AGORA }),
    ).toBe("NEGADO");
  });

  it("volta a permitir depois de o bloqueio expirar", () => {
    const gerente = usuarioCom("GERENTE");
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      gerente.registrarFalhaDeAcesso("PIN", AGORA);
    }

    const depois = new Date(AGORA.getTime() + 16 * 60_000);

    expect(decidir({ usuario: gerente, permissao: "venda:criar", agora: depois })).toBe(
      "PERMITIDO",
    );
  });
});

describe("decidir — operação sem alçada", () => {
  it("permite quando a permissão existe", () => {
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(decidir({ usuario: operador, permissao: "venda:criar", agora: AGORA })).toBe(
      "PERMITIDO",
    );
  });

  it("trata alçada ausente como simples", () => {
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(decidir({ usuario: operador, permissao: "caixa:abrir", agora: AGORA })).toBe(
      "PERMITIDO",
    );
  });

  it("permite explicitamente com alçada SIMPLES", () => {
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(
      decidir({
        usuario: operador,
        permissao: "caixa:fechar",
        alcada: { tipo: "SIMPLES" },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");
  });
});

describe("decidir — desconto", () => {
  it("permite dentro do limite do operador", () => {
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(
      decidir({
        usuario: operador,
        permissao: "venda:desconto",
        alcada: { tipo: "DESCONTO_ITEM", centesimosDePorCento: 500 },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");
  });

  it("escala em vez de bloquear acima do limite", () => {
    // O ponto central do §9.4: bloquear puro faz a equipe procurar contorno, e a
    // operação passa a acontecer sem rastro.
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(
      decidir({
        usuario: operador,
        permissao: "venda:desconto",
        alcada: { tipo: "DESCONTO_ITEM", centesimosDePorCento: 501 },
        agora: AGORA,
      }),
    ).toBe("REQUER_SUPERVISOR");
  });

  it("aplica o limite da venda, distinto do limite do item", () => {
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(
      decidir({
        usuario: operador,
        permissao: "venda:desconto",
        alcada: { tipo: "DESCONTO_VENDA", centesimosDePorCento: 300 },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");

    expect(
      decidir({
        usuario: operador,
        permissao: "venda:desconto",
        alcada: { tipo: "DESCONTO_VENDA", centesimosDePorCento: 400 },
        agora: AGORA,
      }),
    ).toBe("REQUER_SUPERVISOR");
  });
});

describe("decidir — sangria e estorno", () => {
  it("escala sangria acima do teto do supervisor", () => {
    const supervisor = usuarioCom("SUPERVISOR");

    expect(
      decidir({
        usuario: supervisor,
        permissao: "caixa:sangria",
        alcada: { tipo: "SANGRIA", valor: reais("500.00") },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");

    expect(
      decidir({
        usuario: supervisor,
        permissao: "caixa:sangria",
        alcada: { tipo: "SANGRIA", valor: reais("500.01") },
        agora: AGORA,
      }),
    ).toBe("REQUER_SUPERVISOR");
  });

  it("permite qualquer sangria ao gerente", () => {
    const gerente = usuarioCom("GERENTE");

    expect(
      decidir({
        usuario: gerente,
        permissao: "caixa:sangria",
        alcada: { tipo: "SANGRIA", valor: reais("100000.00") },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");
  });

  it("nega sangria ao operador, que não tem a permissão", () => {
    // Sem permissão não há o que escalar: a ação não é dele em nenhum valor.
    const operador = usuarioCom("OPERADOR_CAIXA");

    expect(
      decidir({
        usuario: operador,
        permissao: "caixa:sangria",
        alcada: { tipo: "SANGRIA", valor: reais("10.00") },
        agora: AGORA,
      }),
    ).toBe("NEGADO");
  });

  it("aplica o teto de estorno em dinheiro", () => {
    const supervisor = usuarioCom("SUPERVISOR");

    expect(
      decidir({
        usuario: supervisor,
        permissao: "venda:cancelar",
        alcada: { tipo: "ESTORNO_DINHEIRO", valor: reais("200.00") },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");

    expect(
      decidir({
        usuario: supervisor,
        permissao: "venda:cancelar",
        alcada: { tipo: "ESTORNO_DINHEIRO", valor: reais("250.00") },
        agora: AGORA,
      }),
    ).toBe("REQUER_SUPERVISOR");
  });
});

describe("decidir — janela de cancelamento", () => {
  it("permite o supervisor cancelar dentro de trinta minutos", () => {
    const supervisor = usuarioCom("SUPERVISOR");

    expect(
      decidir({
        usuario: supervisor,
        permissao: "venda:cancelar",
        alcada: { tipo: "CANCELAR_VENDA", minutosDesdeFinalizacao: 30 },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");
  });

  it("escala fora da janela", () => {
    const supervisor = usuarioCom("SUPERVISOR");

    expect(
      decidir({
        usuario: supervisor,
        permissao: "venda:cancelar",
        alcada: { tipo: "CANCELAR_VENDA", minutosDesdeFinalizacao: 31 },
        agora: AGORA,
      }),
    ).toBe("REQUER_SUPERVISOR");
  });

  it("permite o gerente cancelar venda antiga", () => {
    const gerente = usuarioCom("GERENTE");

    expect(
      decidir({
        usuario: gerente,
        permissao: "venda:cancelar",
        alcada: { tipo: "CANCELAR_VENDA", minutosDesdeFinalizacao: 100_000 },
        agora: AGORA,
      }),
    ).toBe("PERMITIDO");
  });
});

describe("podeAutorizar", () => {
  it("exige que o autorizador tenha alçada para o valor pedido", () => {
    // O controle contornando a si mesmo: um supervisor aprovando sangria de
    // R$ 900 quando o próprio teto é R$ 500 — e a auditoria registraria como
    // legítimo.
    const supervisor = usuarioCom("SUPERVISOR");

    expect(
      podeAutorizar({
        usuario: supervisor,
        permissao: "caixa:sangria",
        alcada: { tipo: "SANGRIA", valor: reais("900.00") },
        agora: AGORA,
      }),
    ).toBe(false);

    expect(
      podeAutorizar({
        usuario: usuarioCom("GERENTE"),
        permissao: "caixa:sangria",
        alcada: { tipo: "SANGRIA", valor: reais("900.00") },
        agora: AGORA,
      }),
    ).toBe(true);
  });

  it("recusa autorizador sem a permissão", () => {
    expect(
      podeAutorizar({
        usuario: usuarioCom("ESTOQUISTA"),
        permissao: "venda:cancelar",
        agora: AGORA,
      }),
    ).toBe(false);
  });

  it("recusa autorizador bloqueado", () => {
    const gerente = usuarioCom("GERENTE");
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      gerente.registrarFalhaDeAcesso("PIN", AGORA);
    }

    expect(
      podeAutorizar({ usuario: gerente, permissao: "venda:cancelar", agora: AGORA }),
    ).toBe(false);
  });
});
