import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LAYOUT_BALANCA_PADRAO } from "@erp/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FilaDeVendas } from "../armazenamento-local/filaDeVendas.js";
import {
  type ProdutoReplicado,
  ReplicaCatalogo,
} from "../armazenamento-local/replicaCatalogo.js";
import { VendaLocal } from "./vendaLocal.js";

/**
 * A venda offline é a única cópia do que aconteceu no balcão. Um erro aqui não
 * aparece como tela quebrada — aparece como venda que sumiu, ou como troco
 * errado entregue a um cliente que já foi embora.
 */

const CAFE: ProdutoReplicado = {
  id: "1",
  sku: "CAFE500",
  descricao: "Café torrado e moído 500 g",
  descricaoPdv: "CAFE 500G",
  unidade: "UN",
  precoVenda: "1990",
  codigoBarras: "7891000100103",
  ativo: true,
};

const PICANHA: ProdutoReplicado = {
  id: "2",
  sku: "PICANHA",
  descricao: "Picanha bovina",
  descricaoPdv: "PICANHA KG",
  unidade: "KG",
  precoVenda: "8990",
  codigoBalanca: "000123",
  ativo: true,
};

let pasta: string;
let fila: FilaDeVendas;
let replica: ReplicaCatalogo;
let sequencia: number;

function montar(): VendaLocal {
  return new VendaLocal({
    replica,
    fila,
    layoutBalanca: LAYOUT_BALANCA_PADRAO,
    novoId: () => `venda-${String(++sequencia)}`,
    agora: () => new Date("2026-08-01T12:00:00.000Z"),
  });
}

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "venda-local-"));
  fila = new FilaDeVendas(join(pasta, "fila.jsonl"));
  replica = new ReplicaCatalogo();
  sequencia = 0;

  replica.substituir({
    atualizadoEm: "2026-08-01T00:00:00.000Z",
    produtos: [CAFE, PICANHA],
  });
});

afterEach(() => {
  rmSync(pasta, { recursive: true, force: true });
});

describe("venda offline", () => {
  it("soma o total conforme os itens entram", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    venda.adicionarItem("7891000100103");
    const segundo = venda.adicionarItem("7891000100103");

    expect(segundo.tipo).toBe("OK");
    if (segundo.tipo !== "OK") return;

    expect(segundo.venda.total).toBe("3980");
    expect(segundo.venda.faltaPagar).toBe("3980");
    expect(segundo.venda.itens).toHaveLength(2);
  });

  it("não tem número de venda", () => {
    // Numerar é do servidor. Duas estações offline escolhendo sozinhas
    // produziriam duas vendas com o mesmo número no relatório do dia.
    const venda = montar();
    const aberta = venda.iniciar("estacao-1", "operador-1");

    expect(aberta).not.toHaveProperty("numero");
    expect(aberta.offline).toBe(true);
  });

  it("recusa produto que não está no catálogo local", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    const resultado = venda.adicionarItem("0000000000000");

    expect(resultado.tipo).toBe("ERRO");
    if (resultado.tipo !== "ERRO") return;

    // A mensagem é para o operador, não para o log: ele precisa saber que o
    // problema é o catálogo desta máquina, não o produto.
    expect(resultado.mensagem).toContain("catálogo local");
  });

  it("🔑 grava na fila só quando o pagamento fecha", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");
    venda.adicionarItem("7891000100103");

    const cedo = venda.finalizar();

    expect(cedo.tipo).toBe("ERRO");
    expect(fila.quantidadePendente()).toBe(0);

    venda.registrarPagamento("DINHEIRO", "1990");
    const fechada = venda.finalizar();

    expect(fechada.tipo).toBe("OK");
    expect(fila.quantidadePendente()).toBe(1);
  });

  it("🔑 calcula o troco quando o operador recebe a mais", () => {
    // O troco é o número que o operador confere na mão, com o cliente na
    // frente. Errar aqui é erro de caixa, não de software.
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");
    venda.adicionarItem("7891000100103");
    venda.registrarPagamento("DINHEIRO", "5000");

    const fechada = venda.finalizar();

    expect(fechada.tipo).toBe("OK");
    if (fechada.tipo !== "OK") return;

    expect(fechada.troco).toBe("3010");
  });

  it("aceita pagamento em partes", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");
    venda.adicionarItem("7891000100103");

    const primeiro = venda.registrarPagamento("CARTAO_DEBITO", "1000");

    expect(primeiro.tipo).toBe("OK");
    if (primeiro.tipo !== "OK") return;
    expect(primeiro.faltaPagar).toBe("990");

    const segundo = venda.registrarPagamento("DINHEIRO", "990");

    expect(segundo.tipo).toBe("OK");
    if (segundo.tipo !== "OK") return;
    expect(segundo.faltaPagar).toBe("0");
  });

  it("recusa valor de pagamento que não é inteiro positivo", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");
    venda.adicionarItem("7891000100103");

    expect(venda.registrarPagamento("DINHEIRO", "9,90").tipo).toBe("ERRO");
    expect(venda.registrarPagamento("DINHEIRO", "0").tipo).toBe("ERRO");
    expect(venda.registrarPagamento("DINHEIRO", "-100").tipo).toBe("ERRO");
  });

  it("recusa pagamento em venda sem item", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    expect(venda.registrarPagamento("DINHEIRO", "1000").tipo).toBe("ERRO");
  });

  it("recusa qualquer operação sem venda aberta", () => {
    const venda = montar();

    expect(venda.adicionarItem("7891000100103").tipo).toBe("ERRO");
    expect(venda.registrarPagamento("DINHEIRO", "100").tipo).toBe("ERRO");
    expect(venda.finalizar().tipo).toBe("ERRO");
  });

  it("cancelar descarta sem deixar rastro na fila", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");
    venda.adicionarItem("7891000100103");

    venda.cancelar();

    expect(fila.quantidadePendente()).toBe(0);
    expect(venda.adicionarItem("7891000100103").tipo).toBe("ERRO");
  });

  it("a venda enfileirada leva o que o servidor precisa para remontá-la", () => {
    const venda = montar();
    venda.iniciar("estacao-7", "operador-9");
    venda.adicionarItem("7891000100103");
    venda.registrarPagamento("PIX", "1990");
    venda.finalizar();

    const [pendente] = fila.ler().pendentes;

    expect(pendente).toBeDefined();
    if (pendente === undefined) return;

    expect(pendente.id).toBe("venda-1");
    expect(pendente.estacaoId).toBe("estacao-7");
    expect(pendente.operadorId).toBe("operador-9");
    expect(pendente.total).toBe("1990");
    expect(pendente.itens).toEqual([
      { codigo: "7891000100103", quantidade: { milesimos: "1000", unidade: "UN" } },
    ]);
    expect(pendente.pagamentos).toEqual([{ forma: "PIX", valor: "1990" }]);
  });

  it("cada venda entra na fila com identificador próprio", () => {
    // Identificador repetido faria o servidor tratar a segunda venda como
    // reenvio da primeira e descartá-la — dinheiro que entrou e não aparece.
    const venda = montar();

    for (const _ of [1, 2]) {
      venda.iniciar("estacao-1", "operador-1");
      venda.adicionarItem("7891000100103");
      venda.registrarPagamento("DINHEIRO", "1990");
      venda.finalizar();
    }

    const ids = fila.ler().pendentes.map((pendente) => pendente.id);

    expect(new Set(ids).size).toBe(2);
  });
});

describe("etiqueta de balança offline", () => {
  it("🔑 registra o peso lido na etiqueta", () => {
    // Açougue e hortifrúti são dois dos nove segmentos-alvo. Um PDV que não
    // vende pesável offline é um PDV parado para eles (princípio 1).
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    const resultado = venda.adicionarItem(etiquetaDePeso("000123", 1235));

    expect(resultado.tipo).toBe("OK");
    if (resultado.tipo !== "OK") return;

    const [item] = resultado.venda.itens;
    expect(item?.quantidade).toEqual({ milesimos: "1235", unidade: "KG" });

    // 1,235 kg × R$ 89,90 = R$ 111,0265 → R$ 111,03. O arredondamento é
    // meio-para-cima, como manda a prática comercial brasileira, e é o mesmo
    // que o servidor aplicará na importação — divergir aqui faria o cupom
    // entregue ao cliente não bater com a venda registrada.
    expect(item?.total).toBe("11103");
  });

  it("recusa etiqueta cujo produto não está na réplica", () => {
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    const resultado = venda.adicionarItem(etiquetaDePeso("000999", 1000));

    expect(resultado.tipo).toBe("ERRO");
    if (resultado.tipo !== "ERRO") return;
    expect(resultado.mensagem).toContain("catálogo local");
  });

  it("recusa etiqueta com dígito verificador errado", () => {
    // Etiqueta amassada ou suja é rotina no balcão. Registrar 9,8 kg de picanha
    // no lugar de 0,98 kg é prejuízo que ninguém percebe na hora.
    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    const boa = etiquetaDePeso("000123", 1235);
    const corrompida = `${boa.slice(0, 12)}${boa.at(-1) === "0" ? "1" : "0"}`;

    expect(venda.adicionarItem(corrompida).tipo).toBe("ERRO");
  });
});

describe("cantos do catálogo local", () => {
  it("unidade que o domínio não conhece vira recusa, não exceção", () => {
    // Réplica gravada por uma versão mais nova do servidor pode trazer unidade
    // que esta estação ainda não entende. Recusar o item é degradação; estourar
    // seria a tela branca no meio do atendimento.
    replica.substituir({
      atualizadoEm: "2026-08-01T00:00:00.000Z",
      produtos: [{ ...CAFE, unidade: "PARSEC" }],
    });

    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    const resultado = venda.adicionarItem("7891000100103");

    expect(resultado.tipo).toBe("ERRO");
    if (resultado.tipo !== "ERRO") return;
    expect(resultado.mensagem).toContain("Unidade inválida");
  });

  it("preço ilegível no catálogo vira recusa", () => {
    replica.substituir({
      atualizadoEm: "2026-08-01T00:00:00.000Z",
      produtos: [{ ...CAFE, precoVenda: "-1" }],
    });

    const venda = montar();
    venda.iniciar("estacao-1", "operador-1");

    expect(venda.adicionarItem("7891000100103").tipo).toBe("ERRO");
  });

  it("etiqueta que embute preço vira quantidade pela divisão", () => {
    // Balança configurada para gravar o preço total, e não o peso: a quantidade
    // sai de preço-da-etiqueta ÷ preço-unitário.
    const venda = montarComLayoutDePreco();
    venda.iniciar("estacao-1", "operador-1");

    // R$ 44,95 numa picanha de R$ 89,90/kg são 0,500 kg.
    const resultado = venda.adicionarItem(etiquetaDeValor("000123", 4495));

    expect(resultado.tipo).toBe("OK");
    if (resultado.tipo !== "OK") return;
    expect(resultado.venda.itens[0]?.quantidade).toEqual({
      milesimos: "500",
      unidade: "KG",
    });
  });

  it("🔑 etiqueta de preço em produto sem preço não vira quantidade adivinhada", () => {
    // Sem preço unitário não há divisão possível. Adivinhar cobraria errado,
    // que é o defeito mais caro do balcão.
    replica.substituir({
      atualizadoEm: "2026-08-01T00:00:00.000Z",
      produtos: [{ ...PICANHA, precoVenda: "0" }],
    });

    const venda = montarComLayoutDePreco();
    venda.iniciar("estacao-1", "operador-1");

    const resultado = venda.adicionarItem(etiquetaDeValor("000123", 4495));

    expect(resultado.tipo).toBe("ERRO");
    if (resultado.tipo !== "ERRO") return;
    expect(resultado.mensagem).toContain("Registre manualmente");
  });
});

/** Balança que grava preço no lugar do peso — configuração menos comum, mas real. */
function montarComLayoutDePreco(): VendaLocal {
  return new VendaLocal({
    replica,
    fila,
    layoutBalanca: { ...LAYOUT_BALANCA_PADRAO, conteudo: "PRECO", casasDecimais: 2 },
    novoId: () => `venda-${String(++sequencia)}`,
  });
}

/** Monta uma etiqueta `2 PPPPPP VVVVV D` com dígito verificador correto. */
function etiquetaDePeso(codigoProduto: string, gramas: number): string {
  const corpo = `2${codigoProduto}${String(gramas).padStart(5, "0")}`;

  return `${corpo}${digitoEan13(corpo)}`;
}

/** O mesmo formato de etiqueta; o layout é que decide se o valor é peso ou preço. */
function etiquetaDeValor(codigoProduto: string, valor: number): string {
  return etiquetaDePeso(codigoProduto, valor);
}

function digitoEan13(doze: string): string {
  let soma = 0;

  for (let indice = 0; indice < doze.length; indice += 1) {
    soma += Number(doze[indice]) * (indice % 2 === 0 ? 1 : 3);
  }

  return String((10 - (soma % 10)) % 10);
}
