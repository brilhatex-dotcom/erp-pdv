import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";

import { Categoria } from "./Categoria.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-c00000000001").unwrap();

function criar(nome: string): Categoria {
  return Categoria.criar({ id: ID, nome }).unwrap();
}

describe("Categoria", () => {
  it("nasce ativa", () => {
    expect(criar("Bebidas").ativa).toBe(true);
  });

  it("remove espaço em volta do nome", () => {
    expect(criar("  Hortifruti  ").nome).toBe("Hortifruti");
  });

  it("🔑 guarda o nome normalizado — o balcão digita sem acento", () => {
    expect(criar("Padaria e Confeitaria").nomeBusca).toBe("padaria e confeitaria");
    expect(criar("Elétrica").nomeBusca).toBe("eletrica");
  });

  it("rejeita nome vazio", () => {
    const resultado = Categoria.criar({ id: ID, nome: "   " });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CATEGORIA_NOME_VAZIO");
    }
  });

  it("rejeita nome longo demais", () => {
    const resultado = Categoria.criar({ id: ID, nome: "x".repeat(41) });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CATEGORIA_NOME_LONGO");
      expect(resultado.error.detalhes?.["tamanho"]).toBe(41);
    }
  });

  it("aceita ser criada já inativa", () => {
    expect(Categoria.criar({ id: ID, nome: "Antiga", ativa: false }).unwrap().ativa).toBe(
      false,
    );
  });

  it("renomeia, atualizando também a forma de busca", () => {
    const categoria = criar("Bebidas");

    expect(categoria.renomear("Bebidas Geladas").isOk()).toBe(true);
    expect(categoria.nome).toBe("Bebidas Geladas");
    expect(categoria.nomeBusca).toBe("bebidas geladas");
  });

  it("recusa renomear para vazio", () => {
    const categoria = criar("Bebidas");
    const resultado = categoria.renomear("  ");

    expect(resultado.isErr()).toBe(true);
    expect(categoria.nome).toBe("Bebidas");
  });

  it("recusa renomear para nome longo demais", () => {
    const resultado = criar("Bebidas").renomear("x".repeat(41));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("CATEGORIA_NOME_LONGO");
    }
  });

  it("🔑 desativa sem apagar — relatório antigo continua fechando", () => {
    const categoria = criar("Bebidas");

    categoria.desativar();
    expect(categoria.ativa).toBe(false);

    categoria.ativar();
    expect(categoria.ativa).toBe(true);
  });

  it("reconstitui do banco sem revalidar", () => {
    // Nome acima do limite atual: regra nova não pode tornar ilegível cadastro
    // gravado sob a regra antiga.
    const categoria = Categoria.reconstituir({
      id: ID,
      nome: "x".repeat(60),
      ativa: false,
    });

    expect(categoria.nome).toHaveLength(60);
    expect(categoria.ativa).toBe(false);
  });
});
