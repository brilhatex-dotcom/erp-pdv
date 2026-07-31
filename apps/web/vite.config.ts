import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    // A API roda em outra porta em desenvolvimento. O proxy mantém tudo na
    // mesma origem, o que faz o cookie `SameSite=Strict` do refresh funcionar
    // sem afrouxar nada — em produção os dois são servidos juntos.
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/saude": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
