import base from "@erp/config/vitest";
import react from "@vitejs/plugin-react";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  plugins: [react()],
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // O contexto de sessão é React: precisa de DOM para ser exercitado como a
    // tela o usa, e não como uma função qualquer.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/testes/preparo.ts"],
    coverage: {
      // A base mede só `.ts`, e o contexto é `.tsx`.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/index.ts", "src/testes/**"],
    },
  },
});
