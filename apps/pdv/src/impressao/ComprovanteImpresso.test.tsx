import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Comprovante } from "../api/tipos.js";
import { ComprovanteImpresso } from "./ComprovanteImpresso.js";

/**
 * O comprovante da impressão do navegador — o mesmo texto do cupom térmico,
 * na largura do papel, e só na impressão.
 */

const BASE: Comprovante = {
  aviso: "NÃO É DOCUMENTO FISCAL",
  treinamento: false,
  larguraCupom: 58,
  operadorNome: "Maria",
  emitidoEm: "2026-10-17T12:06:00.000Z",
  venda: {
    id: "v",
    numero: 41,
    status: "FINALIZADA",
    estacaoId: "e",
    operadorId: "o",
    abertaEm: "2026-10-17T12:00:00.000Z",
    subtotal: "2000",
    descontoItens: "100",
    descontoVenda: "0",
    descontoTotal: "100",
    total: "1900",
    totalPago: "1900",
    faltaPagar: "0",
    troco: "0",
    itens: [
      {
        numero: 1,
        produtoId: "p",
        descricao: "QUEIJO",
        quantidade: { milesimos: "350", unidade: "KG" },
        precoUnitario: "2000",
        totalBruto: "700",
        desconto: "100",
        descontoRateado: "0",
        total: "600",
      },
    ],
    pagamentos: [
      {
        indice: 0,
        forma: "PIX",
        descricao: "Pix",
        valor: "1900",
        parcelas: 1,
        confirmacao: "MANUAL",
      },
    ],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ComprovanteImpresso", () => {
  it("🔑 papel de 58 mm, com desconto e cliente, sem loja cadastrada", async () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const aoTerminar = vi.fn();

    render(
      <ComprovanteImpresso
        comprovante={{ ...BASE, clienteNome: "José da Silva" }}
        segundaVia={false}
        aoTerminar={aoTerminar}
      />,
    );

    const papel = screen.getByRole("region", { name: "Comprovante para impressão" });
    expect(papel.style.width).toBe("56mm");
    expect(papel).toHaveTextContent("COMPROVANTE DE VENDA");
    expect(papel).toHaveTextContent("Cliente: José da Silva");
    expect(papel).toHaveTextContent("SubtotalR$ 20,00");
    expect(papel).toHaveTextContent("Desconto-R$ 1,00");
    expect(papel).toHaveTextContent("0,35 kg × R$ 20,00");
    expect(papel).toHaveTextContent("Pix (conferido pelo operador)");
    expect(papel).not.toHaveTextContent("TROCO");
    expect(papel.querySelector("img")).toBeNull();

    await waitFor(() => {
      expect(aoTerminar).toHaveBeenCalledTimes(1);
    });
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  it("loja sem telefone, treinamento e segunda via vão no alto", () => {
    vi.spyOn(window, "print").mockImplementation(() => undefined);

    render(
      <ComprovanteImpresso
        comprovante={{
          ...BASE,
          treinamento: true,
          loja: {
            nome: "Mercadinho",
            razaoSocial: "M Ltda",
            cnpj: "12.345.678/0001-95",
            endereco: "Rua 1",
          },
          venda: {
            ...BASE.venda,
            descontoTotal: "0",
            finalizadaEm: "2026-10-17T12:05:00.000Z",
          },
        }}
        segundaVia
        aoTerminar={vi.fn()}
      />,
    );

    const papel = screen.getByRole("region", { name: "Comprovante para impressão" });
    expect(papel).toHaveTextContent("*** TREINAMENTO - SEM VALOR ***");
    expect(papel).toHaveTextContent("*** SEGUNDA VIA ***");
    expect(papel).toHaveTextContent("CNPJ 12.345.678/0001-95");
    expect(papel).not.toHaveTextContent("Subtotal");
  });

  it("desmontado antes de imprimir, não imprime", () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);

    const { unmount } = render(
      <ComprovanteImpresso comprovante={BASE} segundaVia={false} aoTerminar={vi.fn()} />,
    );
    unmount();

    expect(imprimir).not.toHaveBeenCalled();
  });
});
