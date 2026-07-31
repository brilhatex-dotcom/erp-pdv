import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    // Testes de integração conversam com o Postgres de verdade.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Uma conexão por arquivo evita disputa de transação entre suítes.
    fileParallelism: false,
    coverage: {
      exclude: ["src/**/*.{test,spec}.ts", "src/**/index.ts", "src/gerado/**"],
    },
  },
});
