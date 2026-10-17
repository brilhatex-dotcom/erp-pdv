import base from "@erp/config/vitest";
import react from "@vitejs/plugin-react";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  plugins: [react()],
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    // A tela inteira da retaguarda montada no jsdom: cada consulta por papel
    // com nome custa de 50 a 130 ms num núcleo, e o runner do CI, com as
    // outras suítes rodando ao lado, é umas quatro vezes mais lento que a
    // máquina de desenvolvimento. Com os 5 s de fábrica, o teste da
    // configuração da loja passava em 1,2 s aqui e estourava lá. O limite é
    // guarda contra travamento, não meta de desempenho — teste que chegar
    // perto dele deve ficar mais leve, e não ganhar mais tempo.
    testTimeout: 15_000,
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
        "src/testes/**",
      ],
    },
  },
});
