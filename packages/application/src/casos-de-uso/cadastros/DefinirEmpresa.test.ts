import type { DadosEndereco } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";

import { DefinirEmpresa, type EntradaDefinirEmpresa } from "./DefinirEmpresa.js";

/**
 * Cadastro da empresa da instalação.
 *
 * O risco aqui não é a tela: é o segundo salvamento. Se ele criar uma linha
 * nova em vez de atualizar a que existe, o cupom passa a sair com o cadastro
 * antigo — e ninguém percebe até o cliente reclamar do endereço errado.
 */

function endereco(municipio = "Campinas"): DadosEndereco {
  return {
    logradouro: "Rua das Flores",
    numero: "120",
    bairro: "Centro",
    municipio,
    uf: "SP",
    cep: "13010-000",
  };
}

function entrada(
  sobrescritas: Partial<EntradaDefinirEmpresa> = {},
): EntradaDefinirEmpresa {
  return {
    razaoSocial: "Mercadinho Bom Preço Ltda",
    nomeFantasia: "Bom Preço",
    cnpj: "11.222.333/0001-81",
    inscricaoEstadual: "110042490114",
    regimeTributario: "SIMPLES_NACIONAL",
    endereco: endereco(),
    ...sobrescritas,
  };
}

function montar() {
  const ambiente = montarAmbiente();

  return {
    ...ambiente,
    definirEmpresa: new DefinirEmpresa(ambiente.unitOfWork, ambiente.geradorId),
  };
}

let cenario: ReturnType<typeof montar>;

beforeEach(() => {
  cenario = montar();
});

describe("primeiro cadastro", () => {
  it("grava a empresa e passa a respondê-la na consulta", async () => {
    const resultado = await cenario.definirEmpresa.executar(entrada());

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().exibicao).toBe("Bom Preço");

    const guardada = await cenario.empresa.atual();
    expect(guardada?.cnpj.caracteres).toBe("11222333000181");
    expect(guardada?.endereco.municipio).toBe("Campinas");
  });

  it("guarda contato e inscrição municipal quando informados", async () => {
    const resultado = await cenario.definirEmpresa.executar(
      entrada({
        telefone: "(19) 3888-7777",
        email: "contato@bompreco.com.br",
        inscricaoMunicipal: "123456",
      }),
    );

    const empresa = resultado.unwrap();
    expect(empresa.telefone?.digitos).toBe("1938887777");
    expect(empresa.email?.valor).toBe("contato@bompreco.com.br");
    expect(empresa.inscricaoMunicipal).toBe("123456");
  });

  it("MEI sem inscrição estadual está apto a emitir", async () => {
    const resultado = await cenario.definirEmpresa.executar(
      entrada({ inscricaoEstadual: undefined, regimeTributario: "MEI" }),
    );

    expect(resultado.unwrap().aptaAEmitir).toBe(true);
  });

  it("recusa entrada inválida sem gravar nada", async () => {
    const resultado = await cenario.definirEmpresa.executar(
      entrada({ razaoSocial: "   " }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMPRESA_RAZAO_SOCIAL_VAZIA");
    }
    expect(await cenario.empresa.atual()).toBeUndefined();
  });

  it("🔑 recusa CPF no lugar do CNPJ", async () => {
    // Aceitá-lo produziria um cadastro que nunca consegue emitir, e o lojista
    // só descobriria no dia da primeira nota.
    const resultado = await cenario.definirEmpresa.executar(
      entrada({ cnpj: "529.982.247-25" }),
    );

    expect(resultado.isErr()).toBe(true);
    expect(await cenario.empresa.atual()).toBeUndefined();
  });

  it("exige o CNPJ na primeira vez", async () => {
    const resultado = await cenario.definirEmpresa.executar(entrada({ cnpj: undefined }));

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMPRESA_CNPJ_OBRIGATORIO");
    }
  });

  it("🔑 exige endereço, ao contrário dos demais cadastros", async () => {
    // É o endereço do emitente: sai no cupom e no cabeçalho de todo relatório
    // impresso, mesmo com o módulo fiscal desligado.
    const resultado = await cenario.definirEmpresa.executar(
      entrada({ endereco: { ...endereco(), cep: "" } }),
    );

    expect(resultado.isErr()).toBe(true);
    expect(await cenario.empresa.atual()).toBeUndefined();
  });
});

describe("segundo cadastro", () => {
  it("🔑 atualiza a empresa que existe em vez de criar outra", async () => {
    // O índice único no banco recusaria a segunda linha — e o erro chegaria ao
    // lojista como falha técnica, no meio de uma correção de endereço.
    const primeira = await cenario.definirEmpresa.executar(entrada());

    const segunda = await cenario.definirEmpresa.executar(
      entrada({ razaoSocial: "Bom Preço Alimentos Ltda", endereco: endereco("Osasco") }),
    );

    expect(segunda.isOk()).toBe(true);
    expect(segunda.unwrap().id.valor).toBe(primeira.unwrap().id.valor);

    const guardada = await cenario.empresa.atual();
    expect(guardada?.razaoSocial).toBe("Bom Preço Alimentos Ltda");
    expect(guardada?.endereco.municipio).toBe("Osasco");
  });

  it("🔑 o CNPJ informado depois é ignorado", async () => {
    // Trocá-lo não é corrigir cadastro: é outra empresa. As notas já emitidas
    // passariam a apontar para um emitente que nunca as emitiu.
    await cenario.definirEmpresa.executar(entrada());

    const segunda = await cenario.definirEmpresa.executar(
      entrada({ cnpj: "19.131.243/0001-97" }),
    );

    expect(segunda.isOk()).toBe(true);
    expect((await cenario.empresa.atual())?.cnpj.caracteres).toBe("11222333000181");
  });

  it("🔑 campo apagado na tela some do cadastro", async () => {
    // Caso de uso que trata ausente como "não mexer" deixa o lojista preso ao
    // telefone errado que ele acabou de limpar.
    await cenario.definirEmpresa.executar(entrada({ telefone: "1938887777" }));

    await cenario.definirEmpresa.executar(entrada({ telefone: undefined }));

    expect((await cenario.empresa.atual())?.telefone).toBeUndefined();
  });

  it("alteração inválida não corrompe o que já estava gravado", async () => {
    await cenario.definirEmpresa.executar(entrada());

    const resultado = await cenario.definirEmpresa.executar(
      entrada({ razaoSocial: "M".repeat(61) }),
    );

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("EMPRESA_RAZAO_SOCIAL_LONGA");
    }
    expect((await cenario.empresa.atual())?.razaoSocial).toBe(
      "Mercadinho Bom Preço Ltda",
    );
  });

  it("telefone inválido recusa a alteração inteira", async () => {
    await cenario.definirEmpresa.executar(entrada());

    const resultado = await cenario.definirEmpresa.executar(entrada({ telefone: "123" }));

    expect(resultado.isErr()).toBe(true);
    expect((await cenario.empresa.atual())?.razaoSocial).toBe(
      "Mercadinho Bom Preço Ltda",
    );
  });

  it("endereço inválido não apaga o endereço que estava certo", async () => {
    await cenario.definirEmpresa.executar(entrada());

    const resultado = await cenario.definirEmpresa.executar(
      entrada({ endereco: { ...endereco("Osasco"), cep: "" } }),
    );

    expect(resultado.isErr()).toBe(true);
    expect((await cenario.empresa.atual())?.endereco.municipio).toBe("Campinas");
  });
});
