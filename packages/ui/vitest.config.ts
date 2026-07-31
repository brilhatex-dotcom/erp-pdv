import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    // A config base só procura `.ts`; componente é `.tsx`.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Componente precisa de DOM: os testes verificam o que o operador vê e o
    // que ele alcança pelo teclado, não a árvore de elementos.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/testes/preparo.ts"],
    coverage: {
      exclude: ["src/**/*.test.tsx", "src/index.ts", "src/testes/**"],
    },
  },
});
