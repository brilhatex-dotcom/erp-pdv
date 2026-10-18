import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { URL_BANCO, URL_BANCO_TREINO } from "./scripts/bancos.js";

/**
 * O teste no navegador: o servidor de verdade, construído, entregando a PWA do
 * PDV construída, com o PostgreSQL de verdade — e o Chromium apertando as
 * teclas que o operador aperta.
 *
 * Exige o build do servidor e do PDV (`pnpm e2e`, na raiz, faz os dois).
 */

const PORTA = 3999;
const ENDERECO = `http://127.0.0.1:${String(PORTA)}`;

export default defineConfig({
  testDir: "testes",
  globalSetup: "./scripts/preparo.ts",
  // Um caixa, uma estação, um banco: os testes contam o dia em sequência.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: ENDERECO,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // A tela do balcão é desenhada para monitor de caixa, não para celular.
    viewport: { width: 1366, height: 768 },
    // Tudo é local. Sem isto, o navegador mandaria a origem de rede (o IP desta
    // máquina) pelo proxy do ambiente, e o teste do 2º caixa falharia por isso.
    launchOptions: { args: ["--no-proxy-server"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ../server/dist/index.js",
    // `/saude` não toca no banco: o servidor sobe antes de o preparo recriá-lo.
    url: `${ENDERECO}/saude`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "test",
      PORTA: String(PORTA),
      // Em todas as interfaces, como a loja: o teste do 2º computador entra
      // pelo IP da máquina, e não por `localhost`.
      ENDERECO: "0.0.0.0",
      DATABASE_URL: URL_BANCO,
      DATABASE_URL_TREINAMENTO: URL_BANCO_TREINO,
      SEGREDO_TOKEN: "segredo-do-teste-no-navegador-com-mais-de-32",
      PASTA_PDV: fileURLToPath(new URL("../pdv/dist", import.meta.url)),
      PASTA_RETAGUARDA: "",
      LIMITE_LOGIN_MINUTO: "100",
    },
  },
});
