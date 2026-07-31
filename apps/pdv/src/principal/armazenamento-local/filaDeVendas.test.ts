import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { FilaDeVendas, type VendaPendente } from "./filaDeVendas.js";

let caminho: string;

beforeEach(() => {
  caminho = join(mkdtempSync(join(tmpdir(), "fila-")), "vendas.ndjson");
});

function venda(id: string, total = "990"): VendaPendente {
  return {
    id,
    estacaoId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
    operadorId: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0002",
    registradaEm: "2026-07-31T14:35:00.000Z",
    itens: [{ codigo: "7891000315507" }],
    pagamentos: [{ forma: "DINHEIRO", valor: total }],
    total,
  };
}

describe("Fila vazia", () => {
  it("arquivo que não existe é fila vazia, não erro", () => {
    const fila = new FilaDeVendas(caminho);

    expect(fila.ler()).toEqual({ pendentes: [], linhasCorrompidas: 0 });
    expect(fila.quantidadePendente()).toBe(0);
  });
});

describe("Enfileirar", () => {
  it("🔑 a venda está no disco quando a função retorna", () => {
    // Quem chama diz "venda concluída" ao operador logo em seguida. Se a
    // gravação fosse assíncrona, uma queda de energia levaria a venda que o
    // cliente já pagou.
    new FilaDeVendas(caminho).enfileirar(venda("v1"));

    expect(readFileSync(caminho, "utf8")).toContain("v1");
  });

  it("guarda a ordem em que as vendas aconteceram", () => {
    // É assim que o relatório do dia bate com a fita do caixa.
    const fila = new FilaDeVendas(caminho);

    for (const id of ["v1", "v2", "v3"]) fila.enfileirar(venda(id));

    expect(fila.ler().pendentes.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("preserva os dados da venda inteiros", () => {
    const fila = new FilaDeVendas(caminho);
    const original = venda("v1", "12345");

    fila.enfileirar(original);

    expect(fila.ler().pendentes[0]).toEqual(original);
  });
});

describe("Confirmar", () => {
  it("venda confirmada sai da lista de pendentes", () => {
    const fila = new FilaDeVendas(caminho);
    fila.enfileirar(venda("v1"));
    fila.enfileirar(venda("v2"));

    fila.confirmar("v1", new Date("2026-07-31T15:00:00Z"));

    expect(fila.ler().pendentes.map((v) => v.id)).toEqual(["v2"]);
  });

  it("🔑 confirmar não apaga a linha da venda — acrescenta outra", () => {
    // Reescrever o arquivo a cada confirmação abriria a janela em que uma queda
    // de energia o deixaria pela metade, com as vendas não enviadas dentro.
    const fila = new FilaDeVendas(caminho);
    fila.enfileirar(venda("v1"));
    fila.confirmar("v1", new Date());

    const conteudo = readFileSync(caminho, "utf8");

    expect(conteudo).toContain("v1");
    expect(conteudo.trim().split("\n")).toHaveLength(2);
  });

  it("confirmar duas vezes não quebra nada", () => {
    // Acontece: a resposta do servidor chega duas vezes, ou o operador
    // reinicia no meio da sincronização.
    const fila = new FilaDeVendas(caminho);
    fila.enfileirar(venda("v1"));
    fila.confirmar("v1", new Date());
    fila.confirmar("v1", new Date());

    expect(fila.quantidadePendente()).toBe(0);
  });

  it("confirmar venda que não existe é inofensivo", () => {
    const fila = new FilaDeVendas(caminho);
    fila.confirmar("fantasma", new Date());

    expect(fila.quantidadePendente()).toBe(0);
  });
});

describe("Arquivo danificado", () => {
  it("🔑 última linha pela metade não leva as vendas boas junto", () => {
    // É o caso da queda de energia no meio da gravação — e é a vantagem
    // concreta do formato de linha sobre um banco: o estrago tem o tamanho de
    // uma venda (ADR-0021).
    const fila = new FilaDeVendas(caminho);
    fila.enfileirar(venda("v1"));
    fila.enfileirar(venda("v2"));

    appendFileSync(caminho, '{"tipo":"VENDA","venda":{"id":"v3","ite');

    const estado = fila.ler();

    expect(estado.pendentes.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(estado.linhasCorrompidas).toBe(1);
  });

  it("linha corrompida no meio também é só descartada", () => {
    writeFileSync(
      caminho,
      [
        JSON.stringify({ tipo: "VENDA", venda: venda("v1") }),
        "{{{ lixo",
        JSON.stringify({ tipo: "VENDA", venda: venda("v2") }),
      ].join("\n"),
      "utf8",
    );

    const estado = new FilaDeVendas(caminho).ler();

    expect(estado.pendentes.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(estado.linhasCorrompidas).toBe(1);
  });

  it("registro sem identificador é descartado — a fila não sabe o que fazer com ele", () => {
    writeFileSync(
      caminho,
      [
        JSON.stringify({ tipo: "VENDA", venda: { total: "990" } }),
        JSON.stringify({ tipo: "CONFIRMADA", em: "2026-07-31T15:00:00Z" }),
        JSON.stringify({ tipo: "DESCONHECIDO", coisa: 1 }),
        JSON.stringify("nem objeto é"),
      ].join("\n"),
      "utf8",
    );

    const estado = new FilaDeVendas(caminho).ler();

    expect(estado.pendentes).toHaveLength(0);
    expect(estado.linhasCorrompidas).toBe(4);
  });

  it("🔑 venda com campo desconhecido continua válida", () => {
    // Uma versão futura pode acrescentar campos. Validar a venda inteira aqui
    // faria a atualização descartar vendas antigas que estavam perfeitamente
    // boas — e elas são justamente as que ainda não foram cobradas.
    writeFileSync(
      caminho,
      JSON.stringify({
        tipo: "VENDA",
        venda: { ...venda("v1"), campoDoFuturo: "algo" },
      }),
      "utf8",
    );

    expect(new FilaDeVendas(caminho).ler().pendentes.map((v) => v.id)).toEqual(["v1"]);
  });

  it("linhas em branco são ignoradas sem contar como corrompidas", () => {
    writeFileSync(
      caminho,
      `\n${JSON.stringify({ tipo: "VENDA", venda: venda("v1") })}\n\n`,
      "utf8",
    );

    const estado = new FilaDeVendas(caminho).ler();

    expect(estado.pendentes).toHaveLength(1);
    expect(estado.linhasCorrompidas).toBe(0);
  });
});

describe("Compactação", () => {
  it("limpa o arquivo quando não há mais nada pendente", () => {
    const fila = new FilaDeVendas(caminho);
    fila.enfileirar(venda("v1"));
    fila.confirmar("v1", new Date());

    expect(fila.compactar()).toBe(2);
    expect(readFileSync(caminho, "utf8")).toBe("");
  });

  it("🔑 recusa compactar com venda pendente dentro", () => {
    // Compactar com pendência trocaria um arquivo que só cresce por uma janela
    // em que a queda de energia leva tudo — inclusive o que não foi cobrado.
    const fila = new FilaDeVendas(caminho);
    fila.enfileirar(venda("v1"));
    fila.enfileirar(venda("v2"));
    fila.confirmar("v1", new Date());

    expect(fila.compactar()).toBe(0);
    expect(fila.quantidadePendente()).toBe(1);
  });

  it("compactar arquivo inexistente é inofensivo", () => {
    expect(new FilaDeVendas(caminho).compactar()).toBe(0);
  });
});

describe("Volume", () => {
  it("🔑 aguenta um dia inteiro offline sem degradar", () => {
    // Um mercadinho movimentado faz ~300 vendas por dia. O ADR-0021 declara
    // 5.000 como gatilho de revisão; aqui se confere que a ordem de grandeza
    // real passa longe de ser problema.
    const fila = new FilaDeVendas(caminho);

    for (let i = 0; i < 500; i += 1) fila.enfileirar(venda(`v${String(i)}`));

    const inicio = Date.now();
    const estado = fila.ler();

    expect(estado.pendentes).toHaveLength(500);
    expect(Date.now() - inicio).toBeLessThan(1000);
  });
});
