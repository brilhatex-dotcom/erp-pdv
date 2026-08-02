import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // A retaguarda é servida sob `/retaguarda/`, e o PDV na raiz (ADR-0023).
  //
  // Sem isto, o `index.html` referencia `/assets/…` em caminho **absoluto**: o
  // navegador busca na raiz, onde mora o PDV, recebe 404 e mostra **tela em
  // branco** — com o HTML tendo respondido 200. É o defeito que sobreviveu ao
  // ensaio inteiro justamente porque conferir o status do documento não prova
  // que a página monta.
  base: "/retaguarda/",
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
