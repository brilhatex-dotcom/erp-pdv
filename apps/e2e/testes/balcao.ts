import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Os gestos do operador, como ele os faz: digitar e apertar Enter.
 *
 * Por teclado de propósito — o balcão é operado sem mouse (CLAUDE.md §8, papel
 * UX), e um teste que clicasse onde o operador tecla provaria outra coisa.
 */

export async function entrar(page: Page, matricula: string, pin: string): Promise<void> {
  await page.getByLabel(/Matrícula/).pressSequentially(matricula);
  await page.getByLabel(/PIN/).pressSequentially(pin);
  await page.keyboard.press("Enter");
}

/** Dinheiro como na maquininha: os dígitos entram pela direita. */
export async function digitarDinheiro(campo: Locator, centavos: string): Promise<void> {
  await campo.press("Control+a");
  await campo.press("Backspace");
  await campo.pressSequentially(centavos);
}

export async function abrirOCaixa(page: Page, fundoEmCentavos: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Abrir o caixa" })).toBeVisible();
  await digitarDinheiro(page.getByLabel(/Fundo de troco/), fundoEmCentavos);
  await page.keyboard.press("Enter");

  // A orientação da primeira vez aparece uma vez por estação.
  const orientacao = page.getByRole("dialog", { name: "Bem-vindo ao caixa" });
  await expect(orientacao).toBeVisible();
  await orientacao.getByRole("button", { name: "Entendi" }).click();
  await expect(campoDeCodigo(page)).toBeFocused();
}

export function campoDeCodigo(page: Page): Locator {
  return page.getByLabel(/Código do produto/);
}

/** Bipa como o leitor: os dígitos e o Enter. */
export async function bipar(page: Page, codigo: string): Promise<void> {
  await campoDeCodigo(page).pressSequentially(codigo);
  await campoDeCodigo(page).press("Enter");
}

export async function totalDaVenda(page: Page, valor: string): Promise<void> {
  await expect(page.getByLabel("Total da venda")).toContainText(valor);
}

/** Enter no campo vazio: a tela de pagamento, com o foco nas formas. */
export async function receber(page: Page): Promise<Locator> {
  await campoDeCodigo(page).press("Enter");
  const pagamento = page.getByRole("region", { name: "Pagamento" });
  await expect(pagamento).toBeVisible();

  return pagamento;
}

/** Tecla 1, o valor que o cliente deu e Enter. */
export async function receberEmDinheiro(page: Page, centavos: string): Promise<void> {
  await page.keyboard.press("1");
  const campo = page.getByLabel("Valor recebido");
  await expect(campo).toBeVisible();
  await digitarDinheiro(campo, centavos);
  await campo.press("Enter");
}

export async function vendaConcluida(page: Page): Promise<Locator> {
  const concluida = page.getByRole("region", { name: "Venda concluída" });
  await expect(concluida).toBeVisible();

  return concluida;
}
