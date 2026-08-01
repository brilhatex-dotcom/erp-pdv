import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      // `main.ts` fica de fora: é a única parte que fala com o Electron, e
      // exercitá-la exigiria subir o Electron de verdade no CI. O que ela faz é
      // consumir `janela.ts`, que é medido — e o ADR-0023 proíbe que ela ganhe
      // qualquer decisão própria, justamente para que isso baste.
      exclude: ["src/**/*.test.ts", "src/main.ts"],
    },
  },
});
