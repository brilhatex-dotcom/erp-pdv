import { criarPrismaClient } from "@erp/database";
import { gerarEtiquetaBalanca, LAYOUT_BALANCA_PADRAO } from "@erp/domain";
import { expect, type Page, test } from "@playwright/test";

import { URL_BANCO } from "../scripts/bancos.js";
import { LOJA } from "../scripts/loja.js";
import {
  abrirOCaixa,
  bipar,
  campoDeCodigo,
  digitarDinheiro,
  entrar,
  receber,
  receberEmDinheiro,
  totalDaVenda,
  vendaConcluida,
} from "./balcao.js";

/**
 * Um dia de caixa, do PIN ao fechamento, no navegador de verdade.
 *
 * Os três exemplos de conferência do pedido do produto, nesta ordem, na
 * mesma gaveta — e no fim ela tem de bater com o que entrou:
 *
 * | Venda | Pago | Gaveta |
 * |---|---|---|
 * | Fundo de troco | — | R$ 100,00 |
 * | Contrafilé, etiqueta de 350 g × R$ 20,00/kg = R$ 7,00 | R$ 7,00 em dinheiro | + R$ 7,00 |
 * | Bolo, R$ 12,50 | R$ 20,00 em dinheiro, troco R$ 7,50 | + R$ 12,50 |
 * | Cesta, R$ 50,00 | R$ 20,00 em dinheiro + R$ 30,00 no Pix | + R$ 20,00 |
 * | Contrafilé, 1.500 g digitados = R$ 30,00 | R$ 30,00 em dinheiro | + R$ 30,00 |
 * | **Esperado na gaveta** | | **R$ 169,50** |
 */

test.describe.configure({ mode: "serial" });

let page: Page;
const [OPERADORA] = LOJA.pessoas;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("entrar com matrícula e PIN, e abrir o caixa com R$ 100,00", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Caixa" })).toBeVisible();

  await entrar(page, OPERADORA.matricula, OPERADORA.pin);
  await abrirOCaixa(page, "10000");

  await expect(page.getByText(OPERADORA.nome)).toBeVisible();
  // Na loja de verdade, nada de faixa de treino.
  await expect(page.getByRole("note")).toHaveCount(0);
});

test("🔑 exemplo 1: etiqueta da balança com 350 g de R$ 20,00/kg dá R$ 7,00", async () => {
  const etiqueta = gerarEtiquetaBalanca(LAYOUT_BALANCA_PADRAO, "000123", 350n).unwrap();

  await bipar(page, etiqueta);
  await totalDaVenda(page, "R$ 7,00");

  await receber(page);
  await receberEmDinheiro(page, "700");

  await expect(await vendaConcluida(page)).toContainText("Sem troco");
});

test("🔑 exemplo 2: R$ 12,50 pagos com R$ 20,00 — troco de R$ 7,50", async () => {
  await bipar(page, "7890000001014");
  await totalDaVenda(page, "R$ 12,50");

  await receber(page);
  await receberEmDinheiro(page, "2000");

  const concluida = await vendaConcluida(page);
  await expect(concluida.getByLabel("Troco a devolver")).toHaveText(/R\$\s*7,50/);
});

test("🔑 exemplo 3: R$ 50,00 = R$ 20,00 em dinheiro + R$ 30,00 no Pix — saldo zero, sem troco", async () => {
  await bipar(page, "7890000001021");
  await totalDaVenda(page, "R$ 50,00");

  const pagamento = await receber(page);
  await receberEmDinheiro(page, "2000");
  await expect(pagamento.getByLabel("Falta receber")).toHaveText(/R\$\s*30,00/);

  await page.keyboard.press("2");
  await expect(
    pagamento.getByText(/Confira no aplicativo do banco que o Pix caiu/),
  ).toBeVisible();
  await expect(page.getByLabel("Valor no pix")).toHaveValue(/30,00/);
  await page.keyboard.press("Enter");

  await expect(await vendaConcluida(page)).toContainText("Sem troco");
});

test("🔑 peso digitado em gramas: 1.500 g de R$ 20,00/kg são R$ 30,00", async () => {
  await bipar(page, "CONTRAFILE");

  const peso = page.getByRole("dialog", { name: "Peso de Contrafilé" });
  await expect(peso).toBeVisible();
  await peso.getByLabel("Peso em gramas").pressSequentially("1500");
  await page.keyboard.press("Enter");
  await totalDaVenda(page, "R$ 30,00");

  await receber(page);
  await receberEmDinheiro(page, "3000");
  await expect(await vendaConcluida(page)).toContainText("Sem troco");
});

test("🔑 fechamento às cegas: a gaveta com R$ 169,50 bate", async () => {
  await page.getByRole("button", { name: /Caixa: sangria/ }).click();
  await expect(page.getByRole("dialog", { name: "Caixa" })).toBeVisible();
  await page.keyboard.press("6");

  const contado = page.getByLabel("Total contado na gaveta");
  await expect(contado).toBeVisible();
  await digitarDinheiro(contado, "16950");
  await contado.press("Enter");

  await expect(page.getByRole("heading", { name: "Caixa fechado" })).toBeVisible();
  await expect(page.getByLabel("Diferença apurada")).toContainText("A gaveta bateu");
});

test("🔑 o que a tela vendeu está no banco: 4 vendas e 1,850 kg de contrafilé a menos", async () => {
  const prisma = criarPrismaClient({ urlBanco: URL_BANCO });

  try {
    expect(await prisma.venda.count({ where: { status: "FINALIZADA" } })).toBe(4);

    const contrafile = await prisma.saldoEstoque.findFirst({
      where: { produto: { sku: "CONTRAFILE" } },
    });
    // 100 kg − 0,350 kg − 1,500 kg
    expect(contrafile?.milesimos).toBe(98_150n);
  } finally {
    await prisma.$disconnect();
  }

  // E o campo de código não aparece mais: o caixa desta estação fechou.
  await expect(campoDeCodigo(page)).toHaveCount(0);
});
