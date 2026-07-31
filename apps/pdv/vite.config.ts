import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    // Porta própria: em desenvolvimento o PDV e a retaguarda sobem juntos, e
    // colidir de porta faria um dos dois falhar sem explicação clara.
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/saude": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
