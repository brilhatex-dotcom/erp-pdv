import {
  Dinheiro,
  Documento,
  Embalagem,
  Fornecedor,
  Identificador,
  Produto,
} from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";

import { CancelarNotaDeCompra } from "./CancelarNotaDeCompra.js";
import { type EntradaLancarNota, LancarNotaDeCompra } from "./LancarNotaDeCompra.js";

const FORNECEDOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0011").unwrap();
const PRODUTO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0012").unwrap();
const USUARIO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0013").unwrap();
const AUSENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f9999").unwrap();

const EMISSAO = new Date("2026-07-28T09:00:00.000Z");
const ENTRADA = new Date("2026-07-30T14:00:00.000Z");

function montar() {
  const ambiente = montarAmbiente();

  return {
    ...ambiente,
    lancar: new LancarNotaDeCompra(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
    cancelar: new CancelarNotaDeCompra(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
  };
}

let cenario: ReturnType<typeof montar>;

beforeEach(async () => {
  cenario = montar();

  await cenario.fornecedores.salvar(
    Fornecedor.criar({
      id: FORNECEDOR,
      razaoSocial: "Distribuidora Central Ltda",
      documento: Documento.criar("11.222.333/0001-81").unwrap(),
    }).unwrap(),
  );

  cenario.produtos.adicionar(
    Produto.criar({
      id: PRODUTO,
      sku: "REF001",
      descricao: "Refrigerante Cola 2 Litros",
      tipo: "UNITARIO",
      unidadeBase: "UN",
      precoVenda: Dinheiro.deReais("9,90").unwrap(),
      embalagens: [Embalagem.criar("FD", 12n).unwrap()],
    }).unwrap(),
  );
});

function entradaBase(sobrescritas: Partial<EntradaLancarNota> = {}): EntradaLancarNota {
  const itens = sobrescritas.itens ?? [
    {
      produtoId: PRODUTO,
      quantidade: 10_000n,
      unidade: "UN" as const,
      custoUnitario: 300n,
    },
  ];

  return {
    fornecedorId: FORNECEDOR,
    numero: "123456",
    serie: "1",
    emitidaEm: EMISSAO,
    recebidaEm: ENTRADA,
    itens,
    totalDeclarado: 3000n,
    usuarioId: USUARIO,
    ...sobrescritas,
  };
}

function saldo() {
  return cenario.estoque.saldo(PRODUTO, "UN");
}

describe("Lançamento da nota de entrada", () => {
  it("🔑 a nota entra e o estoque sobe junto", async () => {
    const resultado = await cenario.lancar.executar(entradaBase());

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().total.formatar()).toBe("R$ 30,00");
    expect((await saldo()).milesimos).toBe(10_000n);
  });

  it("🔑 o movimento aponta para a nota que o originou", async () => {
    // É a corrente que responde uma divergência de inventário: saldo →
    // movimento → nota → fornecedor, sem passo faltando.
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();

    const movimento = cenario.estoque.movimentos[0];
    expect(movimento?.origem.tipo).toBe("COMPRA");
    expect(movimento?.origem.documentoId?.equals(nota.id)).toBe(true);
  });

  it("🔑 o movimento é datado na entrada da mercadoria, não em hoje", async () => {
    // Lançar uma nota de ontem precisa colocar o movimento em ontem, senão o
    // custo médio sai da ordem em que as compras aconteceram de verdade.
    await cenario.lancar.executar(entradaBase());

    expect(cenario.estoque.movimentos[0]?.ocorridoEm).toEqual(ENTRADA);
  });

  it("🔑 recebeu 3 fardos, o estoque recebe 36 unidades", async () => {
    await cenario.lancar.executar(
      entradaBase({
        itens: [
          { produtoId: PRODUTO, quantidade: 3_000n, unidade: "FD", custoUnitario: 6000n },
        ],
        totalDeclarado: 18_000n,
      }),
    );

    const atual = await saldo();
    expect(atual.milesimos).toBe(36_000n);
    // R$ 60,00 o fardo de 12 é R$ 5,00 a unidade.
    expect(atual.custoMedio.centavos).toBe(500n);
  });

  it("🔑 o desconto do fornecedor baixa o custo que vai para o estoque", async () => {
    // 10 a R$ 3,00 com R$ 5,00 de desconto: a loja pagou R$ 2,50 por unidade.
    // Ignorar o desconto inflaria o custo e encolheria a margem calculada.
    await cenario.lancar.executar(
      entradaBase({
        itens: [
          {
            produtoId: PRODUTO,
            quantidade: 10_000n,
            unidade: "UN",
            custoUnitario: 300n,
            desconto: 500n,
          },
        ],
        totalDeclarado: 2500n,
      }),
    );

    expect((await saldo()).custoMedio.centavos).toBe(250n);
  });

  it("🔑 atualiza o custo do cadastro, que alimenta o alerta de venda abaixo do custo", async () => {
    // Sem isto, o alerta compararia o preço de hoje com um custo digitado uma
    // vez no cadastro e nunca mais tocado.
    await cenario.lancar.executar(entradaBase());

    const produto = await cenario.produtos.porId(PRODUTO);
    expect(produto?.custo.centavos).toBe(300n);
  });

  it("congela a descrição do produto na nota", async () => {
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();

    expect(nota.itens[0]?.descricao).toBe("Refrigerante Cola 2 Litros");
  });

  it("numera os itens a partir de 1, na ordem em que vieram", async () => {
    const nota = (
      await cenario.lancar.executar(
        entradaBase({
          itens: [
            {
              produtoId: PRODUTO,
              quantidade: 1_000n,
              unidade: "UN",
              custoUnitario: 300n,
            },
            {
              produtoId: PRODUTO,
              quantidade: 2_000n,
              unidade: "UN",
              custoUnitario: 300n,
            },
          ],
          totalDeclarado: 900n,
        }),
      )
    ).unwrap();

    expect(nota.itens.map((item) => item.numero)).toEqual([1, 2]);
  });

  it("🔑 recusa a mesma nota lançada duas vezes", async () => {
    // É o defeito mais comum da entrada de mercadoria: dobra o estoque e some
    // no meio de centenas de lançamentos.
    await cenario.lancar.executar(entradaBase());

    const repetida = await cenario.lancar.executar(entradaBase());

    expect(repetida.isErr()).toBe(true);
    if (repetida.isErr()) {
      expect(repetida.error.codigo).toBe("NOTA_JA_LANCADA");
      expect(repetida.error.tipo).toBe("CONFLITO");
    }
    // E o estoque não subiu de novo.
    expect((await saldo()).milesimos).toBe(10_000n);
  });

  it("a mesma numeração em outra série é outra nota", async () => {
    await cenario.lancar.executar(entradaBase({ serie: "1" }));

    const outra = await cenario.lancar.executar(entradaBase({ serie: "2" }));

    expect(outra.isOk()).toBe(true);
  });

  it("🔑 recusa quando o total impresso não bate com a soma das linhas", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({ totalDeclarado: 3500n }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("NOTA_TOTAL_NAO_CONFERE");
    }
    // Nada foi gravado, nem nota nem movimento.
    expect(cenario.notasDeCompra.itens.size).toBe(0);
    expect(cenario.estoque.movimentos).toHaveLength(0);
  });

  it("recusa fornecedor que não existe", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({ fornecedorId: AUSENTE }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("FORNECEDOR_NAO_ENCONTRADO");
    }
  });

  it("recusa produto que não existe", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({
        itens: [
          { produtoId: AUSENTE, quantidade: 1_000n, unidade: "UN", custoUnitario: 300n },
        ],
        totalDeclarado: 300n,
      }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_NAO_ENCONTRADO");
    }
  });

  it("recusa embalagem que o produto não tem cadastrada", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({
        itens: [
          { produtoId: PRODUTO, quantidade: 1_000n, unidade: "CX", custoUnitario: 300n },
        ],
        totalDeclarado: 300n,
      }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_EMBALAGEM_NAO_CADASTRADA");
    }
  });

  it("recusa nota sem itens", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({ itens: [], totalDeclarado: 0n }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("NOTA_SEM_ITENS");
    }
  });

  it("recusa quantidade zero na linha", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({
        itens: [
          { produtoId: PRODUTO, quantidade: 0n, unidade: "UN", custoUnitario: 300n },
        ],
        totalDeclarado: 0n,
      }),
    );

    expect(resultado.isErr()).toBe(true);
  });

  it("recusa valor que não é dinheiro válido", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({ totalDeclarado: 10n ** 20n }),
    );

    expect(resultado.isErr()).toBe(true);
    expect(cenario.notasDeCompra.itens.size).toBe(0);
  });

  it("recusa desconto maior que a própria linha", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({
        itens: [
          {
            produtoId: PRODUTO,
            quantidade: 10_000n,
            unidade: "UN",
            custoUnitario: 300n,
            desconto: 4000n,
          },
        ],
        totalDeclarado: 0n,
      }),
    );

    expect(resultado.isErr()).toBe(true);
  });

  it("recusa desconto que não é dinheiro válido", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({
        itens: [
          {
            produtoId: PRODUTO,
            quantidade: 10_000n,
            unidade: "UN",
            custoUnitario: 300n,
            desconto: 10n ** 20n,
          },
        ],
      }),
    );

    expect(resultado.isErr()).toBe(true);
    expect(cenario.notasDeCompra.itens.size).toBe(0);
  });

  it("recusa data de entrada anterior à emissão", async () => {
    const resultado = await cenario.lancar.executar(
      entradaBase({ recebidaEm: new Date("2026-07-27T00:00:00.000Z") }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("NOTA_RECEBIDA_ANTES_DA_EMISSAO");
    }
  });

  it("guarda observação e quem lançou", async () => {
    const nota = (
      await cenario.lancar.executar(entradaBase({ observacao: "Entrega parcial" }))
    ).unwrap();

    expect(nota.observacao).toBe("Entrega parcial");
    expect(nota.usuarioId.equals(USUARIO)).toBe(true);
  });
});

describe("Cancelamento da nota", () => {
  it("🔑 cancela e estorna o estoque", async () => {
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();
    expect((await saldo()).milesimos).toBe(10_000n);

    const cancelada = await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Lançada em duplicidade",
      usuarioId: USUARIO,
    });

    expect(cancelada.isOk()).toBe(true);
    expect(cancelada.unwrap().estaCancelada).toBe(true);
    expect((await saldo()).milesimos).toBe(0n);
  });

  it("🔑 o estorno é ajuste, não devolução ao fornecedor", async () => {
    // Devolução é mercadoria que saiu de verdade; aqui nada saiu. Chamá-la de
    // devolução faria o relatório mostrar uma que ninguém fez.
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();
    await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Duplicada",
      usuarioId: USUARIO,
    });

    expect(cenario.estoque.movimentos.map((m) => m.tipo)).toEqual([
      "ENTRADA",
      "AJUSTE_NEGATIVO",
    ]);
  });

  it("🔑 a entrada original continua no extrato", async () => {
    // Fato é imutável. A pergunta "por que este produto teve entrada e saída no
    // mesmo dia" precisa ter resposta seis meses depois.
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();
    await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Duplicada",
      usuarioId: USUARIO,
    });

    expect(cenario.estoque.movimentos).toHaveLength(2);
    expect(cenario.notasDeCompra.itens.size).toBe(1);
    expect(cenario.estoque.movimentos[1]?.observacao).toContain("123456/1");
  });

  it("o estorno é datado agora, não na data da nota", async () => {
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();
    await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Duplicada",
      usuarioId: USUARIO,
    });

    expect(cenario.estoque.movimentos[1]?.ocorridoEm).toEqual(cenario.relogio.agora());
  });

  it("estorna a quantidade convertida, não a da embalagem", async () => {
    const nota = (
      await cenario.lancar.executar(
        entradaBase({
          itens: [
            {
              produtoId: PRODUTO,
              quantidade: 3_000n,
              unidade: "FD",
              custoUnitario: 6000n,
            },
          ],
          totalDeclarado: 18_000n,
        }),
      )
    ).unwrap();

    await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Duplicada",
      usuarioId: USUARIO,
    });

    expect((await saldo()).milesimos).toBe(0n);
  });

  it("🔑 exige motivo e recusa cancelar duas vezes", async () => {
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();

    const semMotivo = await cenario.cancelar.executar({
      id: nota.id,
      motivo: "  ",
      usuarioId: USUARIO,
    });
    expect(semMotivo.isErr()).toBe(true);

    await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Duplicada",
      usuarioId: USUARIO,
    });

    const denovo = await cenario.cancelar.executar({
      id: nota.id,
      motivo: "De novo",
      usuarioId: USUARIO,
    });

    expect(denovo.isErr()).toBe(true);
    if (denovo.isErr()) expect(denovo.error.codigo).toBe("NOTA_JA_CANCELADA");
    // E o estoque não foi estornado duas vezes.
    expect((await saldo()).milesimos).toBe(0n);
  });

  it("🔑 cancelar libera a numeração para o relançamento correto", async () => {
    // Quem digitou a quantidade errada cancela e relança a **mesma** nota. Se a
    // chave continuasse presa pela cancelada, a correção exigiria mexer no
    // banco na loja do cliente — que é o cenário que o produto evita.
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();
    await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Quantidade digitada errada",
      usuarioId: USUARIO,
    });

    const relancada = await cenario.lancar.executar(
      entradaBase({
        itens: [
          { produtoId: PRODUTO, quantidade: 20_000n, unidade: "UN", custoUnitario: 300n },
        ],
        totalDeclarado: 6000n,
      }),
    );

    expect(relancada.isOk()).toBe(true);
    // O saldo reflete só o relançamento: 10 entraram, 10 estornaram, 20 entraram.
    expect((await saldo()).milesimos).toBe(20_000n);
  });

  it("recusa estornar quando o produto foi removido do banco", async () => {
    // Não acontece pela tela — produto se desativa, não se apaga —, mas o
    // estorno precisa falhar inteiro em vez de deixar a nota cancelada com o
    // estoque ainda por cima.
    const nota = (await cenario.lancar.executar(entradaBase())).unwrap();
    cenario.produtos.itens.delete(PRODUTO.valor);

    const resultado = await cenario.cancelar.executar({
      id: nota.id,
      motivo: "Duplicada",
      usuarioId: USUARIO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("PRODUTO_NAO_ENCONTRADO");
    }
  });

  it("recusa nota que não existe", async () => {
    const resultado = await cenario.cancelar.executar({
      id: AUSENTE,
      motivo: "Duplicada",
      usuarioId: USUARIO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("NOTA_NAO_ENCONTRADA");
    }
  });
});
