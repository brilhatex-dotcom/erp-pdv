import { describe, expect, it } from "vitest";

import { montarAmbiente } from "../testes/dubles.js";
import { ACOES_AUDITADAS, auditar, ehAcaoAuditada } from "./RegistroAuditoria.js";

describe("Registro de auditoria", () => {
  it("grava com identificador novo, na transação de quem chamou", async () => {
    const ambiente = montarAmbiente();

    await auditar(ambiente.unitOfWork.repositorios, ambiente.geradorId, {
      ocorridoEm: new Date("2026-08-01T10:00:00.000Z"),
      acao: "SANGRIA",
      descricao: "Sangria de R$ 100,00",
    });

    expect(ambiente.auditoria.registros).toHaveLength(1);
    expect(ambiente.auditoria.registros[0]?.id).toBeDefined();
  });

  it("🔑 descrição longa é cortada, nunca recusada — a operação não pode falhar por causa do registro", async () => {
    const ambiente = montarAmbiente();

    await auditar(ambiente.unitOfWork.repositorios, ambiente.geradorId, {
      ocorridoEm: new Date(),
      acao: "VENDA_CANCELADA",
      descricao: "x".repeat(500),
    });

    const descricao = ambiente.auditoria.registros[0]?.descricao ?? "";
    expect(descricao).toHaveLength(300);
    expect(descricao.endsWith("…")).toBe(true);
  });

  it("reconhece as ações da lista e recusa as que não estão", () => {
    expect(ACOES_AUDITADAS.every((acao) => ehAcaoAuditada(acao))).toBe(true);
    expect(ehAcaoAuditada("APAGAR_TUDO")).toBe(false);
  });
});
