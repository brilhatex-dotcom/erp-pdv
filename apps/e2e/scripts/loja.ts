import type { CodigoPapelPadrao } from "@erp/domain";

/**
 * A loja do teste no navegador: quem entra e o que se vende.
 *
 * Os preços são os dos exemplos de conferência do pedido do produto: o
 * contrafilé de R$ 20,00/kg (350 g dão R$ 7,00), o bolo de R$ 12,50 (pago com
 * R$ 20,00, troco de R$ 7,50) e a cesta de R$ 50,00 (R$ 20,00 em dinheiro e
 * R$ 30,00 no Pix).
 */
export const LOJA = {
  pessoas: [
    {
      matricula: "42",
      pin: "482913",
      nome: "Maria do Caixa",
      papel: "OPERADOR_CAIXA" satisfies CodigoPapelPadrao,
    },
    {
      matricula: "7",
      pin: "860412",
      nome: "João Supervisor",
      papel: "SUPERVISOR" satisfies CodigoPapelPadrao,
    },
  ],
  produtos: [
    {
      sku: "CONTRAFILE",
      descricao: "Contrafilé",
      preco: "20,00",
      codigoBarras: undefined,
      codigoBalanca: "000123",
    },
    {
      sku: "BOLO",
      descricao: "Bolo de fubá",
      preco: "12,50",
      codigoBarras: "7890000001014",
      codigoBalanca: undefined,
    },
    {
      sku: "CESTA",
      descricao: "Cesta de café",
      preco: "50,00",
      codigoBarras: "7890000001021",
      codigoBalanca: undefined,
    },
  ],
} as const;
