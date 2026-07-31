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
        // Composição do Electron: monta a janela, lê o arquivo de configuração
        // e liga os canais. Não roda fora do Electron, e um teste que o
        // simulasse mediria o simulador. A lógica que valia testar saiu daqui
        // para `configuracao.ts` e `ponte-ipc.ts`, ambos cobertos.
        "src/principal/main.ts",
        "src/ponte/preload.ts",
        "src/testes/**",
      ],
    },
  },
});
