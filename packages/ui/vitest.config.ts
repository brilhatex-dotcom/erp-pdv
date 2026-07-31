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
      // A base mede só `.ts`, e componente é `.tsx`. Sem isto o design system
      // inteiro ficava fora do portão.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/index.ts", "src/testes/**"],
    },
  },
});
