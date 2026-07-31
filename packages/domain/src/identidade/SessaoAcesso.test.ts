import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { CredencialHash } from "./CredencialHash.js";
import type { FamiliaDeSessaoRevogada } from "./eventos.js";
import { type DadosSessaoAcesso, SessaoAcesso } from "./SessaoAcesso.js";

const SESSAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e50a001").unwrap();
const SUCESSORA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e50a002").unwrap();
const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e50a003").unwrap();
const DISPOSITIVO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e50a004").unwrap();
const AGORA = new Date("2026-07-31T09:00:00.000Z");

function horasDepois(horas: number): Date {
  return new Date(AGORA.getTime() + horas * 60 * 60 * 1000);
}

function dados(sobrescritas: Partial<DadosSessaoAcesso> = {}): DadosSessaoAcesso {
  return {
    id: SESSAO,
    usuarioId: USUARIO,
    // Primeira sessão da cadeia: a família é ela própria.
    familiaId: SESSAO,
    dispositivoId: DISPOSITIVO,
    contexto: "PDV",
    hashRefresh: CredencialHash.criar("$argon2id$refresh", "argon2id").unwrap(),
    criadaEm: AGORA,
    expiraEm: horasDepois(12),
    ...sobrescritas,
  };
}

function abrir(sobrescritas: Partial<DadosSessaoAcesso> = {}): SessaoAcesso {
  return SessaoAcesso.abrir(dados(sobrescritas));
}

describe("Sessão de acesso — abertura", () => {
  it("nasce válida, sem uso e sem revogação", () => {
    const sessao = abrir();

    expect(sessao.estaValida(AGORA)).toBe(true);
    expect(sessao.jaFoiUsada).toBe(false);
    expect(sessao.estaRevogada).toBe(false);
    expect(sessao.sucessoraId).toBeUndefined();
    expect(sessao.usadaEm).toBeUndefined();
    expect(sessao.revogadaEm).toBeUndefined();
  });

  it("carrega usuário, dispositivo, contexto e família", () => {
    const sessao = abrir();

    expect(sessao.usuarioId.equals(USUARIO)).toBe(true);
    expect(sessao.dispositivoId.equals(DISPOSITIVO)).toBe(true);
    expect(sessao.familiaId.equals(SESSAO)).toBe(true);
    expect(sessao.contexto).toBe("PDV");
    expect(sessao.criadaEm).toBe(AGORA);
  });

  it("🔑 guarda o hash do refresh, nunca o valor em claro", () => {
    // Vazamento do banco não entrega sessão ativa: hash não é aceito na renovação.
    expect(abrir().hashRefresh.valor).toBe("$argon2id$refresh");
  });

  it("expira no vencimento, não depois", () => {
    const sessao = abrir();

    expect(sessao.estaExpirada(horasDepois(11))).toBe(false);
    // No instante exato do vencimento já está expirada.
    expect(sessao.estaExpirada(horasDepois(12))).toBe(true);
    expect(sessao.estaValida(horasDepois(13))).toBe(false);
  });
});

describe("Sessão de acesso — renovação", () => {
  it("deixa renovar enquanto está válida", () => {
    expect(abrir().podeRenovar(AGORA).isOk()).toBe(true);
  });

  it("🔑 marca a sessão como gasta e aponta para a sucessora", () => {
    const sessao = abrir();

    sessao.marcarComoRenovada(SUCESSORA, horasDepois(1));

    expect(sessao.jaFoiUsada).toBe(true);
    expect(sessao.sucessoraId?.equals(SUCESSORA)).toBe(true);
    expect(sessao.usadaEm?.toISOString()).toBe(horasDepois(1).toISOString());
    expect(sessao.estaValida(horasDepois(1))).toBe(false);
  });

  it("🔑 distingue expirada de reusada — são reações diferentes", () => {
    // Expirada é rotina: o usuário só refaz o login. Já usada é um refresh que
    // voltou do além, e aí a família toda cai.
    const expirada = abrir();
    const reusada = abrir();
    reusada.marcarComoRenovada(SUCESSORA, AGORA);

    const daExpirada = expirada.podeRenovar(horasDepois(13));
    const daReusada = reusada.podeRenovar(AGORA);

    expect(daExpirada.isErr()).toBe(true);
    expect(daReusada.isErr()).toBe(true);
    if (daExpirada.isErr()) expect(daExpirada.error.codigo).toBe("SESSAO_EXPIRADA");
    if (daReusada.isErr()) expect(daReusada.error.codigo).toBe("SESSAO_REUSO_DETECTADO");
  });

  it("recusa renovar sessão revogada", () => {
    const sessao = abrir();
    sessao.revogar(AGORA);

    const resultado = sessao.podeRenovar(AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SESSAO_REVOGADA");
  });

  it("a revogação prevalece sobre o reúso na mensagem", () => {
    // Sessão revogada E já usada: revogada vem primeiro porque é o estado
    // final, e repetir o alerta de roubo a cada tentativa seria ruído.
    const sessao = abrir();
    sessao.marcarComoRenovada(SUCESSORA, AGORA);
    sessao.revogar(AGORA);

    const resultado = sessao.podeRenovar(AGORA);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SESSAO_REVOGADA");
  });
});

describe("Sessão de acesso — revogação", () => {
  it("registra o instante da revogação", () => {
    const sessao = abrir();

    sessao.revogar(horasDepois(2));

    expect(sessao.estaRevogada).toBe(true);
    expect(sessao.revogadaEm?.toISOString()).toBe(horasDepois(2).toISOString());
  });

  it("revogar duas vezes preserva o primeiro instante", () => {
    // O primeiro é o que importa para a auditoria: foi quando o acesso caiu.
    const sessao = abrir();

    sessao.revogar(horasDepois(2));
    sessao.revogar(horasDepois(5));

    expect(sessao.revogadaEm?.toISOString()).toBe(horasDepois(2).toISOString());
  });

  it("🔑 o reúso produz o evento que dispara o alerta na retaguarda", () => {
    const sessao = abrir();

    sessao.registrarReuso(horasDepois(1));

    const evento = sessao.coletarEventos()[0] as FamiliaDeSessaoRevogada;
    expect(evento.tipo).toBe("FamiliaDeSessaoRevogada");
    expect(evento.usuarioId.equals(USUARIO)).toBe(true);
    expect(evento.familiaId.equals(SESSAO)).toBe(true);
  });
});

describe("Sessão de acesso — prorrogação", () => {
  it("🔑 estende a validade enquanto o operador trabalha", () => {
    // A sessão do PDV não expira com o caixa aberto: expirar no meio de uma
    // venda, com o cliente esperando, é defeito de produto.
    const sessao = abrir();

    sessao.prorrogar(horasDepois(20));

    expect(sessao.expiraEm.toISOString()).toBe(horasDepois(20).toISOString());
    expect(sessao.estaValida(horasDepois(15))).toBe(true);
  });

  it("nunca encurta a validade", () => {
    const sessao = abrir();

    sessao.prorrogar(horasDepois(2));

    expect(sessao.expiraEm.toISOString()).toBe(horasDepois(12).toISOString());
  });
});

describe("Sessão de acesso — reconstituição", () => {
  it("volta com o estado gravado", () => {
    const sessao = SessaoAcesso.reconstituir({
      ...dados({ contexto: "RETAGUARDA" }),
      revogadaEm: undefined,
      usadaEm: horasDepois(1),
      sucessoraId: SUCESSORA,
    });

    expect(sessao.contexto).toBe("RETAGUARDA");
    expect(sessao.jaFoiUsada).toBe(true);
    expect(sessao.sucessoraId?.equals(SUCESSORA)).toBe(true);
  });

  it("🔑 sessão revogada no banco continua revogada ao voltar", () => {
    // Reiniciar o servidor não pode ressuscitar sessão derrubada por roubo.
    const sessao = SessaoAcesso.reconstituir({
      ...dados(),
      revogadaEm: horasDepois(1),
      usadaEm: undefined,
      sucessoraId: undefined,
    });

    expect(sessao.estaRevogada).toBe(true);
    expect(sessao.podeRenovar(horasDepois(2)).isErr()).toBe(true);
  });

  it("não registra evento algum", () => {
    const sessao = SessaoAcesso.reconstituir({
      ...dados(),
      revogadaEm: undefined,
      usadaEm: undefined,
      sucessoraId: undefined,
    });

    expect(sessao.eventos).toHaveLength(0);
  });
});
