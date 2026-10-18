import { expect, type Page, test } from "@playwright/test";

import { enderecoNaRede } from "../scripts/rede.js";
import { campoDeCodigo, entrar } from "./balcao.js";

/**
 * O segundo computador da loja (ADR-0028).
 *
 * O servidor fala HTTP puro na rede local. Só o computador dele abre o sistema
 * por `localhost`, que o navegador trata como contexto seguro; o segundo caixa
 * abre por `http://NOME-DO-SERVIDOR:3000` — origem **insegura**, onde
 * `crypto.randomUUID` não existe e o cookie `Secure` é descartado. Os dois
 * defeitos só apareciam ali: o login estourava com "sem conexão" e, depois de
 * corrigido, a sessão caía a cada renovação.
 *
 * A origem aqui é o IP desta máquina, a mesma que um segundo computador usaria.
 */

const IP = enderecoNaRede();

test.skip(IP === undefined, "sem interface de rede além do loopback");
test.use({ baseURL: `http://${IP ?? "127.0.0.1"}:3999` });

const [OPERADORA] = [{ matricula: "42", pin: "482913" }];

/** Logado: o caixa abre (se já está aberto) ou pede a abertura (se o dia fechou). */
async function estaLogada(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Abrir o caixa" }).or(campoDeCodigo(page)),
  ).toBeVisible();
  await expect(page.getByLabel(/Matrícula/)).toHaveCount(0);
}

test("🔑 o 2º caixa entra, o F5 mantém a sessão e a renovação funciona", async ({
  page,
}) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);

  await entrar(page, OPERADORA.matricula, OPERADORA.pin);
  await estaLogada(page);

  // O F5 restaura a sessão pelo cookie de renovação: sem ele, volta ao login.
  await page.reload();
  await estaLogada(page);

  const renovacao = await page.evaluate(
    async () =>
      (await fetch("/api/acesso/renovar", { method: "POST", credentials: "include" }))
        .status,
  );
  expect(renovacao).toBe(200);
});

test("o 2º caixa não depende do service worker: a tela funciona sem ele", async ({
  page,
}) => {
  await page.goto("/");

  // Sem contexto seguro não há service worker — e a tela de entrada abre.
  expect(await page.evaluate(() => "serviceWorker" in navigator)).toBe(false);
  await expect(page.getByLabel(/Matrícula/)).toBeVisible();
});
