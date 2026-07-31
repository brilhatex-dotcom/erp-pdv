import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    coverage: {
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/index.ts",
        // Dublês são infraestrutura de teste, não código de produção.
        "src/testes/**",
        // `main.ts` é só a sequência de inicialização: cada peça que ele junta
        // tem teste próprio, e cobri-lo exigiria subir processo e abrir porta
        // TCP para não verificar nada de novo.
        "src/main.ts",
      ],
    },
  },
});
