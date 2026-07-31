import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Documento } from "../valores/Documento.js";
import { Email } from "../valores/Email.js";
import { Endereco } from "../valores/Endereco.js";
import { InscricaoEstadual } from "../valores/InscricaoEstadual.js";
import { Telefone } from "../valores/Telefone.js";

import { type DadosFornecedor, Fornecedor } from "./Fornecedor.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-c00000000002").unwrap();
const CNPJ = Documento.criar("11.222.333/0001-81").unwrap();
const CPF = Documento.criar("529.982.247-25").unwrap();

const BASE: DadosFornecedor = {
  id: ID,
  razaoSocial: "Distribuidora Bebidas do Vale Ltda",
  documento: CNPJ,
};

function criar(dados: Partial<DadosFornecedor> = {}): Fornecedor {
  return Fornecedor.criar({ ...BASE, ...dados }).unwrap();
}

function codigosDeErro(dados: Partial<DadosFornecedor>): string[] {
  const resultado = Fornecedor.criar({ ...BASE, ...dados });

  return resultado.isErr() ? resultado.error.map((erro) => erro.codigo) : [];
}

describe("Fornecedor — criação", () => {
  it("nasce ativo", () => {
    expect(criar().ativo).toBe(true);
  });

  it("guarda a razão social normalizada para a busca", () => {
    expect(criar({ razaoSocial: "Atacadão São José" }).razaoSocialBusca).toBe(
      "atacadao sao jose",
    );
  });

  it("exibe o nome fantasia quando há", () => {
    expect(criar().exibicao).toBe("Distribuidora Bebidas do Vale Ltda");
    expect(criar({ nomeFantasia: "Vale Bebidas" }).exibicao).toBe("Vale Bebidas");
  });

  it("🔑 aceita CPF — o hortifruti compra do sitiante da região", () => {
    const produtorRural = criar({ documento: CPF });

    expect(produtorRural.documento.ehPessoaFisica).toBe(true);
  });

  it("rejeita razão social vazia", () => {
    const resultado = Fornecedor.criar({ ...BASE, razaoSocial: "  " });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("FORNECEDOR_RAZAO_SOCIAL_VAZIA");
    }
  });

  it("rejeita razão social e fantasia longas demais", () => {
    const codigos = codigosDeErro({
      razaoSocial: "x".repeat(61),
      nomeFantasia: "x".repeat(61),
    });

    expect(codigos).toContain("FORNECEDOR_RAZAO_SOCIAL_LONGA");
    expect(codigos).toContain("FORNECEDOR_FANTASIA_LONGA");
  });

  it("rejeita observação longa demais", () => {
    expect(codigosDeErro({ observacao: "x".repeat(501) })).toContain(
      "FORNECEDOR_OBSERVACAO_LONGA",
    );
  });

  it("aceita prazo de entrega em dias", () => {
    expect(criar({ prazoEntregaDias: 7 }).prazoEntregaDias).toBe(7);
    expect(criar({ prazoEntregaDias: 0 }).prazoEntregaDias).toBe(0);
  });

  it.each([-1, 1.5, 181])("rejeita prazo de entrega %s", (dias) => {
    expect(codigosDeErro({ prazoEntregaDias: dias })).toHaveLength(1);
  });

  it("🔑 recusa prazo longo demais — costuma ser data no lugar de dias", () => {
    const resultado = Fornecedor.criar({ ...BASE, prazoEntregaDias: 20_260_731 });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error[0]?.codigo).toBe("FORNECEDOR_PRAZO_LONGO");
    }
  });

  it("trata fantasia e observação vazias como não informadas", () => {
    const fornecedor = criar({ nomeFantasia: "  ", observacao: "" });

    expect(fornecedor.nomeFantasia).toBeUndefined();
    expect(fornecedor.observacao).toBeUndefined();
  });

  it("devolve todos os erros de uma vez", () => {
    const resultado = Fornecedor.criar({
      ...BASE,
      razaoSocial: "x".repeat(61),
      nomeFantasia: "y".repeat(61),
      prazoEntregaDias: -3,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.length).toBe(3);
    }
  });

  it("reconstitui do banco sem revalidar", () => {
    const fornecedor = Fornecedor.reconstituir({
      ...BASE,
      razaoSocial: "x".repeat(120),
      ativo: false,
    });

    expect(fornecedor.ativo).toBe(false);
    expect(fornecedor.razaoSocial).toHaveLength(120);
  });
});

describe("Fornecedor — busca", () => {
  const fornecedor = criar({
    razaoSocial: "Distribuidora São José Ltda",
    nomeFantasia: "Zé Distribuidora",
    telefone: Telefone.criar("(11) 3888-7777").unwrap(),
  });

  it("encontra pela razão social sem acento", () => {
    expect(fornecedor.correspondeAoTermo("sao jose")).toBe(true);
  });

  it("encontra pelo nome fantasia", () => {
    expect(fornecedor.correspondeAoTermo("zé distribuidora")).toBe(true);
  });

  it("🔑 encontra pelo CNPJ da nota, que é o dado que não vem abreviado", () => {
    expect(fornecedor.correspondeAoTermo("11.222.333/0001-81")).toBe(true);
  });

  it("encontra pelo telefone", () => {
    expect(fornecedor.correspondeAoTermo("3888-7777")).toBe(true);
  });

  it("não encontra com termo vazio nem com termo alheio", () => {
    expect(fornecedor.correspondeAoTermo(" ")).toBe(false);
    expect(fornecedor.correspondeAoTermo("Atacadão")).toBe(false);
    expect(fornecedor.correspondeAoTermo("99999999")).toBe(false);
  });

  it("não quebra em fornecedor sem fantasia nem telefone", () => {
    const simples = criar({ razaoSocial: "Atacado Central" });

    expect(simples.correspondeAoTermo("central")).toBe(true);
    expect(simples.correspondeAoTermo("55555")).toBe(false);
  });
});

describe("Fornecedor — alterações", () => {
  it("renomeia e atualiza a busca", () => {
    const fornecedor = criar();

    expect(fornecedor.renomear("Novo Atacado Ltda", "Novo Atacado").isOk()).toBe(true);
    expect(fornecedor.razaoSocialBusca).toBe("novo atacado ltda");
    expect(fornecedor.nomeFantasia).toBe("Novo Atacado");
  });

  it("limpa a fantasia quando não informada no rename", () => {
    const fornecedor = criar({ nomeFantasia: "Vale" });

    fornecedor.renomear("Distribuidora Vale Ltda");
    expect(fornecedor.nomeFantasia).toBeUndefined();
  });

  it("recusa renomear para vazio ou longo demais", () => {
    const fornecedor = criar();

    expect(fornecedor.renomear(" ").isErr()).toBe(true);
    expect(fornecedor.renomear("x".repeat(61)).isErr()).toBe(true);
    expect(fornecedor.razaoSocial).toBe("Distribuidora Bebidas do Vale Ltda");
  });

  it("troca o documento", () => {
    const fornecedor = criar();

    fornecedor.definirDocumento(CPF);
    expect(fornecedor.documento.valor).toBe("52998224725");
  });

  it("define e remove a inscrição estadual", () => {
    const fornecedor = criar();

    fornecedor.definirInscricaoEstadual(InscricaoEstadual.isento());
    expect(fornecedor.inscricaoEstadual?.ehIsento).toBe(true);

    fornecedor.definirInscricaoEstadual(undefined);
    expect(fornecedor.inscricaoEstadual).toBeUndefined();
  });

  it("define contato e endereço", () => {
    const fornecedor = criar();
    const endereco = Endereco.criar({
      logradouro: "Rodovia Anhanguera",
      numero: "km 30",
      bairro: "Distrito Industrial",
      municipio: "Jundiaí",
      uf: "SP",
      cep: "13200-000",
    }).unwrap();

    fornecedor.definirContato(
      Telefone.criar("1138887777").unwrap(),
      Email.criar("vendas@vale.com").unwrap(),
    );
    fornecedor.definirEndereco(endereco);

    expect(fornecedor.telefone?.digitos).toBe("1138887777");
    expect(fornecedor.email?.valor).toBe("vendas@vale.com");
    expect(fornecedor.endereco?.municipio).toBe("Jundiaí");

    fornecedor.definirContato(undefined, undefined);
    fornecedor.definirEndereco(undefined);

    expect(fornecedor.telefone).toBeUndefined();
    expect(fornecedor.endereco).toBeUndefined();
  });

  it("define o prazo de entrega e recusa valor inválido", () => {
    const fornecedor = criar();

    expect(fornecedor.definirPrazoEntrega(15).isOk()).toBe(true);
    expect(fornecedor.prazoEntregaDias).toBe(15);

    expect(fornecedor.definirPrazoEntrega(-1).isErr()).toBe(true);
    expect(fornecedor.prazoEntregaDias).toBe(15);

    expect(fornecedor.definirPrazoEntrega(undefined).isOk()).toBe(true);
    expect(fornecedor.prazoEntregaDias).toBeUndefined();
  });

  it("define observação e recusa a longa demais", () => {
    const fornecedor = criar();

    expect(fornecedor.definirObservacao("Entrega só às terças").isOk()).toBe(true);
    expect(fornecedor.observacao).toBe("Entrega só às terças");

    expect(fornecedor.definirObservacao("x".repeat(501)).isErr()).toBe(true);
    expect(fornecedor.definirObservacao(undefined).isOk()).toBe(true);
    expect(fornecedor.observacao).toBeUndefined();
  });

  it("🔑 desativa sem apagar — o histórico de compra responde por quanto se comprava", () => {
    const fornecedor = criar();

    fornecedor.desativar();
    expect(fornecedor.ativo).toBe(false);

    fornecedor.ativar();
    expect(fornecedor.ativo).toBe(true);
  });
});
