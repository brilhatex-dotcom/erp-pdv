import { defineConfig } from "vitest/config";

/**
 * Base de testes do ERP/PDV.
 *
 * Os limiares de cobertura são os portões do CLAUDE.md §7. Pacotes com
 * exigência maior (o motor tributário exige 100%) sobrescrevem estes valores
 * na sua própria configuração.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.{test,spec}.ts", "src/**/index.ts"],
      thresholds: {
        // Por arquivo, não pela média. A média deixa um módulo mal coberto
        // passar escondido atrás dos bem cobertos — foi exatamente o que
        // aconteceu com Embalagem e ReferenciaProduto na Etapa 2b.
        perFile: true,
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
