import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    // As rotas conversam com o Postgres de verdade, pela mesma razão do
    // pacote de persistência: é onde as garantias reais moram.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    coverage: {
      exclude: ["src/**/*.{test,spec}.ts", "src/index.ts"],
    },
  },
});
