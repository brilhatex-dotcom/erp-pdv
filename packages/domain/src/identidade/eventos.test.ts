import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import {
  credencialBloqueada,
  operacaoAutorizadaPorSupervisor,
  tentativaRecusada,
} from "./eventos.js";

const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fd001").unwrap();
const SUPERVISOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fd002").unwrap();
const AGORA = new Date("2026-07-31T14:30:00.000Z");

describe("Eventos de identidade", () => {
  it("tentativa recusada carrega a matrícula e a contagem", () => {
    const evento = tentativaRecusada(OPERADOR, "42", 3, AGORA);

    expect(evento.tipo).toBe("TentativaDeAcessoRecusada");
    expect(evento.agregadoId.equals(OPERADOR)).toBe(true);
    expect(evento.matricula).toBe("42");
    expect(evento.tentativasSeguidas).toBe(3);
    expect(evento.ocorridoEm).toBe(AGORA);
  });

  it("bloqueio carrega duração e término", () => {
    const ate = new Date(AGORA.getTime() + 15 * 60_000);
    const evento = credencialBloqueada(OPERADOR, "42", 15, ate, AGORA);

    expect(evento.tipo).toBe("CredencialBloqueada");
    expect(evento.minutos).toBe(15);
    expect(evento.bloqueadoAte).toBe(ate);
  });

  it("🔑 a autorização de supervisor registra os DOIS usuários", () => {
    // É o que responde, meses depois, quem pediu o desconto de 40% e quem
    // autorizou — pergunta que aparece exatamente quando a margem não fecha.
    const evento = operacaoAutorizadaPorSupervisor(
      OPERADOR,
      SUPERVISOR,
      "venda:desconto_acima_limite",
      "Desconto de 20% no item 3 da venda 1042",
      AGORA,
    );

    expect(evento.tipo).toBe("OperacaoAutorizadaPorSupervisor");
    expect(evento.solicitanteId.equals(OPERADOR)).toBe(true);
    expect(evento.autorizadorId.equals(SUPERVISOR)).toBe(true);
    expect(evento.permissao).toBe("venda:desconto_acima_limite");
    expect(evento.descricao).toBe("Desconto de 20% no item 3 da venda 1042");
  });

  it("🔑 o evento é atribuído ao solicitante, não ao supervisor", () => {
    // A sessão continua sendo do operador: o supervisor liberou a operação,
    // não assumiu a venda. Trocar isto atribuiria a venda à pessoa errada.
    const evento = operacaoAutorizadaPorSupervisor(
      OPERADOR,
      SUPERVISOR,
      "caixa:sangria",
      "Sangria de R$ 800,00",
      AGORA,
    );

    expect(evento.agregadoId.equals(OPERADOR)).toBe(true);
  });
});
