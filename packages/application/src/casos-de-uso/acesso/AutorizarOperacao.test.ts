import {
  type AcaoSolicitada,
  CredencialHash,
  Dinheiro,
  Identificador,
  Matricula,
  type OperacaoAutorizadaPorSupervisor,
  Papel,
  papelPadrao,
  TENTATIVAS_ATE_BLOQUEIO,
  Usuario,
} from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import { AutorizarOperacao } from "./AutorizarOperacao.js";

const OPERADOR_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4ff001").unwrap();
const SUPERVISOR_ID = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4ff002",
).unwrap();
const GERENTE_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4ff003").unwrap();
const PAPEL_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4ff004").unwrap();
const AGORA = new Date("2026-07-31T09:00:00.000Z");

function hashDe(texto: string): CredencialHash {
  return CredencialHash.criar(`falso:${texto}`, "falso").unwrap();
}

function montar() {
  const ambiente = montarAmbiente(AGORA);

  const pessoas = [
    {
      id: OPERADOR_ID,
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "419273",
    },
    {
      id: SUPERVISOR_ID,
      matricula: "7",
      nome: "João",
      papel: "SUPERVISOR",
      pin: "860412",
    },
    { id: GERENTE_ID, matricula: "1", nome: "Ana", papel: "GERENTE", pin: "573914" },
  ] as const;

  for (const pessoa of pessoas) {
    ambiente.usuarios.adicionar(
      Usuario.criar({
        id: pessoa.id,
        matricula: Matricula.criar(pessoa.matricula).unwrap(),
        nome: pessoa.nome,
        papel: Papel.criar(papelPadrao(pessoa.papel, PAPEL_ID)).unwrap(),
        hashPin: hashDe(pessoa.pin),
      }).unwrap(),
    );
  }

  return {
    ...ambiente,
    autorizar: new AutorizarOperacao(ambiente.relogio, ambiente.hasher),
  };
}

let sistema: ReturnType<typeof montar>;

beforeEach(() => {
  sistema = montar();
});

/** Desconto de 12% num item — acima do teto de 5% do operador. */
const DESCONTO_ALTO: AcaoSolicitada = { tipo: "DESCONTO_ITEM", percentualBps: 1200 };

describe("Autorização de operação", () => {
  it("passa direto quando está dentro do limite", async () => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: { tipo: "DESCONTO_ITEM", percentualBps: 300 },
      descricao: "Desconto de 3% no item 1",
    });

    expect(resultado.isOk()).toBe(true);
    expect(sistema.outbox.eventos).toHaveLength(0);
  });

  it("🔑 pede supervisor em vez de bloquear, e a interface sabe disso", async () => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12% no item 1",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      // Código distinto de "negado": diz ao PDV que existe caminho adiante.
      expect(resultado.error.codigo).toBe("AUTORIZACAO_NECESSARIA");
      expect(resultado.error.detalhes?.["permissaoNecessaria"]).toBe(
        "venda:desconto_acima_limite",
      );
    }
  });

  it("nega de vez o que nem com supervisor sai", async () => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: { tipo: "PERMISSAO", permissao: "config:fiscal" },
      descricao: "Configuração fiscal",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("OPERACAO_NEGADA");
  });

  it("🔑 o supervisor libera, e a auditoria guarda os DOIS", async () => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12% no item 1 da venda 1042",
      credencialSupervisor: { matricula: "7", pin: "860412" },
    });

    expect(resultado.isOk()).toBe(true);

    const evento = sistema.outbox.eventos[0] as OperacaoAutorizadaPorSupervisor;
    expect(evento.tipo).toBe("OperacaoAutorizadaPorSupervisor");
    expect(evento.solicitanteId.equals(OPERADOR_ID)).toBe(true);
    expect(evento.autorizadorId.equals(SUPERVISOR_ID)).toBe(true);
    expect(evento.descricao).toContain("venda 1042");
  });

  it("🔑 a operação continua sendo do operador — a sessão não troca", async () => {
    // Se o supervisor logasse no lugar dele, a venda inteira passaria a ser
    // atribuída à pessoa errada e o rastro se perderia.
    await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12%",
      credencialSupervisor: { matricula: "7", pin: "860412" },
    });

    const evento = sistema.outbox.eventos[0] as OperacaoAutorizadaPorSupervisor;
    expect(evento.agregadoId.equals(OPERADOR_ID)).toBe(true);
  });

  it("recusa PIN de supervisor errado", async () => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12%",
      credencialSupervisor: { matricula: "7", pin: "000111" },
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("SUPERVISOR_CREDENCIAL_INVALIDA");
    }
  });

  it("🔑 o modal de supervisor não é porta dos fundos para testar PIN", async () => {
    // Tentativa falha aqui conta igual à do login, e o bloqueio vale também.
    for (let i = 0; i < TENTATIVAS_ATE_BLOQUEIO; i += 1) {
      await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
        solicitanteId: OPERADOR_ID,
        acao: DESCONTO_ALTO,
        descricao: "Desconto de 12%",
        credencialSupervisor: { matricula: "7", pin: "000111" },
      });
    }

    const bloqueado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12%",
      credencialSupervisor: { matricula: "7", pin: "860412" },
    });

    expect(bloqueado.isErr()).toBe(true);
    if (bloqueado.isErr()) expect(bloqueado.error.codigo).toBe("USUARIO_BLOQUEADO");
  });

  it("gasta o tempo do hash com matrícula de supervisor inexistente", async () => {
    await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12%",
      credencialSupervisor: { matricula: "999", pin: "860412" },
    });

    expect(sistema.hasher.tempoGastoEmVao).toBe(1);
  });

  it.each([
    ["inválida", "não-numérica"],
    ["inexistente", "999"],
  ])("recusa matrícula de supervisor %s", async (_descricao, matricula) => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12%",
      credencialSupervisor: { matricula, pin: "860412" },
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("SUPERVISOR_CREDENCIAL_INVALIDA");
    }
  });

  it("🔑 dois operadores não se autorizam mutuamente", async () => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: OPERADOR_ID,
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12%",
      // O colega ao lado, com o mesmo papel.
      credencialSupervisor: { matricula: "42", pin: "419273" },
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SUPERVISOR_SEM_ALCADA");
  });

  it("🔑 nem o supervisor libera acima do próprio teto — mas o gerente sim", async () => {
    const acimaDeTodos: AcaoSolicitada = { tipo: "DESCONTO_ITEM", percentualBps: 2000 };

    const peloSupervisor = await sistema.autorizar.executar(
      sistema.unitOfWork.repositorios,
      {
        solicitanteId: OPERADOR_ID,
        acao: acimaDeTodos,
        descricao: "Desconto de 20%",
        credencialSupervisor: { matricula: "7", pin: "860412" },
      },
    );

    expect(peloSupervisor.isErr()).toBe(true);
    if (peloSupervisor.isErr()) {
      expect(peloSupervisor.error.codigo).toBe("SUPERVISOR_SEM_ALCADA");
    }

    const peloGerente = await sistema.autorizar.executar(
      sistema.unitOfWork.repositorios,
      {
        solicitanteId: OPERADOR_ID,
        acao: acimaDeTodos,
        descricao: "Desconto de 20%",
        credencialSupervisor: { matricula: "1", pin: "573914" },
      },
    );

    expect(peloGerente.isOk()).toBe(true);
  });

  it("libera sangria acima do teto do supervisor com o gerente", async () => {
    const sangriaGrande: AcaoSolicitada = {
      tipo: "SANGRIA",
      valor: Dinheiro.deReais("800,00").unwrap(),
    };

    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: SUPERVISOR_ID,
      acao: sangriaGrande,
      descricao: "Sangria de R$ 800,00",
      credencialSupervisor: { matricula: "1", pin: "573914" },
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("recusa solicitante desconhecido", async () => {
    const resultado = await sistema.autorizar.executar(sistema.unitOfWork.repositorios, {
      solicitanteId: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4ff099").unwrap(),
      acao: DESCONTO_ALTO,
      descricao: "Desconto de 12%",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("USUARIO_DESCONHECIDO");
  });
});
