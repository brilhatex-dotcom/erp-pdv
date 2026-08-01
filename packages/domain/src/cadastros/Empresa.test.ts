import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { CNPJ } from "../valores/CNPJ.js";
import { Email } from "../valores/Email.js";
import { Endereco } from "../valores/Endereco.js";
import { InscricaoEstadual } from "../valores/InscricaoEstadual.js";
import { Telefone } from "../valores/Telefone.js";
import { type DadosEmpresa, ehRegimeTributario, Empresa } from "./Empresa.js";

/**
 * A empresa que opera a instalação.
 *
 * Ela é o emitente do documento fiscal e o cabeçalho de todo relatório. Um erro
 * aqui não aparece como tela quebrada — aparece como nota recusada pela SEFAZ,
 * ou como cupom saindo com o nome truncado sem ninguém ter sido avisado.
 */

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3ea00001").unwrap();

function endereco(): Endereco {
  return Endereco.criar({
    logradouro: "Rua das Flores",
    numero: "120",
    bairro: "Centro",
    municipio: "Campinas",
    uf: "SP",
    cep: "13010-000",
  }).unwrap();
}

function dados(sobrescritas: Partial<DadosEmpresa> = {}): DadosEmpresa {
  return {
    id: ID,
    razaoSocial: "Mercadinho Bom Preço Comércio de Alimentos Ltda",
    nomeFantasia: "Bom Preço",
    cnpj: CNPJ.criar("11222333000181").unwrap(),
    inscricaoEstadual: InscricaoEstadual.criar("110042490114").unwrap(),
    regimeTributario: "SIMPLES_NACIONAL",
    endereco: endereco(),
    ...sobrescritas,
  };
}

describe("cadastro", () => {
  it("guarda o que vai no cupom e na nota", () => {
    const empresa = Empresa.criar(dados()).unwrap();

    expect(empresa.razaoSocial).toBe("Mercadinho Bom Preço Comércio de Alimentos Ltda");
    expect(empresa.nomeFantasia).toBe("Bom Preço");
    expect(empresa.cnpj.caracteres).toBe("11222333000181");
    expect(empresa.regimeTributario).toBe("SIMPLES_NACIONAL");
    expect(empresa.endereco.municipio).toBe("Campinas");
  });

  it("🔑 exibe o fantasia, que é como a loja é conhecida", () => {
    // No cupom, o cliente reconhece "Bom Preço" — não a razão social.
    expect(Empresa.criar(dados()).unwrap().exibicao).toBe("Bom Preço");
  });

  it("sem fantasia, exibe a razão social", () => {
    const empresa = Empresa.criar(dados({ nomeFantasia: undefined })).unwrap();

    expect(empresa.exibicao).toBe("Mercadinho Bom Preço Comércio de Alimentos Ltda");
  });

  it("guarda a forma normalizada para busca", () => {
    expect(Empresa.criar(dados()).unwrap().razaoSocialBusca).toContain("bom preco");
  });

  it("contato e inscrição municipal são opcionais", () => {
    const empresa = Empresa.criar(
      dados({
        telefone: Telefone.criar("1938887777").unwrap(),
        email: Email.criar("contato@bompreco.com.br").unwrap(),
        inscricaoMunicipal: "  123456  ",
      }),
    ).unwrap();

    expect(empresa.telefone?.digitos).toBe("1938887777");
    expect(empresa.email?.valor).toBe("contato@bompreco.com.br");
    expect(empresa.inscricaoMunicipal).toBe("123456");
  });

  it("inscrição municipal em branco vira ausente, não string vazia", () => {
    const empresa = Empresa.criar(dados({ inscricaoMunicipal: "   " })).unwrap();

    expect(empresa.inscricaoMunicipal).toBeUndefined();
  });
});

describe("recusas", () => {
  it("razão social vazia é recusada", () => {
    const resultado = Empresa.criar(dados({ razaoSocial: "   " }));

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error[0]?.codigo).toBe("EMPRESA_RAZAO_SOCIAL_VAZIA");
  });

  it("🔑 razão social acima de 60 caracteres é recusada no cadastro", () => {
    // É o limite do `xNome` do emitente na NF-e. Cortar na hora de emitir
    // produziria nota com o nome truncado sem ninguém ter sido avisado.
    const resultado = Empresa.criar(dados({ razaoSocial: "M".repeat(61) }));

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error[0]?.codigo).toBe("EMPRESA_RAZAO_SOCIAL_LONGA");
  });

  it("nome fantasia longo demais é recusado", () => {
    const resultado = Empresa.criar(dados({ nomeFantasia: "F".repeat(61) }));

    expect(resultado.isErr()).toBe(true);
  });

  it("🔑 devolve todos os erros de uma vez", () => {
    // Corrigir um campo por tentativa é o formulário que ninguém termina.
    const resultado = Empresa.criar(
      dados({ razaoSocial: "", nomeFantasia: "F".repeat(61) }),
    );

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error).toHaveLength(2);
  });
});

describe("aptidão a emitir", () => {
  it("🔑 avisa antes que falta inscrição estadual", () => {
    // Não bloqueia nada — o fiscal é opcional (ADR-0016). Existe para a
    // retaguarda avisar antes da habilitação, em vez de o lojista descobrir na
    // primeira tentativa de emissão.
    const semInscricao = Empresa.criar(dados({ inscricaoEstadual: undefined })).unwrap();

    expect(semInscricao.aptaAEmitir).toBe(false);
  });

  it("com inscrição estadual, está apta", () => {
    expect(Empresa.criar(dados()).unwrap().aptaAEmitir).toBe(true);
  });

  it("🔑 MEI é apto sem inscrição estadual", () => {
    // O microempreendedor individual normalmente não tem IE, e emite NFC-e.
    // Exigi-la dele barraria justamente o menor dos clientes-alvo.
    const mei = Empresa.criar(
      dados({ regimeTributario: "MEI", inscricaoEstadual: undefined }),
    ).unwrap();

    expect(mei.aptaAEmitir).toBe(true);
  });
});

describe("alteração", () => {
  it("substitui o estado inteiro, inclusive limpando campo", () => {
    // Caso de uso que trata ausente como "não mexer" torna impossível corrigir
    // um telefone errado para vazio.
    const empresa = Empresa.criar(
      dados({ telefone: Telefone.criar("1938887777").unwrap() }),
    ).unwrap();

    const resultado = empresa.alterar({
      razaoSocial: "Bom Preço Alimentos Ltda",
      nomeFantasia: "Bom Preço",
      inscricaoEstadual: undefined,
      regimeTributario: "REGIME_NORMAL",
      endereco: endereco(),
      telefone: undefined,
      email: undefined,
    });

    expect(resultado.isOk()).toBe(true);
    expect(empresa.razaoSocial).toBe("Bom Preço Alimentos Ltda");
    expect(empresa.telefone).toBeUndefined();
    expect(empresa.regimeTributario).toBe("REGIME_NORMAL");
  });

  it("🔑 o CNPJ não pode ser alterado", () => {
    // Trocá-lo não é corrigir cadastro: é outra empresa, e as notas já emitidas
    // passariam a apontar para um emitente que nunca as emitiu.
    const empresa = Empresa.criar(dados()).unwrap();

    empresa.alterar({
      razaoSocial: "Outra Empresa Ltda",
      regimeTributario: "MEI",
      endereco: endereco(),
    });

    expect(empresa.cnpj.caracteres).toBe("11222333000181");
  });

  it("alteração inválida não muda nada", () => {
    const empresa = Empresa.criar(dados()).unwrap();

    const resultado = empresa.alterar({
      razaoSocial: "",
      regimeTributario: "MEI",
      endereco: endereco(),
    });

    expect(resultado.isErr()).toBe(true);
    expect(empresa.razaoSocial).toBe("Mercadinho Bom Preço Comércio de Alimentos Ltda");
  });
});

describe("regime tributário", () => {
  it("reconhece os quatro regimes do varejo", () => {
    expect(ehRegimeTributario("SIMPLES_NACIONAL")).toBe(true);
    expect(ehRegimeTributario("SIMPLES_EXCESSO_SUBLIMITE")).toBe(true);
    expect(ehRegimeTributario("REGIME_NORMAL")).toBe(true);
    expect(ehRegimeTributario("MEI")).toBe(true);
  });

  it("recusa o que não é regime", () => {
    expect(ehRegimeTributario("LUCRO_MARCIANO")).toBe(false);
  });
});

describe("reconstituição", () => {
  it("não revalida o que já está no banco", () => {
    // Regra que endureceu depois não pode impedir de ler o que já existe.
    const antiga = Empresa.reconstituir(dados({ razaoSocial: "M".repeat(80) }));

    expect(antiga.razaoSocial).toHaveLength(80);
  });
});
