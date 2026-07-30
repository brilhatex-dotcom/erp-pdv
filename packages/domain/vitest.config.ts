import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    coverage: {
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/index.ts",
        // Módulo só de tipos: não emite código executável, então cobertura não
        // se aplica. Aparece como 0% e distorceria o total.
        "src/shared/ValueObject.ts",
      ],
    },
  },
});
