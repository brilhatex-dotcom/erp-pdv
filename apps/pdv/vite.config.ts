import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * O service worker é uma **segunda entrada** do build, e não um arquivo em
 * `public/`.
 *
 * Em `public/` ele seria copiado cru: sem TypeScript, sem lint e sem
 * compartilhar `estrategia.ts` com os testes — o que forçaria declarar as
 * regras de cache duas vezes, e regra duplicada diverge (veto do Dev Sênior,
 * CLAUDE.md §1).
 *
 * O nome dele **não leva hash**: o navegador procura exatamente `/sw.js`.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  define: {
    // Entra no nome do cache. Cache antigo servindo código novo é a origem de
    // "só funciona depois de limpar o navegador" — e no balcão ninguém limpa
    // navegador. O carimbo de build faz a limpeza acontecer sozinha.
    __VERSAO_DO_BUILD__: JSON.stringify(
      process.env["VERSAO_DO_BUILD"] ?? new Date().toISOString(),
    ),
  },
  server: {
    // Porta própria: em desenvolvimento o PDV e a retaguarda sobem juntos, e
    // colidir de porta faria um dos dois falhar sem explicação clara.
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/saude": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: { principal: "index.html", sw: "src/sw/sw.ts" },
      output: {
        entryFileNames: (bloco) =>
          bloco.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
