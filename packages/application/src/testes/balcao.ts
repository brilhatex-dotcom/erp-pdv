import {
  type AlteracaoConfiguracaoLoja,
  Cliente,
  CodigoBarras,
  type CodigoPapelPadrao,
  type CodigoUnidade,
  ConfiguracaoLoja,
  CredencialHash,
  Dinheiro,
  Identificador,
  Matricula,
  Papel,
  papelPadrao,
  type Permissao,
  Produto,
  Quantidade,
  SessaoCaixa,
  Usuario,
  type Venda,
} from "@erp/domain";

import { AutorizarOperacao } from "../casos-de-uso/acesso/AutorizarOperacao.js";
import { FecharCaixa } from "../casos-de-uso/caixa/FecharCaixa.js";
import {
  DefinirConfiguracaoLoja,
  ObterConfiguracaoLoja,
} from "../casos-de-uso/configuracao/ConfigurarLoja.js";
import { AdicionarItemPorCodigo } from "../casos-de-uso/vendas/AdicionarItemPorCodigo.js";
import { AplicarDesconto } from "../casos-de-uso/vendas/AplicarDesconto.js";
import { CancelarVenda } from "../casos-de-uso/vendas/CancelarVenda.js";
import {
  AlterarQuantidadeItem,
  RemoverItem,
  RemoverPagamento,
} from "../casos-de-uso/vendas/CorrigirVenda.js";
import { FinalizarVenda } from "../casos-de-uso/vendas/FinalizarVenda.js";
import { RetomarVenda, SuspenderVenda } from "../casos-de-uso/vendas/GuardarVenda.js";
import { IdentificarCliente } from "../casos-de-uso/vendas/IdentificarCliente.js";
import { IniciarVenda } from "../casos-de-uso/vendas/IniciarVenda.js";
import { RegistrarDevolucao } from "../casos-de-uso/vendas/RegistrarDevolucao.js";
import { RegistrarPagamento } from "../casos-de-uso/vendas/RegistrarPagamento.js";
import { montarAmbiente } from "./dubles.js";

/**
 * O balcão montado inteiro, em memória: três pessoas com os papéis de fábrica,
 * o caixa aberto, um catálogo pequeno e todos os casos de uso da venda.
 *
 * Os produtos são os dos exemplos do pedido do cliente — o queijo de
 * R$ 20,00/kg que, em 350 g, custa R$ 7,00; o bolo de R$ 12,50 pago com uma
 * nota de 20 —, para que as contas conferidas aqui sejam as mesmas que o dono
 * vai conferir no balcão.
 */

function id(sufixo: string): Identificador {
  return Identificador.criar(`018f3a2b-7c1d-7e4f-8a9b-1c2d3e5b${sufixo}`).unwrap();
}

export const ESTACAO = id("0001");
export const OUTRA_ESTACAO = id("0002");
export const OPERADOR = id("0003");
export const SUPERVISOR = id("0004");
export const GERENTE = id("0005");
export const CAIXA = id("0006");
export const CLIENTE = id("0007");
export const CLIENTE_SEM_FIADO = id("0008");
export const REFRI = id("0011");
export const QUEIJO = id("0012");
export const BOLO = id("0013");

export const AGORA = new Date("2026-08-01T10:00:00.000Z");

export const EAN_REFRI = "7891000315507";

export const CREDENCIAL_SUPERVISOR = { matricula: "7", pin: "860412" } as const;
export const CREDENCIAL_GERENTE = { matricula: "1", pin: "573914" } as const;

export function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

export function quantidade(valor: string, unidade: CodigoUnidade): Quantidade {
  return Quantidade.de(valor, unidade).unwrap();
}

function hashDe(texto: string): CredencialHash {
  return CredencialHash.criar(`falso:${texto}`, "falso").unwrap();
}

export interface OpcoesBalcao {
  /** Tira permissões do papel do operador — a loja que quer supervisor em tudo. */
  readonly operadorSem?: readonly Permissao[];
  readonly configuracao?: AlteracaoConfiguracaoLoja;
  readonly permiteSimulacao?: boolean;
}

export function montarBalcao(opcoes: OpcoesBalcao = {}) {
  const ambiente = montarAmbiente(AGORA);

  const pessoas: readonly {
    readonly id: Identificador;
    readonly matricula: string;
    readonly nome: string;
    readonly papel: CodigoPapelPadrao;
    readonly pin: string;
  }[] = [
    {
      id: OPERADOR,
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "419273",
    },
    {
      id: SUPERVISOR,
      matricula: CREDENCIAL_SUPERVISOR.matricula,
      nome: "João",
      papel: "SUPERVISOR",
      pin: CREDENCIAL_SUPERVISOR.pin,
    },
    {
      id: GERENTE,
      matricula: CREDENCIAL_GERENTE.matricula,
      nome: "Ana",
      papel: "GERENTE",
      pin: CREDENCIAL_GERENTE.pin,
    },
  ];

  for (const pessoa of pessoas) {
    const modelo = papelPadrao(
      pessoa.papel,
      id(`10${pessoa.matricula.padStart(2, "0")}`),
    );
    const retiradas = pessoa.id.equals(OPERADOR) ? (opcoes.operadorSem ?? []) : [];

    ambiente.usuarios.adicionar(
      Usuario.criar({
        id: pessoa.id,
        matricula: Matricula.criar(pessoa.matricula).unwrap(),
        nome: pessoa.nome,
        papel: Papel.criar({
          ...modelo,
          permissoes: modelo.permissoes.filter((atual) => !retiradas.includes(atual)),
        }).unwrap(),
        hashPin: hashDe(pessoa.pin),
      }).unwrap(),
    );
  }

  ambiente.caixas.adicionar(
    SessaoCaixa.abrir({
      id: CAIXA,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais("100,00"),
      abertaEm: AGORA,
    }).unwrap(),
  );

  ambiente.produtos.adicionar(
    Produto.criar({
      id: REFRI,
      sku: "REF001",
      descricao: "Refrigerante Cola 2 Litros",
      descricaoPdv: "REFRI COLA 2L",
      tipo: "UNITARIO",
      unidadeBase: "UN",
      precoVenda: reais("9,90"),
      custo: reais("6,50"),
      codigoBarras: CodigoBarras.criar(EAN_REFRI).unwrap(),
    }).unwrap(),
  );

  ambiente.produtos.adicionar(
    Produto.criar({
      id: QUEIJO,
      sku: "QJO001",
      descricao: "Queijo Minas Frescal",
      tipo: "PESAVEL",
      unidadeBase: "KG",
      precoVenda: reais("20,00"),
      codigoBalanca: "0123",
    }).unwrap(),
  );

  ambiente.produtos.adicionar(
    Produto.criar({
      id: BOLO,
      sku: "BOL001",
      descricao: "Bolo de Fubá",
      tipo: "UNITARIO",
      unidadeBase: "UN",
      precoVenda: reais("12,50"),
    }).unwrap(),
  );

  ambiente.clientes.adicionar(
    Cliente.criar({
      id: CLIENTE,
      nome: "Dona Cida",
      tipoPessoa: "FISICA",
      limiteCredito: reais("100,00"),
    }).unwrap(),
  );

  ambiente.clientes.adicionar(
    Cliente.criar({
      id: CLIENTE_SEM_FIADO,
      nome: "Seu Zé",
      tipoPessoa: "FISICA",
    }).unwrap(),
  );

  if (opcoes.configuracao !== undefined) {
    const configuracao = ConfiguracaoLoja.padrao(id("0099"));
    configuracao.alterar(opcoes.configuracao).unwrap();
    ambiente.configuracao.configuracao = configuracao;
  }

  const { unitOfWork, geradorId, relogio } = ambiente;
  const autorizar = new AutorizarOperacao(relogio, ambiente.hasher);

  const casos = {
    iniciarVenda: new IniciarVenda(unitOfWork, relogio, geradorId),
    adicionarItem: new AdicionarItemPorCodigo(unitOfWork, geradorId, relogio, autorizar),
    registrarPagamento: new RegistrarPagamento(
      unitOfWork,
      geradorId,
      relogio,
      autorizar,
      {
        permiteSimulacao: opcoes.permiteSimulacao ?? false,
      },
    ),
    finalizarVenda: new FinalizarVenda(unitOfWork, relogio, geradorId),
    alterarQuantidade: new AlterarQuantidadeItem(
      unitOfWork,
      geradorId,
      relogio,
      autorizar,
    ),
    removerItem: new RemoverItem(unitOfWork, geradorId, relogio, autorizar),
    removerPagamento: new RemoverPagamento(unitOfWork, geradorId, relogio),
    aplicarDesconto: new AplicarDesconto(unitOfWork, geradorId, relogio, autorizar),
    identificarCliente: new IdentificarCliente(unitOfWork),
    suspenderVenda: new SuspenderVenda(unitOfWork, relogio),
    retomarVenda: new RetomarVenda(unitOfWork),
    cancelarVenda: new CancelarVenda(unitOfWork, geradorId, relogio, autorizar),
    registrarDevolucao: new RegistrarDevolucao(unitOfWork, geradorId, relogio, autorizar),
    fecharCaixa: new FecharCaixa(unitOfWork, relogio, geradorId),
    obterConfiguracao: new ObterConfiguracaoLoja(unitOfWork, geradorId),
    definirConfiguracao: new DefinirConfiguracaoLoja(unitOfWork, geradorId, relogio),
  };

  /** Abre uma venda e bipa os códigos, na ordem. */
  async function vendaCom(
    ...leituras: readonly (string | { codigo: string; quantidade: Quantidade })[]
  ): Promise<Venda> {
    const venda = (
      await casos.iniciarVenda.executar({ estacaoId: ESTACAO, operadorId: OPERADOR })
    ).unwrap();

    for (const leitura of leituras) {
      const { codigo, quantidade: lida } =
        typeof leitura === "string"
          ? { codigo: leitura, quantidade: undefined }
          : leitura;

      (
        await casos.adicionarItem.executar({
          vendaId: venda.id,
          operadorId: OPERADOR,
          codigo,
          quantidade: lida,
        })
      ).unwrap();
    }

    return venda;
  }

  /** Venda paga e concluída, como sai do balcão. */
  async function vendaConcluida(
    pagamentos: readonly {
      forma: "DINHEIRO" | "PIX" | "CARTAO_DEBITO" | "CREDIARIO";
      valor: string;
    }[],
    ...leituras: readonly (string | { codigo: string; quantidade: Quantidade })[]
  ): Promise<Venda> {
    const venda = await vendaCom(...leituras);

    for (const pagamento of pagamentos) {
      (
        await casos.registrarPagamento.executar({
          vendaId: venda.id,
          operadorId: OPERADOR,
          forma: pagamento.forma,
          valor: reais(pagamento.valor),
        })
      ).unwrap();
    }

    return (await casos.finalizarVenda.executar({ vendaId: venda.id })).unwrap().venda;
  }

  return { ...ambiente, ...casos, autorizar, vendaCom, vendaConcluida };
}

export type Balcao = ReturnType<typeof montarBalcao>;
