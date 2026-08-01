import {
  CNPJ,
  Email,
  Empresa,
  Endereco,
  Identificador,
  InscricaoEstadual,
  Telefone,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EmpresaRepositorioPrisma } from "../repositorios/EmpresaRepositorioPrisma.js";

import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

/**
 * A empresa da instalação, contra o PostgreSQL de verdade.
 *
 * O que só o banco prova: o índice único sobre `unica` — a garantia, em nível
 * de esquema, de que nunca existirão duas empresas nesta instalação
 * (ADR-0024). Um repositório em memória aceitaria a segunda linha sem
 * reclamar, e o defeito só apareceria em produção como cadastro fantasma.
 */

const prisma = criarClienteDeTeste();

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3e7${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

function repositorio(): EmpresaRepositorioPrisma {
  return new EmpresaRepositorioPrisma(prisma);
}

function endereco(municipio = "Piracicaba"): Endereco {
  return Endereco.criar({
    logradouro: "Avenida Independência",
    numero: "1500",
    complemento: "Loja 2",
    bairro: "Centro",
    municipio,
    codigoMunicipioIbge: "3538709",
    uf: "SP",
    cep: "13400000",
  }).unwrap();
}

function empresa(sobrescritas: Partial<Parameters<typeof Empresa.criar>[0]> = {}) {
  return Empresa.criar({
    id: proximoId(),
    razaoSocial: "Mercadinho Bom Preço Ltda",
    nomeFantasia: "Bom Preço",
    cnpj: CNPJ.criar("11222333000181").unwrap(),
    inscricaoEstadual: InscricaoEstadual.criar("110042490114").unwrap(),
    regimeTributario: "SIMPLES_NACIONAL",
    endereco: endereco(),
    ...sobrescritas,
  }).unwrap();
}

beforeAll(() => {
  prepararBanco();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
});

describe("EmpresaRepositorioPrisma", () => {
  it("sem cadastro, não há empresa", async () => {
    expect(await repositorio().atual()).toBeUndefined();
  });

  it("grava e relê com todos os campos", async () => {
    await repositorio().salvar(
      empresa({
        inscricaoMunicipal: "998877",
        telefone: Telefone.criar("1938887777").unwrap(),
        email: Email.criar("contato@bompreco.com.br").unwrap(),
      }),
    );

    const lida = await repositorio().atual();

    expect(lida?.razaoSocial).toBe("Mercadinho Bom Preço Ltda");
    expect(lida?.nomeFantasia).toBe("Bom Preço");
    expect(lida?.cnpj.caracteres).toBe("11222333000181");
    expect(lida?.inscricaoEstadual?.valor).toBe("110042490114");
    expect(lida?.inscricaoMunicipal).toBe("998877");
    expect(lida?.regimeTributario).toBe("SIMPLES_NACIONAL");
    expect(lida?.telefone?.digitos).toBe("1938887777");
    expect(lida?.email?.valor).toBe("contato@bompreco.com.br");
  });

  it("🔑 o endereço volta inteiro — é o cabeçalho de todo relatório impresso", async () => {
    await repositorio().salvar(empresa());

    const lido = (await repositorio().atual())?.endereco;

    expect(lido?.logradouro).toBe("Avenida Independência");
    expect(lido?.numero).toBe("1500");
    expect(lido?.complemento).toBe("Loja 2");
    expect(lido?.bairro).toBe("Centro");
    expect(lido?.municipio).toBe("Piracicaba");
    expect(lido?.codigoMunicipioIbge).toBe("3538709");
    expect(lido?.uf).toBe("SP");
    expect(lido?.cep).toBe("13400000");
  });

  it("campos opcionais ausentes voltam ausentes, não vazios", async () => {
    // Inclui o complemento e o código IBGE: gravá-los como string vazia em vez
    // de `NULL` faria o endereço voltar com "" no cupom, e a coluna do IBGE
    // deixaria de ser reconhecida como pendência quando o fiscal entrar.
    await repositorio().salvar(
      empresa({
        nomeFantasia: undefined,
        inscricaoEstadual: undefined,
        regimeTributario: "MEI",
        endereco: Endereco.criar({
          logradouro: "Avenida Independência",
          numero: "1500",
          bairro: "Centro",
          municipio: "Piracicaba",
          uf: "SP",
          cep: "13400000",
        }).unwrap(),
      }),
    );

    const lida = await repositorio().atual();

    expect(lida?.nomeFantasia).toBeUndefined();
    expect(lida?.inscricaoEstadual).toBeUndefined();
    expect(lida?.inscricaoMunicipal).toBeUndefined();
    expect(lida?.telefone).toBeUndefined();
    expect(lida?.email).toBeUndefined();
    expect(lida?.endereco.complemento).toBeUndefined();
    expect(lida?.endereco.codigoMunicipioIbge).toBeUndefined();
    expect(lida?.aptaAEmitir).toBe(true);
  });

  it("🔑 salvar de novo atualiza a linha existente, sem violar o índice único", async () => {
    // É o caminho normal: o lojista corrige o endereço meses depois. Se isto
    // tentasse inserir, o banco recusaria e ele veria uma falha técnica.
    const original = empresa();
    await repositorio().salvar(original);

    const alterada = empresa({ razaoSocial: "Bom Preço Alimentos Ltda" });
    await repositorio().salvar(alterada);

    const lida = await repositorio().atual();
    expect(lida?.razaoSocial).toBe("Bom Preço Alimentos Ltda");
    // O id é o da primeira gravação: o `upsert` casa por `unica`, então o
    // identificador que a tela gerou de novo não substitui o que já existe.
    expect(lida?.id.valor).toBe(original.id.valor);
    expect(await prisma.empresa.count()).toBe(1);
  });

  it("🔑 o índice único impede duas empresas na mesma instalação", async () => {
    // A garantia é do esquema, não do repositório: qualquer caminho futuro que
    // insira direto encontra a mesma parede (ADR-0024).
    await repositorio().salvar(empresa());

    await expect(
      prisma.empresa.create({
        data: {
          id: proximoId().valor,
          unica: true,
          razaoSocial: "Outra Empresa Ltda",
          razaoSocialBusca: "outra empresa ltda",
          cnpj: "19131243000197",
          regimeTributario: "REGIME_NORMAL",
          logradouro: "Rua B",
          numero: "1",
          bairro: "Centro",
          municipio: "Osasco",
          uf: "SP",
          cep: "06010000",
        },
      }),
    ).rejects.toThrow();
  });

  it("🔑 regime desconhecido no banco cai em regime normal, não derruba a leitura", async () => {
    // Coluna gravada por versão futura, ou corrompida na mão. Estourar aqui
    // impediria o lojista até de abrir a tela para corrigir — e errar para o
    // regime normal cobra imposto a mais, que aparece na conferência.
    await repositorio().salvar(empresa());
    await prisma.$executeRawUnsafe(
      `UPDATE "empresas" SET "regime_tributario" = 'LUCRO_MARCIANO'`,
    );

    expect((await repositorio().atual())?.regimeTributario).toBe("REGIME_NORMAL");
  });
});
