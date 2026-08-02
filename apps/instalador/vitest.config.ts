import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      // `index.ts` é a linha de comando: lê argumentos e chama o resto. O que
      // decide está nos módulos, todos medidos.
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
  },
});
