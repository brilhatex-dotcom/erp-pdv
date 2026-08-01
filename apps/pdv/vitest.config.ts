import base from "@erp/config/vitest";
import react from "@vitejs/plugin-react";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  plugins: [react()],
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/testes/preparo.ts"],
    coverage: {
      // A base mede só `.ts`, e as telas são `.tsx`: sem esta linha o portão
      // reportava 100% medindo apenas o cliente HTTP, com tela nenhuma dentro.
      // Cobertura que não enxerga o arquivo não é cobertura alta — é ausência
      // de medição, e ela se parece exatamente com sucesso no relatório.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        // Ponto de entrada: monta o React na página e não decide nada.
        "src/main.tsx",
        // Casca do service worker: registra três ouvintes e repassa para
        // `estrategia.ts` e `cache.ts`, que são medidos. Não roda em suíte —
        // service worker precisa de contexto de worker —, e um teste que o
        // simulasse mediria o simulador. **Se um `if` aparecer nele, a
        // exclusão deixa de valer e a decisão tem de descer para os módulos.**
        "src/sw/sw.ts",
        "src/testes/**",
      ],
    },
  },
});
