import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type CatalogoEmDisco,
  type ProdutoReplicado,
  ReplicaCatalogo,
} from "./replicaCatalogo.js";

let caminho: string;

beforeEach(() => {
  caminho = join(mkdtempSync(join(tmpdir(), "cat-")), "catalogo.json");
});

function produto(sobrescritas: Partial<ProdutoReplicado> = {}): ProdutoReplicado {
  return {
    id: "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001",
    sku: "REF001",
    descricao: "Refrigerante Cola 2 Litros",
    descricaoPdv: "REFRI COLA 2L",
    unidade: "UN",
    precoVenda: "990",
    codigoBarras: "7891000315507",
    ativo: true,
    ...sobrescritas,
  };
}

function catalogo(produtos: ProdutoReplicado[]): CatalogoEmDisco {
  return { atualizadoEm: "2026-07-31T14:00:00.000Z", produtos };
}

describe("Bipagem", () => {
  it("🔑 acha pelo código de barras — o caminho de quase toda venda", () => {
    const replica = new ReplicaCatalogo();
    replica.substituir(catalogo([produto()]));

    expect(replica.porCodigo("7891000315507")?.descricaoPdv).toBe("REFRI COLA 2L");
  });

  it("acha pelo SKU, ignorando a caixa", () => {
    const replica = new ReplicaCatalogo();
    replica.substituir(catalogo([produto()]));

    expect(replica.porCodigo("ref001")?.sku).toBe("REF001");
    expect(replica.porCodigo("  REF001  ")?.sku).toBe("REF001");
  });

  it("acha pelo código da balança — açougue e hortifruti", () => {
    const replica = new ReplicaCatalogo();
    replica.substituir(
      catalogo([
        produto({ sku: "PIC001", codigoBalanca: "2001234", codigoBarras: undefined }),
      ]),
    );

    expect(replica.porCodigo("2001234")?.sku).toBe("PIC001");
  });

  it("código inexistente ou vazio devolve indefinido", () => {
    const replica = new ReplicaCatalogo();
    replica.substituir(catalogo([produto()]));

    expect(replica.porCodigo("0000000000000")).toBeUndefined();
    expect(replica.porCodigo("   ")).toBeUndefined();
  });

  it("🔑 produto inativo não entra no índice", () => {
    // Se não pode ser vendido, não deve aparecer na bipada: mantê-lo levaria o
    // operador a bipar e receber recusa sem explicação.
    const replica = new ReplicaCatalogo();
    replica.substituir(catalogo([produto({ ativo: false })]));

    expect(replica.porCodigo("7891000315507")).toBeUndefined();
    expect(replica.quantidade).toBe(0);
  });
});

describe("Busca por descrição", () => {
  it("acha por prefixo, ignorando acento e caixa", () => {
    const replica = new ReplicaCatalogo();
    replica.substituir(
      catalogo([
        produto({ sku: "P1", descricaoPdv: "PÃO FRANCÊS", codigoBarras: "1" }),
        produto({ sku: "P2", descricaoPdv: "PICANHA KG", codigoBarras: "2" }),
      ]),
    );

    expect(replica.buscar("pao").map((p) => p.sku)).toEqual(["P1"]);
    expect(replica.buscar("PI").map((p) => p.sku)).toEqual(["P2"]);
  });

  it("termo vazio não devolve nada — não é 'liste tudo'", () => {
    const replica = new ReplicaCatalogo();
    replica.substituir(catalogo([produto()]));

    expect(replica.buscar("")).toEqual([]);
    expect(replica.buscar("   ")).toEqual([]);
  });

  it("respeita o limite pedido", () => {
    const replica = new ReplicaCatalogo();
    replica.substituir(
      catalogo(
        Array.from({ length: 50 }, (_, i) =>
          produto({
            sku: `S${String(i)}`,
            descricaoPdv: `AGUA MINERAL ${String(i)}`,
            codigoBarras: String(i),
          }),
        ),
      ),
    );

    expect(replica.buscar("agua")).toHaveLength(20);
    expect(replica.buscar("agua", 5)).toHaveLength(5);
  });
});

describe("Persistência", () => {
  it("grava e recarrega, mantendo a data de atualização", () => {
    const replica = new ReplicaCatalogo();
    replica.gravarEm(caminho, catalogo([produto()]));

    const outra = new ReplicaCatalogo();
    outra.carregarDe(caminho);

    expect(outra.porCodigo("7891000315507")?.sku).toBe("REF001");
    expect(outra.atualizadoEm?.toISOString()).toBe("2026-07-31T14:00:00.000Z");
  });

  it("arquivo ausente deixa a réplica vazia, sem erro", () => {
    const replica = new ReplicaCatalogo();
    replica.carregarDe(caminho);

    expect(replica.quantidade).toBe(0);
    expect(replica.atualizadoEm).toBeUndefined();
  });

  it("🔑 catálogo corrompido não impede o caixa de abrir", () => {
    // Sem réplica o PDV volta a depender do servidor — degradado, mas de pé.
    writeFileSync(caminho, "{{{ não é json", "utf8");

    const replica = new ReplicaCatalogo();
    replica.carregarDe(caminho);

    expect(replica.quantidade).toBe(0);
  });

  it("arquivo sem a lista de produtos também degrada em silêncio", () => {
    writeFileSync(caminho, JSON.stringify({ atualizadoEm: "2026-07-31" }), "utf8");

    const replica = new ReplicaCatalogo();
    replica.carregarDe(caminho);

    expect(replica.quantidade).toBe(0);
  });

  it("data inválida vira indefinida, e não uma data absurda", () => {
    // A data serve para avisar "catálogo desatualizado". Uma data inválida
    // exibida como 1970 confundiria mais do que a ausência.
    writeFileSync(
      caminho,
      JSON.stringify({ atualizadoEm: "ontem", produtos: [produto()] }),
      "utf8",
    );

    const replica = new ReplicaCatalogo();
    replica.carregarDe(caminho);

    expect(replica.atualizadoEm).toBeUndefined();
    expect(replica.quantidade).toBe(1);
  });

  it("gravar substitui o índice inteiro", () => {
    const replica = new ReplicaCatalogo();
    replica.gravarEm(caminho, catalogo([produto()]));
    replica.gravarEm(caminho, catalogo([produto({ sku: "OUTRO", codigoBarras: "111" })]));

    expect(replica.porCodigo("7891000315507")).toBeUndefined();
    expect(replica.porCodigo("111")?.sku).toBe("OUTRO");
    const emDisco = JSON.parse(readFileSync(caminho, "utf8")) as CatalogoEmDisco;
    expect(emDisco.produtos).toHaveLength(1);
  });
});

describe("Volume", () => {
  /**
   * Teto de indexação, generoso de propósito.
   *
   * O que este teste protege é **ordem de grandeza**: se alguém trocar o `Map`
   * por busca linear, indexar 50 mil produtos passa de milissegundos para
   * minutos, e o ADR-0021 — não usar banco na estação — deixa de se sustentar.
   *
   * Um segundo cravado media outra coisa: a velocidade da máquina. O runner do
   * CI roda dez pacotes em duas vCPUs e entregou 1.072 ms num código que leva
   * ~200 ms numa máquina ociosa. Teste vermelho por 7% de variação não protege
   * nada — só ensina a equipe a reexecutar até passar.
   */
  const TETO_INDEXACAO_MS = 5_000;

  it("🔑 50 mil produtos indexam sem virar busca linear", () => {
    // É o volume declarado no §12.2, e o número que sustenta a decisão de não
    // usar banco (ADR-0021).
    const produtos = Array.from({ length: 50_000 }, (_, i) =>
      produto({
        id: `id-${String(i)}`,
        sku: `SKU${String(i)}`,
        descricaoPdv: `PRODUTO ${String(i)}`,
        codigoBarras: `789${String(i).padStart(10, "0")}`,
      }),
    );

    const inicio = Date.now();
    const replica = new ReplicaCatalogo();
    replica.substituir(catalogo(produtos));
    const duracao = Date.now() - inicio;

    expect(replica.quantidade).toBe(50_000);
    expect(duracao).toBeLessThan(TETO_INDEXACAO_MS);
    // E a bipada continua instantânea.
    expect(replica.porCodigo("7890000049999")?.sku).toBe("SKU49999");
  });

  it("🔑 a bipada não fica mais lenta com o catálogo cheio", () => {
    // Esta é a garantia que o balcão sente, e ela é estável em qualquer
    // máquina porque compara duas medidas **na mesma execução** — em vez de
    // cravar um número que depende de quem está rodando.
    //
    // Se a busca virasse linear, procurar entre 50 mil levaria ordens de
    // grandeza mais que entre 10. Com `Map`, as duas são indistinguíveis.
    const grande = new ReplicaCatalogo();
    grande.substituir(
      catalogo(
        Array.from({ length: 50_000 }, (_, i) =>
          produto({
            id: `id-${String(i)}`,
            sku: `SKU${String(i)}`,
            codigoBarras: `789${String(i).padStart(10, "0")}`,
          }),
        ),
      ),
    );

    const pequeno = new ReplicaCatalogo();
    pequeno.substituir(
      catalogo(
        Array.from({ length: 10 }, (_, i) =>
          produto({
            id: `id-${String(i)}`,
            sku: `SKU${String(i)}`,
            codigoBarras: `789${String(i).padStart(10, "0")}`,
          }),
        ),
      ),
    );

    const medir = (replica: ReplicaCatalogo, codigo: string) => {
      const inicio = performance.now();
      for (let i = 0; i < 10_000; i += 1) replica.porCodigo(codigo);

      return performance.now() - inicio;
    };

    const noGrande = medir(grande, "7890000049999");
    const noPequeno = medir(pequeno, "7890000000009");

    // Vinte vezes é folga enorme para ruído de medição e continua reprovando
    // qualquer coisa que cresça com o tamanho do catálogo.
    expect(noGrande).toBeLessThan(Math.max(noPequeno, 1) * 20);
  });
});
