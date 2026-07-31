import { describe, expect, it } from "vitest";

import { Email } from "./Email.js";

describe("Email", () => {
  it("aceita endereço comum", () => {
    expect(Email.criar("contato@mercadinho.com.br").unwrap().valor).toBe(
      "contato@mercadinho.com.br",
    );
  });

  it("🔑 guarda em minúsculas — senão a mesma pessoa é cadastrada duas vezes", () => {
    const a = Email.criar("Contato@Mercadinho.com").unwrap();
    const b = Email.criar("contato@mercadinho.com").unwrap();

    expect(a.valor).toBe("contato@mercadinho.com");
    expect(a.equals(b)).toBe(true);
  });

  it("rejeita e-mail vazio", () => {
    const resultado = Email.criar("  ");

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMAIL_VAZIO");
    }
  });

  it("rejeita e-mail acima do limite do layout da NF-e", () => {
    const resultado = Email.criar(`${"x".repeat(55)}@loja.com`);

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMAIL_LONGO");
    }
  });

  it.each(["sem-arroba", "sem@dominio", "@loja.com", "espaco ruim@loja.com"])(
    "rejeita %s",
    (invalido) => {
      const resultado = Email.criar(invalido);

      expect(resultado.isErr()).toBe(true);
      if (resultado.isErr()) {
        expect(resultado.error.codigo).toBe("EMAIL_INVALIDO");
      }
    },
  );

  it("distingue endereços diferentes", () => {
    const a = Email.criar("a@loja.com").unwrap();
    const b = Email.criar("b@loja.com").unwrap();

    expect(a.equals(b)).toBe(false);
  });

  it("serializa como texto simples", () => {
    const email = Email.criar("contato@loja.com").unwrap();

    expect(email.toString()).toBe("contato@loja.com");
    expect(JSON.stringify(email)).toBe('"contato@loja.com"');
  });
});
