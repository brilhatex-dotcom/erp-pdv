import { criarPrismaClient } from "@erp/database";
import { expect, test } from "@playwright/test";

import { URL_BANCO, URL_BANCO_TREINO } from "../scripts/bancos.js";
import {
  abrirOCaixa,
  bipar,
  entrar,
  receber,
  totalDaVenda,
  vendaConcluida,
} from "./balcao.js";

/**
 * O treino no navegador (ADR-0026): da entrada da loja ao treino, uma venda
 * com Pix simulado, e de volta — sem que nada chegue ao banco da loja.
 */

async function vendasNoBanco(url: string): Promise<number> {
  const prisma = criarPrismaClient({ urlBanco: url });

  try {
    return await prisma.venda.count();
  } finally {
    await prisma.$disconnect();
  }
}

test("🔑 treinar uma venda inteira não deixa rastro na loja", async ({ page }) => {
  const daLojaAntes = await vendasNoBanco(URL_BANCO);

  await page.goto("/");
  await page.getByRole("button", { name: "Treinar, sem valer de verdade" }).click();

  await expect(page.getByRole("heading", { name: "Treinamento" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("MODO TREINAMENTO");
  const pessoas = page.getByRole("region", { name: "Pessoas de treino" });
  await expect(pessoas.getByText("121212")).toBeVisible();

  await entrar(page, "901", "121212");
  await expect(page.getByRole("note")).toContainText("MODO TREINAMENTO");
  await abrirOCaixa(page, "0");

  await bipar(page, "7890000000017");
  await totalDaVenda(page, "R$ 9,90");
  await receber(page);
  // Pix: no treino, sai simulado — ninguém precisa conferir banco nenhum.
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await expect(await vendaConcluida(page)).toContainText("Sem troco");

  expect(await vendasNoBanco(URL_BANCO_TREINO)).toBe(1);
  expect(await vendasNoBanco(URL_BANCO)).toBe(daLojaAntes);

  // Sair do treino pelo menu do caixa: de volta à entrada da loja.
  await page.getByRole("button", { name: /Caixa: sangria/ }).click();
  await expect(page.getByRole("dialog", { name: "Caixa" })).toBeVisible();
  await page.keyboard.press("9");

  await expect(page.getByRole("heading", { name: "Caixa" })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
});
