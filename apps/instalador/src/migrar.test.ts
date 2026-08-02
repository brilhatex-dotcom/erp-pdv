import { describe, expect, it } from "vitest";

import { acharSchema, ambienteDoPrisma, argumentosDaMigracao } from "./migrar.js";

/**
 * Onde o migrador procura o schema.
 *
 * Dentro da instalação ele viaja ao lado do servidor; em desenvolvimento, mora
 * no pacote de persistência. Errar aqui significa um instalador que copia tudo
 * e não acha nada — e falha depois de já ter mexido na máquina do cliente.
 */

describe("localização do schema", () => {
  it("devolve o primeiro que existe", () => {
    const achado = acharSchema(
      [
        "/instalacao/prisma/schema.prisma",
        "/repo/packages/database/prisma/schema.prisma",
      ],
      (caminho) => caminho.startsWith("/instalacao"),
    );

    expect(achado).toBe("/instalacao/prisma/schema.prisma");
  });

  it("cai no segundo quando o primeiro não existe", () => {
    const achado = acharSchema(
      [
        "/instalacao/prisma/schema.prisma",
        "/repo/packages/database/prisma/schema.prisma",
      ],
      (caminho) => caminho.startsWith("/repo"),
    );

    expect(achado).toContain("/repo");
  });

  it("🔑 quando não acha, diz onde procurou", () => {
    // "Schema não encontrado" sem a lista manda o suporte adivinhar, e o
    // técnico está na loja do cliente com o instalador travado.
    expect(() =>
      acharSchema(["/a/schema.prisma", "/b/schema.prisma"], () => false),
    ).toThrow(/\/a\/schema\.prisma[\s\S]*\/b\/schema\.prisma/);
  });
});

describe("comando de migração", () => {
  it("🔑 usa `deploy`, nunca `dev`", () => {
    // `migrate dev` é interativo e pode reconstruir o banco. Rodá-lo numa loja
    // apagaria as vendas.
    const argumentos = argumentosDaMigracao("/cli/index.js", "/s/schema.prisma");

    expect(argumentos).toContain("deploy");
    expect(argumentos).not.toContain("dev");
  });

  it("chama o CLI pelo arquivo, para não depender de npx nem de internet", () => {
    expect(argumentosDaMigracao("/cli/index.js", "/s/schema.prisma")[0]).toBe(
      "/cli/index.js",
    );
  });

  it("aponta o schema explicitamente", () => {
    const argumentos = argumentosDaMigracao("/cli/index.js", "/s/schema.prisma");

    expect(argumentos.slice(-2)).toEqual(["--schema", "/s/schema.prisma"]);
  });
});

describe("motor de schema do Prisma", () => {
  it("🔑 aponta o motor embarcado quando ele existe", () => {
    // Sem isto o CLI baixaria o motor na hora da instalação — e a loja pode
    // não ter internet no dia.
    const ambiente = ambienteDoPrisma({}, "/inst/engines/schema-engine.exe", () => true);

    expect(ambiente["PRISMA_SCHEMA_ENGINE_BINARY"]).toBe(
      "/inst/engines/schema-engine.exe",
    );
  });

  it("não aponta um motor ausente", () => {
    // Em desenvolvimento o motor vem do `node_modules`. Apontar um caminho que
    // não existe trocaria "funciona" por "engine not found".
    const ambiente = ambienteDoPrisma({ PATH: "/bin" }, "/nao/existe", () => false);

    expect(ambiente).toEqual({ PATH: "/bin" });
  });

  it("preserva o resto do ambiente", () => {
    const ambiente = ambienteDoPrisma(
      { DATABASE_URL: "postgresql://x" },
      "/m",
      () => true,
    );

    expect(ambiente["DATABASE_URL"]).toBe("postgresql://x");
  });
});
