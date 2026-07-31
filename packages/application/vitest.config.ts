import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    coverage: {
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/index.ts",
        // Módulos só de tipos: portas são interfaces, não emitem código.
        "src/portas/**",
        // Dublês são infraestrutura de teste, não código de produção.
        "src/testes/**",
      ],
    },
  },
});
