import { describe, expect, it } from "vitest";

import { LAYOUT_BALANCA_PADRAO } from "../catalogo/CodigoBalanca.js";
import { Identificador } from "../shared/Identificador.js";
import {
  ConfiguracaoLoja,
  type DadosConfiguracaoLoja,
  ehImpressaoComprovante,
  ehLarguraCupom,
  ehRecurso,
  ehRegraVendaSemEstoque,
  ehSegmento,
  type LarguraCupom,
  type Recurso,
  recursosDoSegmento,
  type RegraVendaSemEstoque,
  type Segmento,
} from "./ConfiguracaoLoja.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f5c01").unwrap();

function dados(sobrescritas: Partial<DadosConfiguracaoLoja> = {}): DadosConfiguracaoLoja {
  return {
    id: ID,
    segmento: "PADARIA",
    recursos: ["VENDA_POR_PESO", "FIADO"],
    vendaSemEstoque: "PERMITIR",
    larguraCupom: 80,
    impressaoComprovante: "SOB_PEDIDO",
    layoutBalanca: LAYOUT_BALANCA_PADRAO,
    ...sobrescritas,
  };
}

function codigos(resultado: ReturnType<typeof ConfiguracaoLoja.criar>): string[] {
  return resultado.isErr() ? resultado.error.map((erro) => erro.codigo) : [];
}

describe("ConfiguracaoLoja — padrão de cada segmento", () => {
  it("🔑 antes de configurar, vale a loja mista: nada falta no primeiro dia", () => {
    const configuracao = ConfiguracaoLoja.padrao(ID);

    expect(configuracao.segmento).toBe("MISTO");
    expect(configuracao.recursos).toEqual(["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"]);
    expect(configuracao.vendaSemEstoque).toBe("PERMITIR");
    expect(configuracao.larguraCupom).toBe(80);
    expect(configuracao.layoutBalanca).toEqual(LAYOUT_BALANCA_PADRAO);
  });

  it("padaria vende fiado e imprime só quando pedem", () => {
    const configuracao = ConfiguracaoLoja.padrao(ID, "PADARIA");

    expect(configuracao.temRecurso("FIADO")).toBe(true);
    expect(configuracao.temRecurso("VENDA_POR_PESO")).toBe(true);
    expect(configuracao.impressaoComprovante).toBe("SOB_PEDIDO");
  });

  it("🔑 frutaria não tem caderneta, como na análise de segmentos", () => {
    const configuracao = ConfiguracaoLoja.padrao(ID, "FRUTARIA");

    expect(configuracao.temRecurso("FIADO")).toBe(false);
    expect(configuracao.temRecurso("VENDA_POR_PESO")).toBe(true);
  });

  it("mercadinho imprime o comprovante sempre", () => {
    expect(ConfiguracaoLoja.padrao(ID, "MERCADINHO").impressaoComprovante).toBe("SEMPRE");
  });

  it.each(["PADARIA", "MERCADINHO", "FRUTARIA", "MISTO"] as const)(
    "%s oferece recursos de fábrica",
    (segmento: Segmento) => {
      expect(recursosDoSegmento(segmento).length).toBeGreaterThan(0);
    },
  );
});

describe("ConfiguracaoLoja — criação", () => {
  it("cria com dados válidos", () => {
    const configuracao = ConfiguracaoLoja.criar(dados()).unwrap();

    expect(configuracao.segmento).toBe("PADARIA");
    expect(configuracao.recursos).toEqual(["VENDA_POR_PESO", "FIADO"]);
  });

  it("devolve os recursos em ordem fixa, venha como vier", () => {
    const configuracao = ConfiguracaoLoja.criar(
      dados({ recursos: ["BOTOES_RAPIDOS", "VENDA_POR_PESO"] }),
    ).unwrap();

    expect(configuracao.recursos).toEqual(["VENDA_POR_PESO", "BOTOES_RAPIDOS"]);
  });

  it("recusa segmento desconhecido", () => {
    expect(
      codigos(ConfiguracaoLoja.criar(dados({ segmento: "OFICINA" as Segmento }))),
    ).toEqual(["CONFIGURACAO_SEGMENTO_INVALIDO"]);
  });

  it("recusa recurso desconhecido", () => {
    expect(
      codigos(ConfiguracaoLoja.criar(dados({ recursos: ["COMANDAS" as Recurso] }))),
    ).toEqual(["CONFIGURACAO_RECURSO_DESCONHECIDO"]);
  });

  it("recusa regra de estoque desconhecida", () => {
    expect(
      codigos(
        ConfiguracaoLoja.criar(
          dados({ vendaSemEstoque: "AVISAR" as RegraVendaSemEstoque }),
        ),
      ),
    ).toEqual(["CONFIGURACAO_REGRA_ESTOQUE_INVALIDA"]);
  });

  it("recusa papel que não é de 58 nem de 80 mm", () => {
    expect(
      codigos(ConfiguracaoLoja.criar(dados({ larguraCupom: 76 as LarguraCupom }))),
    ).toEqual(["CONFIGURACAO_LARGURA_INVALIDA"]);
  });

  it("recusa momento de impressão desconhecido", () => {
    expect(
      codigos(
        ConfiguracaoLoja.criar(
          dados({ impressaoComprovante: "NUNCA" as "SEMPRE" | "SOB_PEDIDO" }),
        ),
      ),
    ).toEqual(["CONFIGURACAO_IMPRESSAO_INVALIDA"]);
  });

  it("🔑 confere o layout da balança antes de a loja depender dele", () => {
    const resultado = ConfiguracaoLoja.criar(
      dados({ layoutBalanca: { ...LAYOUT_BALANCA_PADRAO, tamanhoCodigoProduto: 9 } }),
    );

    expect(codigos(resultado)).toContain("BALANCA_TAMANHO_CODIGO_INVALIDO");
  });

  it("reconstitui sem validar", () => {
    const configuracao = ConfiguracaoLoja.reconstituir(dados({ larguraCupom: 58 }));

    expect(configuracao.larguraCupom).toBe(58);
    expect(configuracao.id.equals(ID)).toBe(true);
  });
});

describe("ConfiguracaoLoja — alteração", () => {
  it("altera só o que veio", () => {
    const configuracao = ConfiguracaoLoja.criar(dados()).unwrap();

    configuracao.alterar({ larguraCupom: 58, vendaSemEstoque: "AUTORIZAR" }).unwrap();

    expect(configuracao.larguraCupom).toBe(58);
    expect(configuracao.vendaSemEstoque).toBe("AUTORIZAR");
    expect(configuracao.segmento).toBe("PADARIA");
    expect(configuracao.impressaoComprovante).toBe("SOB_PEDIDO");
  });

  it("🔑 trocar o segmento não religa o fiado que a loja desligou", () => {
    const configuracao = ConfiguracaoLoja.criar(
      dados({ recursos: ["VENDA_POR_PESO"] }),
    ).unwrap();

    configuracao.alterar({ segmento: "MISTO" }).unwrap();

    expect(configuracao.segmento).toBe("MISTO");
    expect(configuracao.temRecurso("FIADO")).toBe(false);
  });

  it("aplica recursos, impressão e balança juntos", () => {
    const configuracao = ConfiguracaoLoja.criar(dados()).unwrap();
    const layout = {
      ...LAYOUT_BALANCA_PADRAO,
      conteudo: "PRECO" as const,
      casasDecimais: 2,
    };

    configuracao
      .alterar({
        recursos: ["BOTOES_RAPIDOS"],
        impressaoComprovante: "SEMPRE",
        layoutBalanca: layout,
      })
      .unwrap();

    expect(configuracao.recursos).toEqual(["BOTOES_RAPIDOS"]);
    expect(configuracao.impressaoComprovante).toBe("SEMPRE");
    expect(configuracao.layoutBalanca).toEqual(layout);
  });

  it("tudo ou nada: um campo inválido não deixa os outros mudarem", () => {
    const configuracao = ConfiguracaoLoja.criar(dados()).unwrap();

    const resultado = configuracao.alterar({
      larguraCupom: 58,
      layoutBalanca: { ...LAYOUT_BALANCA_PADRAO, prefixos: [] },
    });

    expect(resultado.isErr()).toBe(true);
    expect(configuracao.larguraCupom).toBe(80);
  });
});

describe("ConfiguracaoLoja — valores aceitos", () => {
  it.each([
    [ehSegmento("FRUTARIA"), true],
    [ehSegmento("OFICINA"), false],
    [ehRecurso("FIADO"), true],
    [ehRecurso("TEF"), false],
    [ehRegraVendaSemEstoque("BLOQUEAR"), true],
    [ehRegraVendaSemEstoque("IGNORAR"), false],
    [ehLarguraCupom(58), true],
    [ehLarguraCupom(57), false],
    [ehImpressaoComprovante("SOB_PEDIDO"), true],
    [ehImpressaoComprovante("TALVEZ"), false],
  ])("%s → %s", (obtido, esperado) => {
    expect(obtido).toBe(esperado);
  });
});

describe("ConfiguracaoLoja — logotipo", () => {
  const LOGO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7777").unwrap();

  it("nasce sem logotipo, recebe um e o mantém quando a alteração não fala dele", () => {
    const configuracao = ConfiguracaoLoja.padrao(
      Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7778").unwrap(),
    );
    expect(configuracao.logoId).toBeUndefined();

    configuracao.alterar({ logoId: LOGO }).unwrap();
    configuracao.alterar({ larguraCupom: 58 }).unwrap();

    expect(configuracao.logoId?.equals(LOGO)).toBe(true);
  });

  it("🔑 `null` tira o logotipo — ausente só mantém", () => {
    const configuracao = ConfiguracaoLoja.padrao(
      Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f7778").unwrap(),
    );
    configuracao.alterar({ logoId: LOGO }).unwrap();

    configuracao.alterar({ logoId: null }).unwrap();

    expect(configuracao.logoId).toBeUndefined();
  });
});
