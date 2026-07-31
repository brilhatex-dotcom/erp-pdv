import { describe, expect, it } from "vitest";

import { RelogioFixo } from "../../testes/dubles.js";
import { GeradorUuidV7 } from "./GeradorUuidV7.js";
import { RelogioSistema } from "./RelogioSistema.js";

describe("RelogioSistema", () => {
  it("devolve a hora atual", () => {
    const antes = Date.now();
    const agora = new RelogioSistema().agora();

    expect(agora.getTime()).toBeGreaterThanOrEqual(antes);
    expect(agora.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("GeradorUuidV7", () => {
  it("gera identificador na versão 7", () => {
    const id = new GeradorUuidV7(new RelogioSistema()).proximo();

    expect(id.versao).toBe(7);
  });

  it("embute o instante do relógio, não o do sistema", () => {
    // É isso que faz ordenar por id e ordenar por data darem o mesmo resultado.
    // Com `Date.now()` embutido à força, um relógio de teste parado no passado
    // produziria id do presente, e o diagnóstico remoto passaria a mentir.
    const instante = new Date("2026-07-31T14:05:09.000Z");

    const id = new GeradorUuidV7(new RelogioFixo(instante)).proximo();

    expect(id.criadoEmMilissegundos).toBe(instante.getTime());
  });

  it("não repete identificador dentro do mesmo milissegundo", () => {
    // Duas bipadas na mesma venda caem no mesmo milissegundo com facilidade; id
    // repetido ali seria item de venda sobrescrevendo outro.
    const gerador = new GeradorUuidV7(new RelogioFixo(new Date("2026-07-31T14:05:09Z")));

    const gerados = new Set(Array.from({ length: 1_000 }, () => gerador.proximo().valor));

    expect(gerados.size).toBe(1_000);
  });

  it("gera identificadores ordenáveis conforme o tempo avança", () => {
    const relogio = new RelogioFixo(new Date("2026-07-31T14:05:09.000Z"));
    const gerador = new GeradorUuidV7(relogio);

    const primeiro = gerador.proximo().valor;
    relogio.avancar(1);
    const segundo = gerador.proximo().valor;

    expect(primeiro < segundo).toBe(true);
  });
});
