import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Documento } from "../valores/Documento.js";
import { Email } from "../valores/Email.js";
import { Endereco } from "../valores/Endereco.js";
import { InscricaoEstadual } from "../valores/InscricaoEstadual.js";
import { Telefone } from "../valores/Telefone.js";

import { Cliente, type DadosCliente } from "./Cliente.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-c00000000001").unwrap();
const CPF = Documento.criar("529.982.247-25").unwrap();
const CNPJ = Documento.criar("11.222.333/0001-81").unwrap();

const FISICA: DadosCliente = { id: ID, nome: "Maria da Silva", tipoPessoa: "FISICA" };

function criar(dados: Partial<DadosCliente> = {}): Cliente {
  return Cliente.criar({ ...FISICA, ...dados }).unwrap();
}

function codigosDeErro(dados: Partial<DadosCliente>): string[] {
  const resultado = Cliente.criar({ ...FISICA, ...dados });

  return resultado.isErr() ? resultado.error.map((erro) => erro.codigo) : [];
}

describe("Cliente — criação", () => {
  it("nasce ativo, sem crédito e sem documento", () => {
    const cliente = criar();

    expect(cliente.ativo).toBe(true);
    expect(cliente.tipoPessoa).toBe("FISICA");
    expect(cliente.documento).toBeUndefined();
    expect(cliente.limiteCredito.ehZero()).toBe(true);
    expect(cliente.vendeAPrazo).toBe(false);
  });

  it("🔑 aceita cadastro sem documento — a LGPD pede minimização", () => {
    // A padaria que anota o fiado não precisa do CPF de quem compra pão.
    expect(Cliente.criar(FISICA).isOk()).toBe(true);
  });

  it("guarda o nome normalizado para a busca do balcão", () => {
    expect(criar({ nome: "José Antônio" }).nomeBusca).toBe("jose antonio");
  });

  it("exibe o apelido quando há, e o nome quando não há", () => {
    expect(criar().exibicao).toBe("Maria da Silva");
    expect(criar({ apelido: "Dona Maria" }).exibicao).toBe("Dona Maria");
  });

  it("trata apelido e observação vazios como não informados", () => {
    const cliente = criar({ apelido: "   ", observacao: "" });

    expect(cliente.apelido).toBeUndefined();
    expect(cliente.observacao).toBeUndefined();
  });

  it("rejeita nome vazio", () => {
    expect(codigosDeErro({ nome: " " })).toContain("CLIENTE_NOME_VAZIO");
  });

  it("rejeita nome acima do limite do destinatário na NF-e", () => {
    expect(codigosDeErro({ nome: "x".repeat(61) })).toContain("CLIENTE_NOME_LONGO");
  });

  it("rejeita apelido e observação longos demais", () => {
    const codigos = codigosDeErro({
      apelido: "x".repeat(61),
      observacao: "x".repeat(501),
    });

    expect(codigos).toContain("CLIENTE_APELIDO_LONGO");
    expect(codigos).toContain("CLIENTE_OBSERVACAO_LONGA");
  });

  it("rejeita limite de crédito negativo", () => {
    expect(
      codigosDeErro({ limiteCredito: Dinheiro.deCentavos(-100n).unwrap() }),
    ).toContain("CLIENTE_LIMITE_NEGATIVO");
  });

  it("🔑 recusa CNPJ em cadastro de pessoa física, e explica o que fazer", () => {
    const resultado = Cliente.criar({ ...FISICA, documento: CNPJ });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("CLIENTE_DOCUMENTO_INCOMPATIVEL");
      expect(resultado.error[0]?.mensagem).toContain("CPF");
    }
  });

  it("🔑 recusa CPF em cadastro de empresa — quase sempre é o CPF do sócio", () => {
    const resultado = Cliente.criar({
      id: ID,
      nome: "Mercadinho do Bairro",
      tipoPessoa: "JURIDICA",
      documento: CPF,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("CLIENTE_DOCUMENTO_INCOMPATIVEL");
      expect(resultado.error[0]?.mensagem).toContain("CNPJ");
    }
  });

  it("aceita CPF em pessoa física e CNPJ em empresa", () => {
    expect(Cliente.criar({ ...FISICA, documento: CPF }).isOk()).toBe(true);
    expect(
      Cliente.criar({
        id: ID,
        nome: "Mercadinho",
        tipoPessoa: "JURIDICA",
        documento: CNPJ,
      }).isOk(),
    ).toBe(true);
  });

  it("🔑 recusa inscrição estadual em pessoa física", () => {
    expect(codigosDeErro({ inscricaoEstadual: InscricaoEstadual.isento() })).toContain(
      "CLIENTE_IE_EM_PESSOA_FISICA",
    );
  });

  it("devolve todos os erros de uma vez", () => {
    const resultado = Cliente.criar({
      id: ID,
      nome: "",
      tipoPessoa: "FISICA",
      apelido: "x".repeat(61),
      limiteCredito: Dinheiro.deCentavos(-1n).unwrap(),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.length).toBe(3);
    }
  });

  it("reconstitui do banco sem revalidar", () => {
    const cliente = Cliente.reconstituir({
      id: ID,
      nome: "x".repeat(120),
      tipoPessoa: "FISICA",
      documento: CNPJ,
      ativo: false,
    });

    expect(cliente.ativo).toBe(false);
    expect(cliente.documento?.tipo).toBe("CNPJ");
    expect(cliente.limiteCredito.ehZero()).toBe(true);
  });
});

describe("Cliente — crédito", () => {
  const limite = Dinheiro.deReais("200,00").unwrap();

  it("indica que vende a prazo quando há limite", () => {
    expect(criar({ limiteCredito: limite }).vendeAPrazo).toBe(true);
  });

  it("desconta o que já é devido", () => {
    const cliente = criar({ limiteCredito: limite });
    const disponivel = cliente.creditoDisponivel(Dinheiro.deReais("50,00").unwrap());

    expect(disponivel.centavos).toBe(15_000n);
  });

  it("🔑 nunca devolve crédito negativo — a tela mostraria como se fosse saldo", () => {
    const cliente = criar({ limiteCredito: limite });
    const disponivel = cliente.creditoDisponivel(Dinheiro.deReais("300,00").unwrap());

    expect(disponivel.ehZero()).toBe(true);
  });

  it("altera o limite", () => {
    const cliente = criar();

    expect(cliente.definirLimiteCredito(limite).isOk()).toBe(true);
    expect(cliente.limiteCredito.equals(limite)).toBe(true);
  });

  it("recusa limite negativo", () => {
    const cliente = criar();
    const resultado = cliente.definirLimiteCredito(Dinheiro.deCentavos(-1n).unwrap());

    expect(resultado.isErr()).toBe(true);
    expect(cliente.limiteCredito.ehZero()).toBe(true);
  });
});

describe("Cliente — busca", () => {
  const cliente = criar({
    nome: "José Antônio Pereira",
    apelido: "Zé do Posto",
    documento: CPF,
    telefone: Telefone.criar("(11) 98888-7777").unwrap(),
  });

  it("encontra pelo nome sem acento", () => {
    expect(cliente.correspondeAoTermo("jose antonio")).toBe(true);
  });

  it("encontra por parte do nome", () => {
    expect(cliente.correspondeAoTermo("PEREIRA")).toBe(true);
  });

  it("🔑 encontra pelo apelido — é como a loja chama a pessoa", () => {
    expect(cliente.correspondeAoTermo("zé do posto")).toBe(true);
  });

  it("encontra pelo documento digitado com máscara", () => {
    expect(cliente.correspondeAoTermo("529.982.247-25")).toBe(true);
  });

  it("encontra pelo telefone", () => {
    expect(cliente.correspondeAoTermo("98888-7777")).toBe(true);
  });

  it("não encontra com termo vazio", () => {
    expect(cliente.correspondeAoTermo("   ")).toBe(false);
  });

  it("não encontra quem não corresponde", () => {
    expect(cliente.correspondeAoTermo("Maria")).toBe(false);
    expect(cliente.correspondeAoTermo("11122233344")).toBe(false);
  });

  it("não confunde com quem tem só nome cadastrado", () => {
    const simples = criar({ nome: "Ana" });

    expect(simples.correspondeAoTermo("99999")).toBe(false);
    expect(simples.correspondeAoTermo("Ana")).toBe(true);
  });

  it("acha pelo telefone mesmo sem documento", () => {
    const semDocumento = criar({
      nome: "Ana",
      telefone: Telefone.criar("11988887777").unwrap(),
    });

    expect(semDocumento.correspondeAoTermo("988887777")).toBe(true);
  });
});

describe("Cliente — alterações", () => {
  it("renomeia e atualiza a busca", () => {
    const cliente = criar();

    expect(cliente.renomear("Maria Aparecida", "Dona Cida").isOk()).toBe(true);
    expect(cliente.nome).toBe("Maria Aparecida");
    expect(cliente.nomeBusca).toBe("maria aparecida");
    expect(cliente.apelido).toBe("Dona Cida");
  });

  it("limpa o apelido quando não informado no rename", () => {
    const cliente = criar({ apelido: "Dona Maria" });

    cliente.renomear("Maria da Silva");
    expect(cliente.apelido).toBeUndefined();
  });

  it("recusa renomear para vazio ou longo demais", () => {
    const cliente = criar();

    expect(cliente.renomear("  ").isErr()).toBe(true);
    expect(cliente.renomear("x".repeat(61)).isErr()).toBe(true);
    expect(cliente.nome).toBe("Maria da Silva");
  });

  it("define e remove o documento, respeitando o tipo de pessoa", () => {
    const cliente = criar();

    expect(cliente.definirDocumento(CPF).isOk()).toBe(true);
    expect(cliente.documento?.valor).toBe("52998224725");

    expect(cliente.definirDocumento(CNPJ).isErr()).toBe(true);
    expect(cliente.documento?.valor).toBe("52998224725");

    expect(cliente.definirDocumento(undefined).isOk()).toBe(true);
    expect(cliente.documento).toBeUndefined();
  });

  it("define inscrição estadual só em empresa", () => {
    const empresa = Cliente.criar({
      id: ID,
      nome: "Mercadinho",
      tipoPessoa: "JURIDICA",
    }).unwrap();

    expect(empresa.definirInscricaoEstadual(InscricaoEstadual.isento()).isOk()).toBe(
      true,
    );
    expect(empresa.inscricaoEstadual?.ehIsento).toBe(true);

    const pessoa = criar();
    expect(pessoa.definirInscricaoEstadual(InscricaoEstadual.isento()).isErr()).toBe(
      true,
    );
    expect(pessoa.definirInscricaoEstadual(undefined).isOk()).toBe(true);
  });

  it("define contato e endereço", () => {
    const cliente = criar();
    const telefone = Telefone.criar("11988887777").unwrap();
    const email = Email.criar("maria@loja.com").unwrap();
    const endereco = Endereco.criar({
      logradouro: "Rua das Flores",
      numero: "10",
      bairro: "Centro",
      municipio: "Osasco",
      uf: "SP",
      cep: "06010-000",
    }).unwrap();

    cliente.definirContato(telefone, email);
    cliente.definirEndereco(endereco);

    expect(cliente.telefone?.digitos).toBe("11988887777");
    expect(cliente.email?.valor).toBe("maria@loja.com");
    expect(cliente.endereco?.municipio).toBe("Osasco");

    cliente.definirContato(undefined, undefined);
    cliente.definirEndereco(undefined);

    expect(cliente.telefone).toBeUndefined();
    expect(cliente.email).toBeUndefined();
    expect(cliente.endereco).toBeUndefined();
  });

  it("define observação e recusa a longa demais", () => {
    const cliente = criar();

    expect(cliente.definirObservacao("Prefere entrega pela manhã").isOk()).toBe(true);
    expect(cliente.observacao).toBe("Prefere entrega pela manhã");

    expect(cliente.definirObservacao("x".repeat(501)).isErr()).toBe(true);
    expect(cliente.observacao).toBe("Prefere entrega pela manhã");

    expect(cliente.definirObservacao(undefined).isOk()).toBe(true);
    expect(cliente.observacao).toBeUndefined();
  });

  it("🔑 desativa sem apagar — a nota fiscal emitida continua apontando para ele", () => {
    const cliente = criar();

    cliente.desativar();
    expect(cliente.ativo).toBe(false);

    cliente.ativar();
    expect(cliente.ativo).toBe(true);
  });
});
