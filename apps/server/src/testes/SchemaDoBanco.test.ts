import { describe, expect, it } from "vitest";

import { acharSchema } from "../http/schemaDoBanco.js";

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
