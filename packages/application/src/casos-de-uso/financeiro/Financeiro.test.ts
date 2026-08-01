import { Cliente, Dinheiro, Fornecedor, Documento, type Titulo } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";

import { LancarTitulo } from "./LancarTitulo.js";
import {
  AdiarVencimento,
  CancelarTitulo,
  EstornarRecebimento,
  RegistrarRecebimento,
} from "./MovimentarTitulo.js";

/**
 * O financeiro pela camada de aplicação.
 *
 * O que se verifica aqui é o que o balcão faz: lançar a conta, receber um
 * pedaço, corrigir o que foi lançado errado. As regras de saldo são do
 * agregado e têm teste próprio; aqui o risco é o encanamento — buscar o nome no
 * cadastro errado, gravar sem salvar, deixar o estorno passar duas vezes.
 */

const AGORA = new Date("2026-08-01T12:00:00.000Z");

function montar() {
  const ambiente = montarAmbiente(AGORA);

  return {
    ...ambiente,
    lancar: new LancarTitulo(ambiente.unitOfWork, ambiente.relogio, ambiente.geradorId),
    receber: new RegistrarRecebimento(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
    estornar: new EstornarRecebimento(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
    adiar: new AdiarVencimento(ambiente.unitOfWork),
    cancelar: new CancelarTitulo(ambiente.unitOfWork, ambiente.relogio),
  };
}

let cenario: ReturnType<typeof montar>;

beforeEach(() => {
  cenario = montar();
});

function centavos(reais: string): bigint {
  return Dinheiro.deReais(reais).unwrap().centavos;
}

async function clienteCadastrado(nome = "Ana Maria de Souza") {
  const cliente = Cliente.criar({
    id: cenario.geradorId.proximo(),
    nome,
    tipoPessoa: "FISICA",
    limiteCredito: Dinheiro.deReais("500,00").unwrap(),
  }).unwrap();

  await cenario.clientes.salvar(cliente);

  return cliente;
}

async function fornecedorCadastrado() {
  const fornecedor = Fornecedor.criar({
    id: cenario.geradorId.proximo(),
    razaoSocial: "Distribuidora Bebidas Boas Ltda",
    documento: Documento.criar("11222333000181").unwrap(),
  }).unwrap();

  await cenario.fornecedores.salvar(fornecedor);

  return fornecedor;
}

function primeiro(titulos: readonly Titulo[]): Titulo {
  const titulo = titulos[0];
  if (titulo === undefined) throw new Error("nenhum título gerado");

  return titulo;
}

describe("lançamento manual", () => {
  it("🔑 conta de luz não exige cadastrar a concessionária", async () => {
    // Exigir o cadastro faria o lojista registrar a companhia de energia para
    // lançar uma despesa que ele paga todo mês. Atrito puro.
    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteNome: "Companhia de Energia",
      valorCentavos: centavos("340,00"),
      vencimento: new Date("2026-08-15T00:00:00.000Z"),
      descricao: "Energia de julho",
    });

    expect(resultado.isOk()).toBe(true);

    const titulo = primeiro(resultado.unwrap());
    expect(titulo.contraparteNome).toBe("Companhia de Energia");
    expect(titulo.tipo).toBe("PAGAR");
    expect(titulo.origem).toBe("MANUAL");
  });

  it("🔑 com cadastro, o nome vem de lá — não do que a tela mandou", async () => {
    // Confiar no texto do cliente deixaria o título com um nome diferente do
    // cadastro, e a conciliação com o histórico pararia de fechar.
    const cliente = await clienteCadastrado("José Carlos Pereira");

    const resultado = await cenario.lancar.executar({
      tipo: "RECEBER",
      contraparteId: cliente.id,
      contraparteNome: "NOME ERRADO DIGITADO",
      valorCentavos: centavos("100,00"),
      vencimento: new Date("2026-08-20T00:00:00.000Z"),
    });

    expect(primeiro(resultado.unwrap()).contraparteNome).toBe("José Carlos Pereira");
  });

  it("🔑 a pagar busca em fornecedores, não em clientes", async () => {
    // Trocar os dois faria o título nascer com o nome errado sem erro nenhum.
    const fornecedor = await fornecedorCadastrado();

    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteId: fornecedor.id,
      valorCentavos: centavos("1200,00"),
      vencimento: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(primeiro(resultado.unwrap()).contraparteNome).toBe(fornecedor.exibicao);
  });

  it("sem nome e sem cadastro é recusado", async () => {
    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      valorCentavos: centavos("100,00"),
      vencimento: AGORA,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("TITULO_CONTRAPARTE_OBRIGATORIA");
    }
  });

  it("cliente inexistente é recusado", async () => {
    const resultado = await cenario.lancar.executar({
      tipo: "RECEBER",
      contraparteId: cenario.geradorId.proximo(),
      valorCentavos: centavos("100,00"),
      vencimento: AGORA,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("CLIENTE_NAO_ENCONTRADO");
  });

  it("fornecedor inexistente é recusado", async () => {
    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteId: cenario.geradorId.proximo(),
      valorCentavos: centavos("100,00"),
      vencimento: AGORA,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) {
      expect(resultado.error.codigo).toBe("FORNECEDOR_NAO_ENCONTRADO");
    }
  });

  it("🔑 duplicata em três vezes vira três títulos que somam o total", async () => {
    // É a compra a prazo do fornecedor. A soma tem de bater com a nota, senão a
    // conferência com o boleto não fecha.
    const fornecedor = await fornecedorCadastrado();

    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteId: fornecedor.id,
      valorCentavos: centavos("1000,00"),
      vencimento: new Date("2026-09-01T00:00:00.000Z"),
      parcelas: 3,
    });

    const titulos = resultado.unwrap();
    expect(titulos).toHaveLength(3);

    const soma = titulos.reduce(
      (acumulado, titulo) => acumulado.somar(titulo.valorOriginal),
      Dinheiro.zero(),
    );
    expect(soma.paraDecimal()).toBe("1000.00");

    // A primeira vence na data informada; as demais, de trinta em trinta.
    expect(titulos.map((titulo) => titulo.vencimento.toISOString())).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
      "2026-10-31T00:00:00.000Z",
    ]);
    expect(titulos[0]?.parcela).toEqual({ numero: 1, de: 3 });
  });

  it("título único não recebe marcação de parcela", async () => {
    // `1 de 1` no carnê é ruído que o lojista teria de explicar ao cliente.
    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteNome: "Aluguel",
      valorCentavos: centavos("2000,00"),
      vencimento: AGORA,
    });

    expect(primeiro(resultado.unwrap()).parcela).toBeUndefined();
  });

  it("valor negativo é recusado", async () => {
    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteNome: "Aluguel",
      valorCentavos: -100n,
      vencimento: AGORA,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("🔑 descrição longa demais é recusada sem gravar meia lista de parcelas", async () => {
    // O laço para na primeira parcela inválida e não salva nenhuma. Gravar as
    // duas primeiras e recusar a terceira deixaria uma dívida pela metade.
    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteNome: "Fornecedor",
      valorCentavos: centavos("300,00"),
      vencimento: AGORA,
      parcelas: 3,
      descricao: "x".repeat(201),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("TITULO_DESCRICAO_LONGA");

    const gravados = await cenario.titulos.buscar({ limite: 50 });
    expect(gravados).toHaveLength(0);
  });

  it("parcelas demais são recusadas", async () => {
    const resultado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteNome: "Aluguel",
      valorCentavos: centavos("100,00"),
      vencimento: AGORA,
      parcelas: 99,
    });

    expect(resultado.isErr()).toBe(true);
  });
});

describe("recebimento", () => {
  async function tituloAberto(valor = "100,00") {
    const cliente = await clienteCadastrado();

    const criado = await cenario.lancar.executar({
      tipo: "RECEBER",
      contraparteId: cliente.id,
      valorCentavos: centavos(valor),
      vencimento: new Date("2026-08-31T00:00:00.000Z"),
    });

    return primeiro(criado.unwrap());
  }

  it("🔑 pagamento parcial deixa o saldo certo e o título gravado", async () => {
    const titulo = await tituloAberto();

    const resultado = await cenario.receber.executar({
      tituloId: titulo.id,
      valorCentavos: centavos("30,00"),
      usuarioId: cenario.geradorId.proximo(),
      forma: "DINHEIRO",
    });

    expect(resultado.isOk()).toBe(true);

    const relido = await cenario.titulos.porId(titulo.id);
    expect(relido?.saldo.paraDecimal()).toBe("70.00");
    expect(relido?.situacao).toBe("PARCIAL");
  });

  it("🔑 recebimento acima do saldo é recusado", async () => {
    // Aceitar viraria saldo negativo — "a loja deve ao cliente" — e o operador
    // que digitou um zero a mais só descobriria no acerto de contas.
    const titulo = await tituloAberto();

    const resultado = await cenario.receber.executar({
      tituloId: titulo.id,
      valorCentavos: centavos("150,00"),
      usuarioId: cenario.geradorId.proximo(),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("BAIXA_ACIMA_DO_SALDO");
  });

  it("título inexistente é recusado", async () => {
    const resultado = await cenario.receber.executar({
      tituloId: cenario.geradorId.proximo(),
      valorCentavos: centavos("10,00"),
      usuarioId: cenario.geradorId.proximo(),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("TITULO_NAO_ENCONTRADO");
  });

  it("valor inválido é recusado", async () => {
    const titulo = await tituloAberto();

    const resultado = await cenario.receber.executar({
      tituloId: titulo.id,
      valorCentavos: -500n,
      usuarioId: cenario.geradorId.proximo(),
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("🔑 estorno devolve o saldo e deixa os dois lançamentos à vista", async () => {
    const titulo = await tituloAberto();

    await cenario.receber.executar({
      tituloId: titulo.id,
      valorCentavos: centavos("40,00"),
      usuarioId: cenario.geradorId.proximo(),
    });

    const comBaixa = await cenario.titulos.porId(titulo.id);
    const baixa = comBaixa?.baixas[0];
    if (baixa === undefined) throw new Error("baixa não registrada");

    const resultado = await cenario.estornar.executar({
      tituloId: titulo.id,
      baixaId: baixa.id,
      usuarioId: cenario.geradorId.proximo(),
      observacao: "Lançado no cliente errado",
    });

    expect(resultado.isOk()).toBe(true);

    const relido = await cenario.titulos.porId(titulo.id);
    expect(relido?.saldo.paraDecimal()).toBe("100.00");
    expect(relido?.baixas).toHaveLength(2);
  });

  it("estorno de baixa inexistente é recusado", async () => {
    const titulo = await tituloAberto();

    const resultado = await cenario.estornar.executar({
      tituloId: titulo.id,
      baixaId: cenario.geradorId.proximo(),
      usuarioId: cenario.geradorId.proximo(),
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("BAIXA_NAO_ENCONTRADA");
  });

  it("estorno em título inexistente é recusado", async () => {
    const resultado = await cenario.estornar.executar({
      tituloId: cenario.geradorId.proximo(),
      baixaId: cenario.geradorId.proximo(),
      usuarioId: cenario.geradorId.proximo(),
    });

    expect(resultado.isErr()).toBe(true);
  });
});

describe("adiamento e cancelamento", () => {
  async function tituloAberto() {
    const criado = await cenario.lancar.executar({
      tipo: "PAGAR",
      contraparteNome: "Aluguel",
      valorCentavos: centavos("2000,00"),
      vencimento: new Date("2026-08-10T00:00:00.000Z"),
    });

    return primeiro(criado.unwrap());
  }

  it("adia para frente", async () => {
    const titulo = await tituloAberto();

    const resultado = await cenario.adiar.executar({
      tituloId: titulo.id,
      novoVencimento: new Date("2026-08-25T00:00:00.000Z"),
      motivo: "Combinado com o proprietário",
    });

    expect(resultado.isOk()).toBe(true);
    expect((await cenario.titulos.porId(titulo.id))?.vencimento.toISOString()).toBe(
      "2026-08-25T00:00:00.000Z",
    );
  });

  it("não antecipa", async () => {
    const titulo = await tituloAberto();

    const resultado = await cenario.adiar.executar({
      tituloId: titulo.id,
      novoVencimento: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("adiar título inexistente é recusado", async () => {
    const resultado = await cenario.adiar.executar({
      tituloId: cenario.geradorId.proximo(),
      novoVencimento: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("cancela com motivo", async () => {
    const titulo = await tituloAberto();

    const resultado = await cenario.cancelar.executar({
      tituloId: titulo.id,
      motivo: "Lançado em duplicidade",
    });

    expect(resultado.isOk()).toBe(true);
    expect((await cenario.titulos.porId(titulo.id))?.situacao).toBe("CANCELADO");
  });

  it("🔑 não cancela título com recebimento", async () => {
    // Cancelar levaria junto o dinheiro que entrou, sem deixar rastro.
    const titulo = await tituloAberto();

    await cenario.receber.executar({
      tituloId: titulo.id,
      valorCentavos: centavos("500,00"),
      usuarioId: cenario.geradorId.proximo(),
    });

    const resultado = await cenario.cancelar.executar({
      tituloId: titulo.id,
      motivo: "Erro",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("TITULO_COM_BAIXA");
  });

  it("cancelar título inexistente é recusado", async () => {
    const resultado = await cenario.cancelar.executar({
      tituloId: cenario.geradorId.proximo(),
      motivo: "Erro",
    });

    expect(resultado.isErr()).toBe(true);
  });
});
