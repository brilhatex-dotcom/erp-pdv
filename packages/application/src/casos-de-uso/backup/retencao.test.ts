import { describe, expect, it } from "vitest";

import type { CopiaGuardada } from "./portas.js";
import { copiasParaApagar, RETENCAO_PADRAO, semanaIso } from "./retencao.js";

/**
 * A retenção decide o que some do disco — e um erro aqui apaga a cópia de que
 * a loja vai precisar. Por isso as regras são conferidas uma a uma.
 */

const RESUMO = { vendas: 1, produtos: 1, clientes: 0, caixasAbertos: 0, migracoes: [] };

function copia(
  instante: string,
  restaurou = true,
  origem: CopiaGuardada["origem"] = "AUTOMATICA",
): CopiaGuardada {
  return {
    nome: `erp-${instante}.dump`,
    criadaEm: new Date(instante),
    origem,
    tamanhoBytes: 1024,
    sha256: "a".repeat(64),
    prova: restaurou
      ? { restaurou: true, resumo: RESUMO }
      : { restaurou: false, motivo: "truncada" },
  };
}

/** Uma cópia por hora, a partir de um instante, para trás. */
function horaria(quantas: number, desde = "2026-10-17T12:00:00.000Z"): CopiaGuardada[] {
  const inicio = new Date(desde).getTime();
  return Array.from({ length: quantas }, (_, hora) =>
    copia(new Date(inicio - hora * 3_600_000).toISOString()),
  );
}

describe("retenção avô-pai-filho", () => {
  it("🔑 até o limite, nada sai", () => {
    expect(copiasParaApagar(horaria(10))).toEqual([]);
  });

  it("🔑 das horárias ficam as 24 mais novas, e das mais velhas, uma por dia", () => {
    // 48 cópias de hora em hora: dois dias. As 24 últimas ficam como horárias;
    // do dia anterior, fica a mais nova daquele dia (a diária).
    const copias = horaria(48);
    const saem = copiasParaApagar(copias);

    // As horárias vão de 17T12 a 16T13; o dia 16 já está nelas (16T23), e o
    // dia 15 fica pela mais nova dele, 15T23.
    expect(saem).toHaveLength(48 - 24 - 1);
    expect(saem).not.toContain(copias[0]?.nome);
    expect(saem).not.toContain(copias[23]?.nome);
    expect(saem).not.toContain("erp-2026-10-15T23:00:00.000Z.dump");
    expect(saem).toContain("erp-2026-10-16T12:00:00.000Z.dump");
  });

  it("várias cópias na mesma hora: fica só a mais nova dela", () => {
    const copias = [
      copia("2026-10-17T12:50:00.000Z"),
      copia("2026-10-17T12:10:00.000Z"),
      copia("2026-10-17T11:30:00.000Z"),
    ];

    expect(
      copiasParaApagar(copias, { horarias: 24, diarias: 0, semanais: 0, mensais: 0 }),
    ).toEqual(["erp-2026-10-17T12:10:00.000Z.dump"]);
  });

  it("🔑 o mês passado sobrevive pela cópia mensal", () => {
    const copias = [
      copia("2026-10-17T12:00:00.000Z"),
      copia("2026-09-30T23:00:00.000Z"),
      copia("2026-09-15T10:00:00.000Z"),
      copia("2025-08-01T10:00:00.000Z"),
    ];

    const saem = copiasParaApagar(copias, {
      horarias: 1,
      diarias: 1,
      semanais: 1,
      mensais: 2,
    });

    expect(saem).toEqual([
      "erp-2026-09-15T10:00:00.000Z.dump",
      "erp-2025-08-01T10:00:00.000Z.dump",
    ]);
  });

  it("🔑 a cópia que não restaurou não toma o lugar da boa da mesma hora", () => {
    const copias = [
      copia("2026-10-17T12:50:00.000Z", false),
      copia("2026-10-17T12:10:00.000Z"),
    ];

    // A falha é a mais nova de todas: fica, para a tela mostrar que falhou.
    expect(
      copiasParaApagar(copias, { horarias: 1, diarias: 0, semanais: 0, mensais: 0 }),
    ).toEqual([]);
  });

  it("a falha mais velha que uma boa vai embora", () => {
    const copias = [
      copia("2026-10-17T13:00:00.000Z"),
      copia("2026-10-17T12:10:00.000Z", false),
    ];

    expect(copiasParaApagar(copias)).toEqual(["erp-2026-10-17T12:10:00.000Z.dump"]);
  });

  it("sem nenhuma cópia boa, as falhas ficam todas", () => {
    expect(copiasParaApagar([copia("2026-10-17T13:00:00.000Z", false)])).toEqual([]);
  });

  it("sem cópia nenhuma, nada sai", () => {
    expect(copiasParaApagar([])).toEqual([]);
  });

  it("🔑 a cópia de antes de restaurar não sai pela cópia feita logo depois, na mesma hora", () => {
    const copias = [
      copia("2026-10-17T13:20:00.000Z", true, "MANUAL"),
      copia("2026-10-17T13:10:00.000Z", true, "ANTES_DE_RESTAURAR"),
      copia("2026-10-17T13:00:00.000Z"),
    ];

    expect(copiasParaApagar(copias)).toEqual(["erp-2026-10-17T13:00:00.000Z.dump"]);
  });

  it("🔑 passada a semana, a de antes de restaurar segue a retenção comum", () => {
    const copias = [
      copia("2026-10-24T13:20:00.000Z"),
      copia("2026-10-17T13:30:00.000Z"),
      copia("2026-10-17T13:10:00.000Z", true, "ANTES_DE_RESTAURAR"),
    ];

    // Do dia 17 já fica a das 13h30, a mais nova dele: a de antes, com mais de
    // sete dias da cópia mais nova, sai.
    expect(copiasParaApagar(copias)).toEqual(["erp-2026-10-17T13:10:00.000Z.dump"]);
  });

  it("a política padrão é a da arquitetura: 24 · 7 · 4 · 12", () => {
    expect(RETENCAO_PADRAO).toEqual({
      horarias: 24,
      diarias: 7,
      semanais: 4,
      mensais: 12,
    });
  });
});

describe("semana ISO", () => {
  it.each([
    ["2026-10-17T12:00:00.000Z", "2026-W42"],
    // Domingo pertence à semana que começou na segunda anterior.
    ["2026-10-18T12:00:00.000Z", "2026-W42"],
    ["2026-10-19T12:00:00.000Z", "2026-W43"],
    // A semana da virada é do ano da quinta-feira.
    ["2027-01-01T12:00:00.000Z", "2026-W53"],
    ["2025-12-29T12:00:00.000Z", "2026-W01"],
  ])("%s está na semana %s", (instante, semana) => {
    expect(semanaIso(new Date(instante))).toBe(semana);
  });
});
