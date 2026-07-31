import {
  Categoria,
  Cliente,
  Dinheiro,
  Documento,
  Email,
  Endereco,
  Fornecedor,
  Identificador,
  InscricaoEstadual,
  Telefone,
} from "@erp/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CategoriaRepositorioPrisma,
  ClienteRepositorioPrisma,
  FornecedorRepositorioPrisma,
} from "../repositorios/CadastroRepositorioPrisma.js";
import { criarClienteDeTeste, limparBanco, prepararBanco } from "./banco.js";

const prisma = criarClienteDeTeste();

let sequencia = 0;
function proximoId(): Identificador {
  sequencia += 1;
  return Identificador.criar(
    `018f3a2b-7c1d-7e4f-8a9b-1c2d3e6${sequencia.toString().padStart(5, "0")}`,
  ).unwrap();
}

function categorias(): CategoriaRepositorioPrisma {
  return new CategoriaRepositorioPrisma(prisma);
}

function clientes(): ClienteRepositorioPrisma {
  return new ClienteRepositorioPrisma(prisma);
}

function fornecedores(): FornecedorRepositorioPrisma {
  return new FornecedorRepositorioPrisma(prisma);
}

function endereco(): Endereco {
  return Endereco.criar({
    logradouro: "Rua das Acácias",
    numero: "120",
    complemento: "Fundos",
    bairro: "Centro",
    municipio: "Piracicaba",
    codigoMunicipioIbge: "3538709",
    uf: "SP",
    cep: "13400000",
  }).unwrap();
}

function cliente(sobrescritas: Partial<Parameters<typeof Cliente.criar>[0]> = {}) {
  return Cliente.criar({
    id: proximoId(),
    nome: "Ana Maria de Souza",
    tipoPessoa: "FISICA",
    ...sobrescritas,
  }).unwrap();
}

function fornecedor(sobrescritas: Partial<Parameters<typeof Fornecedor.criar>[0]> = {}) {
  return Fornecedor.criar({
    id: proximoId(),
    razaoSocial: "Distribuidora Bebidas Boas Ltda",
    documento: Documento.criar("11222333000181").unwrap(),
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

describe("Categoria", () => {
  it("grava e lê de volta", async () => {
    const repo = categorias();
    const categoria = Categoria.criar({ id: proximoId(), nome: "Bebidas" }).unwrap();

    await repo.salvar(categoria);

    const lida = await repo.porId(categoria.id);
    expect(lida?.nome).toBe("Bebidas");
    expect(lida?.ativa).toBe(true);
  });

  it("🔑 acha pelo nome normalizado, não pelo texto digitado", async () => {
    // "Bebidas" e "bebidas " coexistindo parecem a mesma categoria na tela e
    // dividem o faturamento em duas linhas do relatório.
    const repo = categorias();
    await repo.salvar(Categoria.criar({ id: proximoId(), nome: "Bebidas" }).unwrap());

    expect((await repo.porNome("  BEBIDAS  "))?.nome).toBe("Bebidas");
    expect((await repo.porNome("bebidas"))?.nome).toBe("Bebidas");
  });

  it("🔑 o banco recusa a categoria repetida, não só a aplicação", async () => {
    // A verificação na aplicação perde a corrida entre duas telas abertas ao
    // mesmo tempo. A unicidade tem que estar na tabela.
    const repo = categorias();
    await repo.salvar(Categoria.criar({ id: proximoId(), nome: "Bebidas" }).unwrap());

    await expect(
      repo.salvar(Categoria.criar({ id: proximoId(), nome: "bebidas" }).unwrap()),
    ).rejects.toThrow();
  });

  it("devolve indefinido para nome que não existe", async () => {
    expect(await categorias().porNome("Inexistente")).toBeUndefined();
    expect(await categorias().porId(proximoId())).toBeUndefined();
  });

  it("listar filtra as inativas quando pedido", async () => {
    const repo = categorias();
    await repo.salvar(Categoria.criar({ id: proximoId(), nome: "Bebidas" }).unwrap());
    await repo.salvar(
      Categoria.criar({ id: proximoId(), nome: "Descontinuados", ativa: false }).unwrap(),
    );

    expect(await repo.listar(true)).toHaveLength(1);
    expect(await repo.listar(false)).toHaveLength(2);
  });

  it("salvar de novo atualiza em vez de duplicar", async () => {
    const repo = categorias();
    const categoria = Categoria.criar({ id: proximoId(), nome: "Bebidas" }).unwrap();
    await repo.salvar(categoria);

    categoria.desativar();
    await repo.salvar(categoria);

    expect((await repo.porId(categoria.id))?.ativa).toBe(false);
    expect(await repo.listar(false)).toHaveLength(1);
  });
});

describe("Cliente", () => {
  it("🔑 grava o cliente mínimo — sem documento, por minimização da LGPD", async () => {
    // A padaria que anota o fiado não precisa do CPF de quem compra.
    const repo = clientes();
    const anotado = cliente();

    await repo.salvar(anotado);

    const lido = await repo.porId(anotado.id);
    expect(lido?.nome).toBe("Ana Maria de Souza");
    expect(lido?.documento).toBeUndefined();
    expect(lido?.limiteCredito.ehZero()).toBe(true);
  });

  it("preserva todos os campos opcionais na ida e na volta", async () => {
    const repo = clientes();
    const completo = cliente({
      apelido: "Aninha",
      documento: Documento.criar("52998224725").unwrap(),
      telefone: Telefone.criar("19998887766").unwrap(),
      email: Email.criar("ana@exemplo.com.br").unwrap(),
      endereco: endereco(),
      limiteCredito: Dinheiro.deReais("500,00").unwrap(),
      observacao: "Cliente antigo, paga no dia 10",
    });

    await repo.salvar(completo);
    const lido = await repo.porId(completo.id);

    expect(lido?.apelido).toBe("Aninha");
    expect(lido?.documento?.valor).toBe("52998224725");
    expect(lido?.telefone?.digitos).toBe("19998887766");
    expect(lido?.email?.valor).toBe("ana@exemplo.com.br");
    expect(lido?.endereco?.municipio).toBe("Piracicaba");
    expect(lido?.endereco?.complemento).toBe("Fundos");
    expect(lido?.limiteCredito.formatar()).toBe("R$ 500,00");
    expect(lido?.observacao).toBe("Cliente antigo, paga no dia 10");
  });

  it("🔑 o limite de crédito volta em centavos exatos", async () => {
    // É o teto do fiado. Errar aqui por arredondamento significa autorizar
    // venda a prazo acima do que o dono decidiu.
    const repo = clientes();
    const comLimite = cliente({ limiteCredito: Dinheiro.deReais("1234,56").unwrap() });

    await repo.salvar(comLimite);

    expect((await repo.porId(comLimite.id))?.limiteCredito.centavos).toBe(123456n);
  });

  it("🔑 acha pelo documento — é o que impede o cadastro em duplicidade", async () => {
    // O atendente não acha o cliente, cadastra de novo, e o histórico de compra
    // fica dividido entre dois registros que ninguém junta depois.
    const repo = clientes();
    const documento = Documento.criar("52998224725").unwrap();
    await repo.salvar(cliente({ documento }));

    expect((await repo.porDocumento(documento))?.nome).toBe("Ana Maria de Souza");
  });

  it("o banco recusa o mesmo documento duas vezes", async () => {
    const repo = clientes();
    const documento = Documento.criar("52998224725").unwrap();
    await repo.salvar(cliente({ documento }));

    await expect(
      repo.salvar(cliente({ nome: "Outra Pessoa", documento })),
    ).rejects.toThrow();
  });

  it("documento inexistente devolve indefinido", async () => {
    const repo = clientes();
    expect(
      await repo.porDocumento(Documento.criar("52998224725").unwrap()),
    ).toBeUndefined();
  });

  it("busca por prefixo, ignorando acento e caixa", async () => {
    const repo = clientes();
    await repo.salvar(cliente({ nome: "Ângela Ribeiro" }));
    await repo.salvar(cliente({ nome: "Bruno Alves" }));

    const achados = await repo.buscar({ termo: "ANGE", limite: 20 });

    expect(achados).toHaveLength(1);
    expect(achados[0]?.nome).toBe("Ângela Ribeiro");
  });

  it("🔑 termo vazio devolve os primeiros, nunca todos", async () => {
    // Uma loja com dez mil clientes não pode montar uma consulta que devolva
    // dez mil linhas para uma lista que mostra vinte.
    const repo = clientes();
    for (const nome of ["Ana", "Bruno", "Carla", "Diego"]) {
      await repo.salvar(cliente({ nome }));
    }

    expect(await repo.buscar({ limite: 2 })).toHaveLength(2);
  });

  it("🔑 o limite pedido é teto, e existe um teto acima dele", async () => {
    // A porta exige limite, mas quem chama pode errar. Limite absurdo não vira
    // varredura da tabela inteira.
    const repo = clientes();
    for (const nome of ["Ana", "Bruno", "Carla"]) {
      await repo.salvar(cliente({ nome }));
    }

    expect(await repo.buscar({ limite: 10_000 })).toHaveLength(3);
    expect(await repo.buscar({ limite: 0 })).toHaveLength(1);
  });

  it("filtra inativos quando pedido", async () => {
    const repo = clientes();
    const inativo = cliente({ nome: "Carlos Antigo" });
    inativo.desativar();

    await repo.salvar(cliente({ nome: "Carla Nova" }));
    await repo.salvar(inativo);

    expect(await repo.buscar({ termo: "car", limite: 20 })).toHaveLength(2);
    expect(
      await repo.buscar({ termo: "car", apenasAtivos: true, limite: 20 }),
    ).toHaveLength(1);
  });

  it("pessoa jurídica volta como jurídica", async () => {
    const repo = clientes();
    const empresa = cliente({
      nome: "Padaria do Bairro Ltda",
      tipoPessoa: "JURIDICA",
      documento: Documento.criar("11222333000181").unwrap(),
      inscricaoEstadual: InscricaoEstadual.criar("ISENTO").unwrap(),
    });

    await repo.salvar(empresa);

    const lida = await repo.porId(empresa.id);
    expect(lida?.tipoPessoa).toBe("JURIDICA");
    expect(lida?.inscricaoEstadual?.ehIsento).toBe(true);
  });

  it("id inexistente devolve indefinido", async () => {
    expect(await clientes().porId(proximoId())).toBeUndefined();
  });

  it("🔑 endereço sem complemento e sem código do IBGE volta inteiro", async () => {
    // São os dois campos que o balcão realmente deixa em branco. Se o
    // mapeamento tropeçasse neles, o endereço inteiro voltaria vazio.
    const repo = clientes();
    const simples = cliente({
      endereco: Endereco.criar({
        logradouro: "Avenida Brasil",
        numero: "S/N",
        bairro: "Vila Nova",
        municipio: "Limeira",
        uf: "SP",
        cep: "13480000",
      }).unwrap(),
    });

    await repo.salvar(simples);
    const lido = await repo.porId(simples.id);

    expect(lido?.endereco?.logradouro).toBe("Avenida Brasil");
    expect(lido?.endereco?.complemento).toBeUndefined();
    expect(lido?.endereco?.codigoMunicipioIbge).toBeUndefined();
    expect(lido?.endereco?.cep).toBe("13480000");
  });
});

describe("Fornecedor", () => {
  it("grava com o documento obrigatório e lê de volta", async () => {
    const repo = fornecedores();
    const distribuidora = fornecedor();

    await repo.salvar(distribuidora);

    const lido = await repo.porId(distribuidora.id);
    expect(lido?.razaoSocial).toBe("Distribuidora Bebidas Boas Ltda");
    expect(lido?.documento.valor).toBe("11222333000181");
  });

  it("preserva os opcionais e o endereço", async () => {
    const repo = fornecedores();
    const completo = fornecedor({
      nomeFantasia: "Bebidas Boas",
      inscricaoEstadual: InscricaoEstadual.criar("123456789012").unwrap(),
      telefone: Telefone.criar("1938887766").unwrap(),
      email: Email.criar("compras@bebidasboas.com.br").unwrap(),
      endereco: endereco(),
      prazoEntregaDias: 7,
      observacao: "Entrega às terças",
    });

    await repo.salvar(completo);
    const lido = await repo.porId(completo.id);

    expect(lido?.nomeFantasia).toBe("Bebidas Boas");
    expect(lido?.inscricaoEstadual?.valor).toBe("123456789012");
    expect(lido?.telefone?.digitos).toBe("1938887766");
    expect(lido?.email?.valor).toBe("compras@bebidasboas.com.br");
    expect(lido?.endereco?.uf).toBe("SP");
    expect(lido?.prazoEntregaDias).toBe(7);
    expect(lido?.observacao).toBe("Entrega às terças");
  });

  it("🔑 o banco recusa o mesmo CNPJ duas vezes", async () => {
    // O comprador não acha o fornecedor, cadastra de novo, e o histórico de
    // compra do produto fica dividido entre dois registros.
    const repo = fornecedores();
    await repo.salvar(fornecedor());

    await expect(
      repo.salvar(fornecedor({ razaoSocial: "Outra Razão Social Ltda" })),
    ).rejects.toThrow();
  });

  it("acha pelo documento", async () => {
    const repo = fornecedores();
    const documento = Documento.criar("11222333000181").unwrap();
    await repo.salvar(fornecedor({ documento }));

    expect((await repo.porDocumento(documento))?.razaoSocial).toBe(
      "Distribuidora Bebidas Boas Ltda",
    );
  });

  it("documento e id inexistentes devolvem indefinido", async () => {
    const repo = fornecedores();
    expect(
      await repo.porDocumento(Documento.criar("52998224725").unwrap()),
    ).toBeUndefined();
    expect(await repo.porId(proximoId())).toBeUndefined();
  });

  it("🔑 produtor rural fornece com CPF, e o cadastro aceita", async () => {
    // O hortifruti compra do sitiante da região. Exigir CNPJ deixaria de fora
    // o fornecedor principal de um segmento inteiro.
    const repo = fornecedores();
    const sitiante = fornecedor({
      razaoSocial: "João da Silva Produtor",
      documento: Documento.criar("52998224725").unwrap(),
    });

    await repo.salvar(sitiante);

    expect((await repo.porId(sitiante.id))?.documento.ehPessoaFisica).toBe(true);
  });

  it("busca por prefixo da razão social e filtra inativos", async () => {
    const repo = fornecedores();
    const antigo = fornecedor({
      razaoSocial: "Distribuidora Antiga Ltda",
      documento: Documento.criar("11444777000161").unwrap(),
    });
    antigo.desativar();

    await repo.salvar(fornecedor());
    await repo.salvar(antigo);

    expect(await repo.buscar({ termo: "distribuidora", limite: 20 })).toHaveLength(2);
    expect(
      await repo.buscar({ termo: "distribuidora", apenasAtivos: true, limite: 20 }),
    ).toHaveLength(1);
    expect(await repo.buscar({ limite: 20 })).toHaveLength(2);
  });

  it("salvar de novo atualiza em vez de duplicar", async () => {
    const repo = fornecedores();
    const distribuidora = fornecedor();
    await repo.salvar(distribuidora);

    distribuidora.desativar();
    await repo.salvar(distribuidora);

    expect((await repo.porId(distribuidora.id))?.ativo).toBe(false);
    expect(await repo.buscar({ limite: 20 })).toHaveLength(1);
  });
});
