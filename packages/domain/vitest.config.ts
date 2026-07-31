import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    coverage: {
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/index.ts",
        // Módulos só de tipos: não emitem código executável, então cobertura
        // não se aplica. Apareceriam como 0% e distorceriam o total.
        "src/shared/ValueObject.ts",
        "src/shared/DomainEvent.ts",
      ],
    },
  },
});
