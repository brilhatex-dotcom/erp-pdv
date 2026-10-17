import { Dinheiro, Matricula, SessaoCaixa } from "@erp/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Container } from "../composicao/container.js";
import {
  cadastrarProduto,
  cadastrarUsuario,
  cadastrarUsuarioComPermissoes,
  limparBanco,
  logar,
  montarServidorDeTeste,
  prepararBanco,
  proximoId,
} from "./apoio.js";

/**
 * As rotas do balcão completo, ponta a ponta contra o Postgres real.
 *
 * O que se prova aqui é o **contrato** que a tela do caixa usa: formatos,
 * códigos de erro que abrem o modal do supervisor, e permissões decididas no
 * servidor. A regra de negócio já está coberta nos casos de uso; aqui é o fio.
 */

const ESTACAO = proximoId();

const PIN_OPERADOR = "482913";
const PIN_SUPERVISOR = "860412";
const PIN_GERENTE = "573914";
const SUPERVISOR = { matricula: "7", pin: PIN_SUPERVISOR };

/** PNG de 1×1 pixel, transparente. */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let servidor: FastifyInstance;
let container: Container;

beforeAll(async () => {
  prepararBanco();
  ({ servidor, container } = await montarServidorDeTeste());
});

afterAll(async () => {
  await servidor.close();
  await container.encerrar();
});

beforeEach(async () => {
  await limparBanco(container);
});

type Cabecalho = { readonly authorization: string };

async function entrar(
  papel: "OPERADOR_CAIXA" | "SUPERVISOR" | "GERENTE",
): Promise<Cabecalho> {
  const dados = {
    OPERADOR_CAIXA: { matricula: "42", pin: PIN_OPERADOR, nome: "Maria" },
    SUPERVISOR: { matricula: "7", pin: PIN_SUPERVISOR, nome: "João" },
    GERENTE: { matricula: "1", pin: PIN_GERENTE, nome: "Ana" },
  }[papel];

  await cadastrarUsuario(container, { ...dados, papel });
  const { token } = await logar(servidor, dados.matricula, dados.pin);

  return { authorization: `Bearer ${token}` };
}

/** Operador no caixa aberto, com o refrigerante de R$ 9,90 no catálogo. */
async function balcao(): Promise<{ operador: Cabecalho; supervisor: Cabecalho }> {
  const operador = await entrar("OPERADOR_CAIXA");
  const supervisor = await entrar("SUPERVISOR");
  const usuario = await container.leitura.usuarios.porMatricula(
    Matricula.criar("42").unwrap(),
  );

  await container.leitura.caixas.salvar(
    SessaoCaixa.abrir({
      id: proximoId(),
      estacaoId: ESTACAO,
      operadorId: usuario!.id,
      fundoTroco: Dinheiro.deReais("100,00").unwrap(),
      abertaEm: new Date(),
    }).unwrap(),
  );

  await cadastrarProduto(container);

  return { operador, supervisor };
}

async function chamar(
  cabecalho: Cabecalho,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const resposta = await servidor.inject({
    method,
    url,
    headers: cabecalho,
    ...(payload === undefined ? {} : { payload }),
  });

  return { status: resposta.statusCode, corpo: resposta.json<Record<string, unknown>>() };
}

type VendaNoFio = {
  id: string;
  numero: number;
  status: string;
  total: string;
  faltaPagar: string;
  troco: string;
  clienteId?: string;
  suspensao?: { rotulo?: string };
  itens: { numero: number; total: string; quantidade: { milesimos: string } }[];
  pagamentos: { indice: number; forma: string; valor: string; confirmacao: string }[];
};

async function vendaComRefri(operador: Cabecalho, bipadas = 1): Promise<VendaNoFio> {
  const aberta = await chamar(operador, "POST", "/api/vendas", {
    estacaoId: ESTACAO.valor,
  });
  const venda = aberta.corpo as unknown as VendaNoFio;

  let ultima = venda;
  for (let vez = 0; vez < bipadas; vez += 1) {
    const bipada = await chamar(operador, "POST", `/api/vendas/${venda.id}/itens`, {
      codigo: "7891000315507",
    });
    ultima = bipada.corpo["venda"] as VendaNoFio;
  }

  return ultima;
}

async function concluir(operador: Cabecalho, venda: VendaNoFio): Promise<VendaNoFio> {
  await chamar(operador, "POST", `/api/vendas/${venda.id}/pagamentos`, {
    forma: "DINHEIRO",
    valor: "5000",
  });
  const finalizada = await chamar(
    operador,
    "POST",
    `/api/vendas/${venda.id}/finalizar`,
    {},
  );
  return finalizada.corpo as unknown as VendaNoFio;
}

describe("Venda em andamento", () => {
  it("🔑 bipar de novo soma na mesma linha, e a resposta diz que somou", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const segunda = await chamar(operador, "POST", `/api/vendas/${venda.id}/itens`, {
      codigo: "7891000315507",
    });

    expect(segunda.status).toBe(201);
    expect(segunda.corpo["somado"]).toBe(true);
    const atual = segunda.corpo["venda"] as VendaNoFio;
    expect(atual.itens).toHaveLength(1);
    expect(atual.itens[0]?.quantidade.milesimos).toBe("2000");
    expect(atual.total).toBe("1980");
  });

  it("muda a quantidade e tira o item", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const alterada = await chamar(operador, "PUT", `/api/vendas/${venda.id}/itens/1`, {
      quantidade: { milesimos: "3000", unidade: "UN" },
    });
    expect(alterada.status).toBe(200);
    expect((alterada.corpo as unknown as VendaNoFio).total).toBe("2970");

    const sem = await chamar(
      operador,
      "POST",
      `/api/vendas/${venda.id}/itens/1/remover`,
      {},
    );
    expect(sem.status).toBe(200);
    expect((sem.corpo as unknown as VendaNoFio).itens).toHaveLength(0);
  });

  it("🔑 sem a alçada, pede o supervisor com o código que abre o modal; com o PIN dele, passa", async () => {
    await cadastrarUsuario(container, {
      matricula: "7",
      nome: "João",
      papel: "SUPERVISOR",
      pin: PIN_SUPERVISOR,
    });
    await cadastrarUsuarioComPermissoes(container, {
      matricula: "50",
      nome: "Caixa novo",
      pin: "135792",
      permissoes: ["venda:criar", "caixa:abrir"],
    });
    const { token } = await logar(servidor, "50", "135792");
    const novato = { authorization: `Bearer ${token}` };
    const usuario = await container.leitura.usuarios.porMatricula(
      Matricula.criar("50").unwrap(),
    );
    await container.leitura.caixas.salvar(
      SessaoCaixa.abrir({
        id: proximoId(),
        estacaoId: ESTACAO,
        operadorId: usuario!.id,
        fundoTroco: Dinheiro.zero(),
        abertaEm: new Date(),
      }).unwrap(),
    );
    await cadastrarProduto(container);
    const venda = await vendaComRefri(novato);

    const pedido = await chamar(
      novato,
      "POST",
      `/api/vendas/${venda.id}/itens/1/remover`,
      {},
    );
    expect(pedido.status).toBe(403);
    expect(pedido.corpo["erro"]).toMatchObject({
      codigo: "AUTORIZACAO_NECESSARIA",
      detalhes: { permissaoNecessaria: "venda:remover_item" },
    });

    const liberado = await chamar(
      novato,
      "POST",
      `/api/vendas/${venda.id}/itens/1/remover`,
      {
        supervisor: SUPERVISOR,
      },
    );
    expect(liberado.status).toBe(200);
  });

  it("🔑 desconto em percentual: 5% de R$ 9,90 são R$ 0,49 — e acima do teto pede liberação", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const cinco = await chamar(operador, "POST", `/api/vendas/${venda.id}/desconto`, {
      numeroItem: 1,
      percentualBps: 500,
    });
    expect(cinco.status).toBe(200);
    expect((cinco.corpo as unknown as VendaNoFio).total).toBe("941");

    const vinte = await chamar(operador, "POST", `/api/vendas/${venda.id}/desconto`, {
      percentualBps: 2000,
    });
    expect(vinte.status).toBe(403);
    expect((vinte.corpo["erro"] as { codigo: string }).codigo).toBe(
      "AUTORIZACAO_NECESSARIA",
    );
  });

  it("desconto sem valor nem percentual é recusado na entrada", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const resposta = await chamar(
      operador,
      "POST",
      `/api/vendas/${venda.id}/desconto`,
      {},
    );

    expect(resposta.status).toBe(400);
  });

  it("põe e tira o cliente", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);
    const cadastro = await container.cadastrarCliente.executar({
      nome: "Dona Cida",
      tipoPessoa: "FISICA",
    });
    const clienteId = cadastro.unwrap().id.valor;

    const com = await chamar(operador, "PUT", `/api/vendas/${venda.id}/cliente`, {
      clienteId,
    });
    expect((com.corpo as unknown as VendaNoFio).clienteId).toBe(clienteId);

    const sem = await chamar(operador, "PUT", `/api/vendas/${venda.id}/cliente`, {
      clienteId: null,
    });
    expect((sem.corpo as unknown as VendaNoFio).clienteId).toBeUndefined();
  });

  it("🔑 pagamento com a mesma chave não duplica; pagamento errado se tira", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);
    const pix = { forma: "PIX", valor: "500", chave: "pix-chave-0001" };

    await chamar(operador, "POST", `/api/vendas/${venda.id}/pagamentos`, pix);
    const reenvio = await chamar(
      operador,
      "POST",
      `/api/vendas/${venda.id}/pagamentos`,
      pix,
    );

    const comPix = reenvio.corpo["venda"] as VendaNoFio;
    expect(comPix.pagamentos).toHaveLength(1);
    expect(comPix.pagamentos[0]?.confirmacao).toBe("MANUAL");
    expect(reenvio.corpo["faltaPagar"]).toBe("490");

    const sem = await chamar(
      operador,
      "POST",
      `/api/vendas/${venda.id}/pagamentos/0/remover`,
    );
    expect(sem.status).toBe(200);
    expect((sem.corpo as unknown as VendaNoFio).faltaPagar).toBe("990");
  });

  it("🔑 na loja de verdade, pagamento simulado é recusado", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const resposta = await chamar(
      operador,
      "POST",
      `/api/vendas/${venda.id}/pagamentos`,
      {
        forma: "PIX",
        valor: "990",
        confirmacao: "SIMULADA",
      },
    );

    expect(resposta.status).toBe(422);
    expect((resposta.corpo["erro"] as { codigo: string }).codigo).toBe(
      "PAGAMENTO_SIMULADO_RECUSADO",
    );
  });
});

describe("Guardar, retomar e fechar", () => {
  it("🔑 a venda guardada aparece na lista e impede fechar o caixa até ser retomada", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const guardada = await chamar(operador, "POST", `/api/vendas/${venda.id}/suspender`, {
      rotulo: "Dona Maria",
    });
    expect((guardada.corpo as unknown as VendaNoFio).suspensao?.rotulo).toBe(
      "Dona Maria",
    );

    const abertas = await chamar(
      operador,
      "GET",
      `/api/vendas/abertas?estacaoId=${ESTACAO.valor}`,
    );
    expect((abertas.corpo["vendas"] as VendaNoFio[]).map((atual) => atual.id)).toEqual([
      venda.id,
    ]);

    const fechamento = await chamar(operador, "POST", "/api/caixa/fechar", {
      estacaoId: ESTACAO.valor,
      contadoEmDinheiro: "10000",
    });
    expect(fechamento.status).toBe(422);
    expect(fechamento.corpo["erro"]).toMatchObject({
      codigo: "CAIXA_COM_VENDAS_ABERTAS",
      detalhes: { vendas: [venda.numero] },
    });

    const retomada = await chamar(operador, "POST", `/api/vendas/${venda.id}/retomar`, {
      estacaoId: ESTACAO.valor,
    });
    expect(retomada.status).toBe(200);
    expect((retomada.corpo as unknown as VendaNoFio).suspensao).toBeUndefined();
  });

  it("sem caixa aberto, a lista de abertas é vazia — é o começo do dia", async () => {
    const operador = await entrar("OPERADOR_CAIXA");

    const abertas = await chamar(
      operador,
      "GET",
      `/api/vendas/abertas?estacaoId=${ESTACAO.valor}`,
    );

    expect(abertas.corpo).toEqual({ vendas: [] });
  });

  it("🔑 o fechamento mostra descontos, cancelamentos e devoluções", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);
    // R$ 0,20 de R$ 9,90 é 2,02%: dentro dos 3% do operador na venda.
    const desconto = await chamar(operador, "POST", `/api/vendas/${venda.id}/desconto`, {
      valor: "20",
    });
    expect(desconto.status).toBe(200);
    await concluir(operador, venda);

    // Fundo 100,00 + 50,00 recebidos − 40,30 de troco = 109,70.
    const fechamento = await chamar(operador, "POST", "/api/caixa/fechar", {
      estacaoId: ESTACAO.valor,
      contadoEmDinheiro: "10970",
    });

    expect(fechamento.status).toBe(200);
    expect(fechamento.corpo).toMatchObject({
      descontos: "20",
      cancelamentos: { quantidade: 0, total: "0" },
      devolucoes: { quantidade: 0, total: "0" },
      devolvidoEmDinheiro: "0",
      esperadoEmDinheiro: "10970",
      divergenciaEmDinheiro: "0",
    });
  });
});

describe("Cancelamento", () => {
  it("descarta a venda aberta com o motivo", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const resposta = await chamar(operador, "POST", `/api/vendas/${venda.id}/cancelar`, {
      motivo: "Cliente desistiu",
    });

    expect(resposta.status).toBe(200);
    expect(resposta.corpo["estornada"]).toBe(false);
    expect((resposta.corpo["venda"] as VendaNoFio).status).toBe("CANCELADA");
  });

  it("🔑 concluída: o operador pede, o supervisor libera, e a resposta lista o que devolver", async () => {
    const { operador } = await balcao();
    const venda = await concluir(operador, await vendaComRefri(operador));

    const pedido = await chamar(operador, "POST", `/api/vendas/${venda.id}/cancelar`, {
      motivo: "Cliente desistiu",
    });
    expect(pedido.status).toBe(403);

    const liberado = await chamar(operador, "POST", `/api/vendas/${venda.id}/cancelar`, {
      motivo: "Cliente desistiu",
      supervisor: SUPERVISOR,
    });

    expect(liberado.status).toBe(200);
    expect(liberado.corpo["estornada"]).toBe(true);
    // R$ 50,00 pagos, R$ 40,10 de troco: R$ 9,90 voltam da gaveta.
    expect(liberado.corpo["estornos"]).toEqual([{ forma: "Dinheiro", valor: "990" }]);
  });

  it("motivo curto demais é recusado na entrada", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const resposta = await chamar(operador, "POST", `/api/vendas/${venda.id}/cancelar`, {
      motivo: "x",
    });

    expect(resposta.status).toBe(400);
  });
});

describe("Depois da venda", () => {
  it("🔑 o comprovante diz que não é documento fiscal, e traz a loja quando cadastrada", async () => {
    const { operador } = await balcao();
    const venda = await concluir(operador, await vendaComRefri(operador));

    const semLoja = await chamar(operador, "GET", `/api/vendas/${venda.id}/comprovante`);
    expect(semLoja.status).toBe(200);
    expect(semLoja.corpo).toMatchObject({
      aviso: "NÃO É DOCUMENTO FISCAL",
      treinamento: false,
      larguraCupom: 80,
      operadorNome: "Maria",
    });
    expect(semLoja.corpo["loja"]).toBeUndefined();

    await container.definirEmpresa.executar({
      razaoSocial: "Mercadinho Bom Preço Ltda",
      nomeFantasia: "Bom Preço",
      cnpj: "11.222.333/0001-81",
      regimeTributario: "SIMPLES_NACIONAL",
      endereco: {
        logradouro: "Rua das Flores",
        numero: "120",
        bairro: "Centro",
        municipio: "Campinas",
        uf: "SP",
        cep: "13010000",
      },
      telefone: "1932345678",
    });

    const comLoja = await chamar(operador, "GET", `/api/vendas/${venda.id}/comprovante`);
    expect(comLoja.corpo["loja"]).toMatchObject({
      nome: "Bom Preço",
      cnpj: "11.222.333/0001-81",
    });
  });

  it("venda em andamento não tem comprovante", async () => {
    const { operador } = await balcao();
    const venda = await vendaComRefri(operador);

    const resposta = await chamar(operador, "GET", `/api/vendas/${venda.id}/comprovante`);

    expect(resposta.status).toBe(422);
  });

  it("🔑 o operador acha as próprias vendas pelo número do cupom", async () => {
    const { operador, supervisor } = await balcao();
    const venda = await concluir(operador, await vendaComRefri(operador));

    const minhas = await chamar(
      operador,
      "GET",
      `/api/vendas/recentes?numero=${String(venda.numero)}`,
    );
    expect((minhas.corpo["vendas"] as VendaNoFio[]).map((atual) => atual.id)).toEqual([
      venda.id,
    ]);

    // O supervisor não vendeu nada, mas pode consultar todas.
    const todas = await chamar(supervisor, "GET", "/api/vendas/recentes");
    expect((todas.corpo["vendas"] as unknown[]).length).toBe(1);
  });

  it("🔑 devolução parcial em dinheiro: o supervisor registra; o operador não pode", async () => {
    const { operador, supervisor } = await balcao();
    const venda = await concluir(operador, await vendaComRefri(operador, 2));

    const doOperador = await chamar(
      operador,
      "GET",
      `/api/vendas/${venda.id}/devolucoes`,
    );
    expect(doOperador.status).toBe(403);

    const antes = await chamar(supervisor, "GET", `/api/vendas/${venda.id}/devolucoes`);
    expect(antes.corpo["restante"]).toEqual([
      { numeroItem: 1, milesimos: "2000", unidade: "UN" },
    ]);

    const devolucao = await chamar(
      supervisor,
      "POST",
      `/api/vendas/${venda.id}/devolucoes`,
      {
        estacaoId: ESTACAO.valor,
        itens: [
          {
            numeroItem: 1,
            quantidade: { milesimos: "1000", unidade: "UN" },
            destino: "ESTOQUE",
          },
        ],
        formaReembolso: "DINHEIRO",
        motivo: "Refrigerante quente",
      },
    );
    expect(devolucao.status).toBe(201);
    expect(devolucao.corpo["valorTotal"]).toBe("990");

    const depois = await chamar(supervisor, "GET", `/api/vendas/${venda.id}/devolucoes`);
    expect(depois.corpo["restante"]).toEqual([
      { numeroItem: 1, milesimos: "1000", unidade: "UN" },
    ]);
    expect(depois.corpo["devolucoes"] as unknown[]).toHaveLength(1);
  });
});

describe("Apoio ao PDV", () => {
  it("🔑 o contexto diz quem está no caixa, como a loja vende e o que está ligado", async () => {
    const { operador } = await balcao();

    const contexto = await chamar(operador, "GET", "/api/pdv/contexto");

    expect(contexto.status).toBe(200);
    expect(contexto.corpo).toMatchObject({
      modo: "REAL",
      operador: {
        nome: "Maria",
        matricula: "42",
        limites: { descontoMaximoItemBps: 500 },
      },
      configuracao: { segmento: "MISTO", gravada: false, vendaSemEstoque: "PERMITIR" },
    });
    const integracoes = contexto.corpo["integracoes"] as {
      codigo: string;
      situacao: string;
    }[];
    expect(integracoes.find((atual) => atual.codigo === "NFCE")?.situacao).toBe(
      "NAO_IMPLEMENTADA",
    );
    expect(integracoes.find((atual) => atual.codigo === "PIX_AUTOMATICO")?.situacao).toBe(
      "NAO_IMPLEMENTADA",
    );
  });

  it("busca por nome; sem termo nem categoria, pede um dos dois", async () => {
    const { operador } = await balcao();

    const achados = await chamar(operador, "GET", "/api/pdv/produtos?termo=refri");
    expect(
      (achados.corpo["produtos"] as { sku: string; precoVenda: string }[]).map(
        (produto) => [produto.sku, produto.precoVenda],
      ),
    ).toEqual([["REF001", "990"]]);

    const vazia = await chamar(operador, "GET", "/api/pdv/produtos");
    expect(vazia.status).toBe(400);
  });

  it("🔑 botões rápidos: os mais vendidos entram sozinhos; sem o recurso, não há botões", async () => {
    const { operador } = await balcao();
    await concluir(operador, await vendaComRefri(operador));

    const atalhos = await chamar(operador, "GET", "/api/pdv/atalhos");
    expect(
      (atalhos.corpo["botoes"] as { sku: string }[]).map((botao) => botao.sku),
    ).toEqual(["REF001"]);

    const gerente = await entrar("GERENTE");
    await chamar(gerente, "PUT", "/api/configuracao", { recursos: ["VENDA_POR_PESO"] });

    const semBotoes = await chamar(operador, "GET", "/api/pdv/atalhos");
    expect(semBotoes.corpo["botoes"]).toEqual([]);
  });
});

describe("Cliente e peso no balcão", () => {
  it("🔑 a busca de clientes mostra o fiado disponível e esconde o CPF", async () => {
    const { operador } = await balcao();
    const cadastro = await container.cadastrarCliente.executar({
      nome: "Aparecida Souza",
      apelido: "Dona Cida",
      tipoPessoa: "FISICA",
      documento: "529.982.247-25",
      limiteCreditoCentavos: 10000n,
    });
    const cliente = cadastro.unwrap();

    // R$ 9,90 já no fiado.
    const venda = await vendaComRefri(operador);
    await chamar(operador, "PUT", `/api/vendas/${venda.id}/cliente`, {
      clienteId: cliente.id.valor,
    });
    await chamar(operador, "POST", `/api/vendas/${venda.id}/pagamentos`, {
      forma: "CREDIARIO",
      valor: "990",
    });
    await chamar(operador, "POST", `/api/vendas/${venda.id}/finalizar`, {});

    const busca = await chamar(operador, "GET", "/api/pdv/clientes?termo=apar");

    expect(busca.corpo["clientes"]).toEqual([
      {
        id: cliente.id.valor,
        nome: "Dona Cida",
        documento: "***.982.247-**",
        vendeAPrazo: true,
        limiteCredito: "10000",
        emAberto: "990",
        disponivel: "9010",
      },
    ]);

    const curta = await chamar(operador, "GET", "/api/pdv/clientes?termo=a");
    expect(curta.status).toBe(400);
  });

  it("empresa aparece com o CNPJ mascarado; cliente sem documento, sem máscara nenhuma", async () => {
    const { operador } = await balcao();
    await container.cadastrarCliente.executar({
      nome: "Restaurante Sabor Caseiro Ltda",
      tipoPessoa: "JURIDICA",
      documento: "11.222.333/0001-81",
    });
    await container.cadastrarCliente.executar({
      nome: "Restaurante Vizinho",
      tipoPessoa: "FISICA",
    });

    const busca = await chamar(operador, "GET", "/api/pdv/clientes?termo=restaurante");
    const [empresa, vizinho] = busca.corpo["clientes"] as {
      nome: string;
      documento?: string;
      vendeAPrazo: boolean;
      disponivel: string;
    }[];

    expect(empresa).toMatchObject({
      nome: "Restaurante Sabor Caseiro Ltda",
      documento: "**.222.333/****-**",
      vendeAPrazo: false,
      disponivel: "0",
    });
    expect(vizinho?.documento).toBeUndefined();
  });

  it("🔑 pesável bipado sem peso volta com o produto, para a tela pedir o peso", async () => {
    const { operador } = await balcao();
    await container.cadastrarProduto.executar({
      sku: "QJO001",
      descricao: "Queijo Minas Frescal",
      tipo: "PESAVEL",
      unidadeBase: "KG",
      precoVenda: 2000n,
    });
    const venda = await vendaComRefri(operador);

    const semPeso = await chamar(operador, "POST", `/api/vendas/${venda.id}/itens`, {
      codigo: "QJO001",
    });
    expect(semPeso.status).toBe(422);
    expect(semPeso.corpo["erro"]).toMatchObject({
      codigo: "PRODUTO_EXIGE_PESO",
      detalhes: {
        produto: { codigo: "QJO001", precoVenda: "2000", unidade: "KG" },
      },
    });

    // 350 g de queijo a R$ 20,00/kg: R$ 7,00.
    const comPeso = await chamar(operador, "POST", `/api/vendas/${venda.id}/itens`, {
      codigo: "QJO001",
      quantidade: { milesimos: "350000", unidade: "G" },
    });
    expect(comPeso.status).toBe(201);
    expect((comPeso.corpo["item"] as { total: string }).total).toBe("700");
  });
});

describe("Configuração da loja", () => {
  it("🔑 o operador lê, mas só o gerente grava — e a mudança vai para a auditoria", async () => {
    const operador = await entrar("OPERADOR_CAIXA");
    const gerente = await entrar("GERENTE");

    const lida = await chamar(operador, "GET", "/api/configuracao");
    expect(lida.status).toBe(200);
    expect((lida.corpo["padroes"] as Record<string, string[]>)["FRUTARIA"]).toEqual([
      "VENDA_POR_PESO",
      "BOTOES_RAPIDOS",
    ]);

    const doOperador = await chamar(operador, "PUT", "/api/configuracao", {
      segmento: "PADARIA",
    });
    expect(doOperador.status).toBe(403);

    const doGerente = await chamar(gerente, "PUT", "/api/configuracao", {
      segmento: "PADARIA",
      vendaSemEstoque: "AUTORIZAR",
    });
    expect(doGerente.status).toBe(200);
    expect(doGerente.corpo).toMatchObject({
      segmento: "PADARIA",
      vendaSemEstoque: "AUTORIZAR",
      gravada: true,
    });

    const auditoria = await chamar(gerente, "GET", "/api/auditoria");
    expect(
      (auditoria.corpo["registros"] as { acao: string; usuarioNome: string }[])[0],
    ).toMatchObject({ acao: "CONFIGURACAO_ALTERADA", usuarioNome: "Ana" });
  });

  it("logotipo que não existe é recusado", async () => {
    const gerente = await entrar("GERENTE");

    const resposta = await chamar(gerente, "PUT", "/api/configuracao", {
      logoId: proximoId().valor,
    });

    expect(resposta.status).toBe(400);
    expect((resposta.corpo["erro"] as { codigo: string }).codigo).toBe(
      "IMAGEM_NAO_ENCONTRADA",
    );
  });

  it("🔑 testar a etiqueta da balança antes de gravar: exemplo e leitura", async () => {
    const gerente = await entrar("GERENTE");
    const layout = {
      prefixos: ["2"],
      tamanhoCodigoProduto: 6,
      conteudo: "PESO",
      casasDecimais: 3,
    };

    const teste = await chamar(gerente, "POST", "/api/configuracao/balanca/testar", {
      layout,
    });
    expect(teste.status).toBe(200);
    const exemplo = (teste.corpo["exemplo"] as { etiqueta: string }).etiqueta;
    expect(exemplo).toHaveLength(13);

    const lida = await chamar(gerente, "POST", "/api/configuracao/balanca/testar", {
      layout,
      etiqueta: exemplo,
    });
    expect(lida.corpo["leitura"]).toMatchObject({
      valida: true,
      codigoProduto: "000012",
      peso: { milesimos: "350", unidade: "KG" },
    });

    const torta = await chamar(gerente, "POST", "/api/configuracao/balanca/testar", {
      layout,
      etiqueta: "2001200003501",
    });
    expect(torta.corpo["leitura"]).toMatchObject({ valida: false });

    const invalido = await chamar(gerente, "POST", "/api/configuracao/balanca/testar", {
      layout: { ...layout, tamanhoCodigoProduto: 4 },
    });
    expect(invalido.status).toBe(400);
  });
});

describe("Imagens", () => {
  it("🔑 o gerente envia; qualquer um vê, com o tipo travado e sem virar página", async () => {
    const gerente = await entrar("GERENTE");

    const enviada = await chamar(gerente, "POST", "/api/imagens", { conteudo: PNG_1X1 });
    expect(enviada.status).toBe(201);
    const id = enviada.corpo["id"] as string;

    const vista = await servidor.inject({ method: "GET", url: `/api/imagens/${id}` });
    expect(vista.statusCode).toBe(200);
    expect(vista.headers["content-type"]).toBe("image/png");
    expect(vista.headers["x-content-type-options"]).toBe("nosniff");
    expect(vista.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(vista.rawPayload.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const deNovo = await chamar(gerente, "POST", "/api/imagens", { conteudo: PNG_1X1 });
    expect(deNovo.corpo["id"]).toBe(id);
  });

  it("🔑 o operador não envia, e arquivo que não é imagem é recusado", async () => {
    const operador = await entrar("OPERADOR_CAIXA");
    const gerente = await entrar("GERENTE");

    const doOperador = await chamar(operador, "POST", "/api/imagens", {
      conteudo: PNG_1X1,
    });
    expect(doOperador.status).toBe(403);

    const html = await chamar(gerente, "POST", "/api/imagens", {
      conteudo: Buffer.from("<html><script>alert(1)</script></html>").toString("base64"),
    });
    expect(html.status).toBe(400);
    expect((html.corpo["erro"] as { codigo: string }).codigo).toBe("IMAGEM_FORMATO");
  });

  it("imagem que não existe é 404", async () => {
    const resposta = await servidor.inject({
      method: "GET",
      url: `/api/imagens/${proximoId().valor}`,
    });

    expect(resposta.statusCode).toBe(404);
  });
});

describe("Auditoria", () => {
  it("🔑 o gerente vê quem deu desconto; o operador não vê a auditoria", async () => {
    const { operador } = await balcao();
    const gerente = await entrar("GERENTE");
    const venda = await vendaComRefri(operador);
    await chamar(operador, "POST", `/api/vendas/${venda.id}/desconto`, { valor: "20" });

    const lista = await chamar(gerente, "GET", "/api/auditoria?acao=DESCONTO_VENDA");
    expect(
      (lista.corpo["registros"] as { usuarioNome: string; descricao: string }[])[0],
    ).toMatchObject({ usuarioNome: "Maria" });

    const doOperador = await chamar(operador, "GET", "/api/auditoria");
    expect(doOperador.status).toBe(403);
  });
});
