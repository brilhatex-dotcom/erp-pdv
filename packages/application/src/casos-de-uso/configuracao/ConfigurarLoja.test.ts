import { beforeEach, describe, expect, it } from "vitest";

import { type Balcao, GERENTE, montarBalcao } from "../../testes/balcao.js";

let balcao: Balcao;

beforeEach(() => {
  balcao = montarBalcao();
});

describe("Configuração da loja", () => {
  it("🔑 antes de alguém configurar, o caixa funciona com a de fábrica — sem gravá-la", async () => {
    const { configuracao, gravada } = (
      await balcao.obterConfiguracao.executar()
    ).unwrap();

    expect(gravada).toBe(false);
    expect(configuracao.segmento).toBe("MISTO");
    expect(configuracao.vendaSemEstoque).toBe("PERMITIR");
    expect(balcao.configuracao.configuracao).toBeUndefined();
  });

  it("🔑 escolher 'padaria' no primeiro acesso traz a padaria inteira", async () => {
    const configuracao = (
      await balcao.definirConfiguracao.executar({
        usuarioId: GERENTE,
        alteracao: { segmento: "PADARIA" },
      })
    ).unwrap();

    expect(configuracao.segmento).toBe("PADARIA");
    expect(configuracao.impressaoComprovante).toBe("SOB_PEDIDO");
    expect(configuracao.temRecurso("FIADO")).toBe(true);

    const { gravada } = (await balcao.obterConfiguracao.executar()).unwrap();
    expect(gravada).toBe(true);

    const [registro] = balcao.auditoria.da("CONFIGURACAO_ALTERADA");
    expect(registro?.descricao).toContain("Configuração da loja definida: padaria");
    expect(registro?.dados?.["antes"]).toBeNull();
  });

  it("🔑 mudar a regra de estoque fica na auditoria com o antes e o depois", async () => {
    await balcao.definirConfiguracao.executar({
      usuarioId: GERENTE,
      alteracao: { segmento: "MERCADINHO" },
    });

    await balcao.definirConfiguracao.executar({
      usuarioId: GERENTE,
      alteracao: { vendaSemEstoque: "BLOQUEAR" },
    });

    const [, alteracao] = balcao.auditoria.da("CONFIGURACAO_ALTERADA");
    expect(alteracao?.descricao).toContain("alterada");
    expect(String(alteracao?.dados?.["antes"])).toContain("sem estoque: permitir");
    expect(String(alteracao?.dados?.["depois"])).toContain("sem estoque: bloquear");
  });

  it("gravar o mesmo de novo não suja a auditoria", async () => {
    const pedido = { usuarioId: GERENTE, alteracao: { segmento: "FRUTARIA" as const } };

    await balcao.definirConfiguracao.executar(pedido);
    await balcao.definirConfiguracao.executar(pedido);

    expect(balcao.auditoria.da("CONFIGURACAO_ALTERADA")).toHaveLength(1);
  });

  it("🔑 layout de balança inválido é recusado inteiro, com a mensagem de cada problema", async () => {
    const resultado = await balcao.definirConfiguracao.executar({
      usuarioId: GERENTE,
      alteracao: {
        layoutBalanca: {
          prefixos: ["2"],
          tamanhoCodigoProduto: 9,
          conteudo: "PESO",
          casasDecimais: 3,
        },
      },
    });

    expect(resultado.isErr()).toBe(true);
    expect(balcao.configuracao.configuracao).toBeUndefined();
  });

  it("recurso sem nenhum vira 'nenhum' no resumo", async () => {
    await balcao.definirConfiguracao.executar({
      usuarioId: GERENTE,
      alteracao: { segmento: "MISTO", recursos: [] },
    });

    expect(balcao.auditoria.da("CONFIGURACAO_ALTERADA")[0]?.descricao).toContain(
      "recursos: nenhum",
    );
  });

  it("🔑 o logotipo precisa ser uma imagem que existe; `null` o tira", async () => {
    const semImagem = await balcao.definirConfiguracao.executar({
      usuarioId: GERENTE,
      alteracao: { logoId: balcao.geradorId.proximo() },
    });
    expect(semImagem.isErr() && semImagem.error.codigo).toBe("IMAGEM_NAO_ENCONTRADA");

    const logo = balcao.geradorId.proximo();
    await balcao.imagens.salvar({
      id: logo,
      tipo: "image/png",
      conteudo: new Uint8Array([1]),
      hash: "logo",
    });

    const comLogo = (
      await balcao.definirConfiguracao.executar({
        usuarioId: GERENTE,
        alteracao: { logoId: logo },
      })
    ).unwrap();
    expect(comLogo.logoId?.equals(logo)).toBe(true);
    expect(balcao.auditoria.da("CONFIGURACAO_ALTERADA").at(-1)?.descricao).toContain(
      "logotipo: sim",
    );

    const semLogo = (
      await balcao.definirConfiguracao.executar({
        usuarioId: GERENTE,
        alteracao: { logoId: null },
      })
    ).unwrap();
    expect(semLogo.logoId).toBeUndefined();
  });
});
