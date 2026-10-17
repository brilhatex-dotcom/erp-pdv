import { ClienteApi, ProvedorSessao, Sessao } from "@erp/cliente-api";
import type { ClienteAgente, VendaNoAgente } from "@erp/agente-contrato";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type {
  ConfiguracaoNoFio,
  Conferencia,
  ItemNoFio,
  PagamentoNoFio,
  VendaNoFio,
} from "../api/tipos.js";
import { App } from "../App.js";
import { definirAgenteParaTeste } from "../balcao.js";

/**
 * Um servidor da loja de mentira, com estado — para exercitar a tela inteira.
 *
 * As contas aqui são **as mais simples que fecham**: total por item, desconto
 * em reais ou em percentual truncado, troco do que passou. Não é a regra de
 * negócio — essa mora no domínio e é testada lá —, é só o suficiente para a
 * tela ter o que mostrar. O que estes testes verificam é o **fluxo**: que a
 * tecla certa faz a chamada certa, e que o que volta aparece na tela.
 */

export interface ProdutoFalso {
  readonly id: string;
  readonly sku: string;
  readonly codigoBarras?: string;
  readonly descricao: string;
  readonly tipo: "UNITARIO" | "PESAVEL";
  readonly unidade: "UN" | "KG";
  readonly precoVenda: string;
  readonly categoriaId?: string;
  readonly botaoRapido?: boolean;
  readonly imagemId?: string;
  /** Presente: a venda sem saldo pede o supervisor. */
  readonly saldo?: string;
}

export interface ClienteFalso {
  readonly id: string;
  readonly nome: string;
  readonly documento?: string;
  readonly vendeAPrazo: boolean;
  readonly disponivel: string;
}

export const ID = (sufixo: number): string =>
  `018f3a2b-7c1d-7e4f-8a9b-${sufixo.toString(16).padStart(12, "0")}`;

export const REFRI: ProdutoFalso = {
  id: ID(101),
  sku: "101",
  codigoBarras: "7891000315507",
  descricao: "REFRI COLA 2L",
  tipo: "UNITARIO",
  unidade: "UN",
  precoVenda: "990",
  categoriaId: ID(901),
  botaoRapido: true,
};

export const QUEIJO: ProdutoFalso = {
  id: ID(102),
  sku: "102",
  descricao: "QUEIJO MUSSARELA",
  tipo: "PESAVEL",
  unidade: "KG",
  precoVenda: "2000",
  categoriaId: ID(902),
  botaoRapido: true,
};

export const PAO: ProdutoFalso = {
  id: ID(103),
  sku: "103",
  descricao: "PAO FRANCES",
  tipo: "UNITARIO",
  unidade: "UN",
  precoVenda: "1250",
  categoriaId: ID(902),
  imagemId: ID(801),
};

export const BOLO: ProdutoFalso = {
  id: ID(104),
  sku: "104",
  codigoBarras: "7890000000104",
  descricao: "BOLO DE FUBA",
  tipo: "UNITARIO",
  unidade: "UN",
  precoVenda: "5000",
  saldo: "0",
};

export const CLIENTE_FIADO: ClienteFalso = {
  id: ID(201),
  nome: "José da Silva",
  documento: "***.982.247-**",
  vendeAPrazo: true,
  disponivel: "20000",
};

export const CLIENTE_SEM_FIADO: ClienteFalso = {
  id: ID(202),
  nome: "Josefa Souza",
  vendeAPrazo: false,
  disponivel: "0",
};

export const OPERADOR = {
  id: ID(1),
  nome: "Maria da Silva",
  matricula: "42",
  papel: "Operador de caixa",
  permissoes: [
    "caixa:abrir",
    "caixa:fechar",
    "venda:criar",
    "venda:desconto",
    "venda:remover_item",
  ],
  precisaTrocarCredencial: false,
};

export const SUPERVISORA = {
  ...OPERADOR,
  id: ID(2),
  nome: "Rita Supervisora",
  matricula: "7",
  papel: "Supervisor",
  permissoes: [
    ...OPERADOR.permissoes,
    "caixa:sangria",
    "venda:cancelar",
    "venda:devolver",
  ],
};

/** A credencial que o servidor falso aceita para liberar. */
export const CREDENCIAL = { matricula: "7", pin: "860412" } as const;

export const CONFIGURACAO: ConfiguracaoNoFio = {
  segmento: "MISTO",
  recursos: ["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"],
  vendaSemEstoque: "AUTORIZAR",
  larguraCupom: 80,
  impressaoComprovante: "SOB_PEDIDO",
  gravada: true,
};

export interface OpcoesServidor {
  readonly operador?: typeof OPERADOR;
  readonly autenticado?: boolean;
  readonly caixaAberto?: boolean;
  readonly configuracao?: Partial<ConfiguracaoNoFio>;
  readonly modo?: "REAL" | "TREINAMENTO";
  readonly produtos?: readonly ProdutoFalso[];
  readonly clientes?: readonly ClienteFalso[];
  /** Vendas abertas no começo — a que ficou na tela, as guardadas. */
  readonly abertas?: readonly VendaNoFio[];
  /** Limite do desconto, em pontos-base. `null`: sem limite, como o do gerente. */
  readonly limiteDescontoBps?: number | null;
}

export interface Chamada {
  readonly metodo: string;
  readonly caminho: string;
  readonly consulta: URLSearchParams;
  readonly corpo: Record<string, unknown>;
}

type Manipulador = (
  corpo: Record<string, unknown>,
  parametros: readonly string[],
  consulta: URLSearchParams,
) => Response;

/** Sobrescrita pode segurar a resposta — para ver a tela no meio da operação. */
type Sobrescrita = (
  corpo: Record<string, unknown>,
  parametros: readonly string[],
  consulta: URLSearchParams,
) => Response | Promise<Response>;

/** Uma resposta que só sai quando o teste mandar. */
export function adiado(): {
  readonly resposta: Promise<Response>;
  readonly soltar: (resposta: Response) => void;
} {
  let soltar: (resposta: Response) => void = () => undefined;
  const resposta = new Promise<Response>((resolver) => {
    soltar = resolver;
  });

  return { resposta, soltar };
}

interface ItemInterno {
  readonly numero: number;
  readonly produto: ProdutoFalso;
  milesimos: bigint;
  desconto: bigint;
}

interface VendaInterna {
  readonly id: string;
  readonly numero: number;
  status: "ABERTA" | "FINALIZADA" | "CANCELADA";
  readonly estacaoId: string;
  clienteId?: string | undefined;
  readonly abertaEm: string;
  finalizadaEm?: string | undefined;
  itens: ItemInterno[];
  proximoItem: number;
  descontoVenda: bigint;
  pagamentos: (PagamentoNoFio & { readonly chave?: string | undefined })[];
  suspensao?: { readonly em: string; readonly rotulo?: string | undefined } | undefined;
  cancelamento?: { readonly em: string; readonly motivo: string } | undefined;
  devolvido: Map<number, bigint>;
}

export function json(status: number, corpo?: unknown): Response {
  if (status === 204) return new Response(null, { status });

  return new Response(JSON.stringify(corpo ?? {}), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function recusa(
  status: number,
  codigo: string,
  mensagem: string,
  detalhes?: Record<string, unknown>,
): Response {
  return json(status, { erro: { codigo, mensagem, detalhes } });
}

const AGORA = "2026-10-17T13:00:00.000Z";

export class ServidorFalso {
  readonly chamadas: Chamada[] = [];
  readonly vendas = new Map<string, VendaInterna>();
  operador: typeof OPERADOR;
  autenticado: boolean;
  caixaAberto: boolean;
  configuracao: ConfiguracaoNoFio;
  modo: "REAL" | "TREINAMENTO";
  produtos: readonly ProdutoFalso[];
  clientes: readonly ClienteFalso[];
  limiteDescontoBps: number | null;
  /** Rede caída: toda chamada rejeita como `fetch` sem servidor. */
  fora = false;
  conferencia: Conferencia = CONFERENCIA_QUE_BATE;
  #numero = 40;
  #sobrescritas = new Map<string, Sobrescrita[]>();

  constructor(opcoes: OpcoesServidor = {}) {
    this.operador = opcoes.operador ?? OPERADOR;
    this.autenticado = opcoes.autenticado ?? true;
    this.caixaAberto = opcoes.caixaAberto ?? true;
    this.configuracao = { ...CONFIGURACAO, ...opcoes.configuracao };
    this.modo = opcoes.modo ?? "REAL";
    this.produtos = opcoes.produtos ?? [REFRI, QUEIJO, PAO, BOLO];
    this.clientes = opcoes.clientes ?? [CLIENTE_FIADO, CLIENTE_SEM_FIADO];
    this.limiteDescontoBps =
      opcoes.limiteDescontoBps === undefined ? 500 : opcoes.limiteDescontoBps;

    for (const aberta of opcoes.abertas ?? []) this.#importar(aberta);
  }

  /**
   * Troca a resposta de uma rota pelas próximas chamadas, na ordem; cada
   * manipulador vale uma vez. `"POST /api/vendas/:id/itens"`.
   */
  responder(rota: string, ...manipuladores: Sobrescrita[]): void {
    this.#sobrescritas.set(rota, [
      ...(this.#sobrescritas.get(rota) ?? []),
      ...manipuladores,
    ]);
  }

  chamadasA(rota: string): Chamada[] {
    const [metodo = "", padrao = ""] = rota.split(" ");
    const expressao = paraExpressao(padrao);

    return this.chamadas.filter(
      (chamada) => chamada.metodo === metodo && expressao.test(chamada.caminho),
    );
  }

  /** A única venda criada na suíte — atalho para o caso comum. */
  vendaUnica(): VendaInterna {
    const [primeira] = [...this.vendas.values()];
    if (primeira === undefined) throw new Error("nenhuma venda criada");

    return primeira;
  }

  readonly buscar = (url: string, opcoes?: RequestInit): Promise<Response> => {
    const endereco = new URL(url, "http://loja.local");
    const metodo = opcoes?.method ?? "GET";
    const corpo =
      typeof opcoes?.body === "string"
        ? (JSON.parse(opcoes.body) as Record<string, unknown>)
        : {};

    this.chamadas.push({
      metodo,
      caminho: endereco.pathname,
      consulta: endereco.searchParams,
      corpo,
    });

    if (this.fora) return Promise.reject(new TypeError("Failed to fetch"));

    // Manipulador que lança simula a falha de transporte daquela rota só.
    try {
      return Promise.resolve(
        this.#atender(metodo, endereco.pathname, corpo, endereco.searchParams),
      );
    } catch (causa) {
      return Promise.reject(causa instanceof Error ? causa : new Error(String(causa)));
    }
  };

  /** A resposta normal da rota, sem as sobrescritas — para a sobrescrita que só embrulha. */
  padrao(metodo: string, caminho: string, corpo: Record<string, unknown> = {}): Response {
    for (const [rotaMetodo, padrao, manipulador] of this.#rotas()) {
      const encontrado = paraExpressao(padrao).exec(caminho);
      if (rotaMetodo === metodo && encontrado !== null) {
        return manipulador(corpo, encontrado.slice(1), new URLSearchParams());
      }
    }

    throw new Error(`rota falsa ausente: ${metodo} ${caminho}`);
  }

  #atender(
    metodo: string,
    caminho: string,
    corpo: Record<string, unknown>,
    consulta: URLSearchParams,
  ): Response | Promise<Response> {
    for (const [rota, fila] of this.#sobrescritas) {
      const [rotaMetodo = "", padrao = ""] = rota.split(" ");
      const encontrado = paraExpressao(padrao).exec(caminho);
      if (rotaMetodo !== metodo || encontrado === null) continue;

      const proximo = fila.shift();
      if (fila.length === 0) this.#sobrescritas.delete(rota);
      if (proximo !== undefined) return proximo(corpo, encontrado.slice(1), consulta);
    }

    // A credencial errada é recusada igual em toda rota, antes da regra dela.
    if (liberou(corpo) === false) {
      return recusa(
        403,
        "SUPERVISOR_CREDENCIAL_INVALIDA",
        "Matrícula ou PIN do supervisor incorreto.",
      );
    }

    for (const [rotaMetodo, padrao, manipulador] of this.#rotas()) {
      const encontrado = paraExpressao(padrao).exec(caminho);
      if (rotaMetodo === metodo && encontrado !== null) {
        return manipulador(corpo, encontrado.slice(1), consulta);
      }
    }

    return recusa(404, "ROTA_DESCONHECIDA", `rota falsa ausente: ${metodo} ${caminho}`);
  }

  #rotas(): readonly (readonly [string, string, Manipulador])[] {
    return [
      [
        "GET",
        "/api/acesso/eu",
        () =>
          this.autenticado ? json(200, this.operador) : recusa(401, "TOKEN_AUSENTE", "x"),
      ],
      ["POST", "/api/acesso/renovar", () => recusa(401, "SESSAO_INVALIDA", "x")],
      [
        "POST",
        "/api/acesso/login",
        (corpo) =>
          corpo["segredo"] === "419273"
            ? json(200, { token: "abc", usuario: this.operador })
            : recusa(401, "CREDENCIAL_INVALIDA", "Matrícula ou PIN incorreto."),
      ],
      ["POST", "/api/acesso/sair", () => json(204)],

      ["GET", "/api/pdv/contexto", () => json(200, this.#contexto())],
      [
        "GET",
        "/api/pdv/atalhos",
        () =>
          json(200, {
            categorias: [
              { id: ID(901), nome: "Bebidas", icone: "🥤" },
              { id: ID(902), nome: "Padaria" },
            ],
            botoes: this.produtos
              .filter((produto) => produto.botaoRapido === true)
              .map(paraBalcao),
          }),
      ],
      [
        "GET",
        "/api/pdv/produtos",
        (_corpo, _parametros, busca) => {
          const termo = (busca.get("termo") ?? "").toLowerCase();
          const categoriaId = busca.get("categoriaId");
          const achados = this.produtos.filter((produto) =>
            categoriaId === null
              ? produto.descricao.toLowerCase().includes(termo) || produto.sku === termo
              : produto.categoriaId === categoriaId,
          );
          return json(200, { produtos: achados.map(paraBalcao) });
        },
      ],
      [
        "GET",
        "/api/pdv/clientes",
        (_corpo, _parametros, busca) => {
          const termo = (busca.get("termo") ?? "").toLowerCase();
          return json(200, {
            clientes: this.clientes
              .filter((cliente) => cliente.nome.toLowerCase().startsWith(termo))
              .map((cliente) => ({ ...cliente, limiteCredito: "20000", emAberto: "0" })),
          });
        },
      ],

      [
        "GET",
        "/api/caixa/aberto",
        (_corpo, _parametros, busca) =>
          this.caixaAberto
            ? json(200, {
                id: ID(301),
                estacaoId: busca.get("estacaoId"),
                fundoTroco: "10000",
                totalVendido: "0",
                quantidadeVendas: 0,
                abertaEm: AGORA,
              })
            : json(204),
      ],
      [
        "POST",
        "/api/caixa/abrir",
        (corpo) => {
          this.caixaAberto = true;
          return json(201, {
            id: ID(301),
            estacaoId: corpo["estacaoId"],
            fundoTroco: corpo["fundoTroco"],
            totalVendido: "0",
            quantidadeVendas: 0,
            abertaEm: AGORA,
          });
        },
      ],
      [
        "POST",
        "/api/caixa/sangria",
        (corpo) => {
          if (!this.operador.permissoes.includes("caixa:sangria")) {
            return recusa(
              403,
              "PERMISSAO_NEGADA",
              "Você não tem permissão para esta operação.",
            );
          }
          return json(201, {
            id: ID(401),
            tipo: "SANGRIA",
            valor: corpo["valor"],
            motivo: corpo["motivo"],
            ocorridoEm: AGORA,
          });
        },
      ],
      [
        "POST",
        "/api/caixa/suprimento",
        (corpo) =>
          json(201, {
            id: ID(402),
            tipo: "SUPRIMENTO",
            valor: corpo["valor"],
            motivo: corpo["motivo"],
            ocorridoEm: AGORA,
          }),
      ],
      [
        "POST",
        "/api/caixa/fechar",
        (corpo) => {
          this.caixaAberto = false;
          const contado = String(corpo["contadoEmDinheiro"]);
          const esperado = BigInt(this.conferencia.esperadoEmDinheiro);
          return json(200, {
            ...this.conferencia,
            contadoEmDinheiro: contado,
            divergenciaEmDinheiro: (BigInt(contado) - esperado).toString(),
          });
        },
      ],

      [
        "GET",
        "/api/vendas/abertas",
        () =>
          json(200, {
            vendas: [...this.vendas.values()]
              .filter((venda) => venda.status === "ABERTA")
              .map((venda) => this.#apresentar(venda)),
          }),
      ],
      [
        "GET",
        "/api/vendas/recentes",
        (_corpo, _parametros, busca) => {
          const numero = busca.get("numero");
          const vendas = [...this.vendas.values()]
            .filter((venda) => venda.status !== "ABERTA")
            .filter((venda) => numero === null || String(venda.numero) === numero)
            .reverse()
            .map((venda) => ({
              ...this.#apresentar(venda),
              operadorNome: this.operador.nome,
              clienteNome: this.clientes.find((cliente) => cliente.id === venda.clienteId)
                ?.nome,
            }));
          return json(200, { vendas });
        },
      ],
      [
        "POST",
        "/api/vendas",
        (corpo) => {
          if (!this.caixaAberto) {
            return recusa(
              422,
              "CAIXA_FECHADO",
              "Abra o caixa antes de iniciar uma venda.",
            );
          }
          const venda = this.#nova(String(corpo["estacaoId"]));
          return json(201, this.#apresentar(venda));
        },
      ],
      [
        "GET",
        "/api/vendas/:id/comprovante",
        (_corpo, [id]) => {
          const venda = this.#venda(id);
          return json(200, {
            aviso: "NÃO É DOCUMENTO FISCAL",
            treinamento: this.modo === "TREINAMENTO",
            larguraCupom: this.configuracao.larguraCupom,
            logoId: ID(800),
            loja: {
              nome: "Padaria Pão Quente",
              razaoSocial: "Pão Quente Ltda",
              cnpj: "12.345.678/0001-95",
              endereco: "Rua das Flores, 10 - Centro",
              telefone: "(11) 3333-4444",
            },
            operadorNome: this.operador.nome,
            clienteNome: this.clientes.find((cliente) => cliente.id === venda.clienteId)
              ?.nome,
            emitidoEm: AGORA,
            venda: this.#apresentar(venda),
          });
        },
      ],
      [
        "GET",
        "/api/vendas/:id/devolucoes",
        (_corpo, [id]) => {
          const venda = this.#venda(id);
          return json(200, {
            venda: this.#apresentar(venda),
            devolucoes: [],
            restante: venda.itens.map((item) => ({
              numeroItem: item.numero,
              milesimos: (
                item.milesimos - (venda.devolvido.get(item.numero) ?? 0n)
              ).toString(),
              unidade: item.produto.unidade,
            })),
          });
        },
      ],
      [
        "POST",
        "/api/vendas/:id/devolucoes",
        (corpo, [id]) => {
          const venda = this.#venda(id);
          let valor = 0n;
          for (const pedido of corpo["itens"] as {
            numeroItem: number;
            quantidade: { milesimos: string };
          }[]) {
            const item = venda.itens.find((atual) => atual.numero === pedido.numeroItem);
            if (item === undefined) continue;
            const milesimos = BigInt(pedido.quantidade.milesimos);
            venda.devolvido.set(
              item.numero,
              (venda.devolvido.get(item.numero) ?? 0n) + milesimos,
            );
            valor += meioParaCima(BigInt(item.produto.precoVenda) * milesimos, 1000n);
          }
          return json(201, { id: ID(501), valorTotal: valor.toString() });
        },
      ],
      [
        "GET",
        "/api/vendas/:id",
        (_corpo, [id]) => json(200, this.#apresentar(this.#venda(id))),
      ],
      [
        "POST",
        "/api/vendas/:id/itens",
        (corpo, [id]) => this.#adicionarItem(this.#venda(id), corpo),
      ],
      [
        "PUT",
        "/api/vendas/:id/itens/:numero",
        (corpo, [id, numero]) => {
          const venda = this.#venda(id);
          const item = venda.itens.find((atual) => String(atual.numero) === numero);
          const quantidade = corpo["quantidade"] as { milesimos: string };
          if (item === undefined)
            return recusa(404, "ITEM_NAO_ENCONTRADO", "Item não encontrado.");
          item.milesimos = BigInt(quantidade.milesimos);
          return json(200, this.#apresentar(venda));
        },
      ],
      [
        "POST",
        "/api/vendas/:id/itens/:numero/remover",
        (_corpo, [id, numero]) => {
          const venda = this.#venda(id);
          venda.itens = venda.itens.filter((item) => String(item.numero) !== numero);
          return json(200, this.#apresentar(venda));
        },
      ],
      [
        "POST",
        "/api/vendas/:id/desconto",
        (corpo, [id]) => this.#descontar(this.#venda(id), corpo),
      ],
      [
        "PUT",
        "/api/vendas/:id/cliente",
        (corpo, [id]) => {
          const venda = this.#venda(id);
          venda.clienteId = (corpo["clienteId"] as string | null) ?? undefined;
          return json(200, this.#apresentar(venda));
        },
      ],
      [
        "POST",
        "/api/vendas/:id/pagamentos",
        (corpo, [id]) => this.#pagar(this.#venda(id), corpo),
      ],
      [
        "POST",
        "/api/vendas/:id/pagamentos/:indice/remover",
        (_corpo, [id, indice]) => {
          const venda = this.#venda(id);
          venda.pagamentos = venda.pagamentos
            .filter((pagamento) => String(pagamento.indice) !== indice)
            .map((pagamento, posicao) => ({ ...pagamento, indice: posicao }));
          return json(200, this.#apresentar(venda));
        },
      ],
      [
        "POST",
        "/api/vendas/:id/suspender",
        (corpo, [id]) => {
          const venda = this.#venda(id);
          const rotulo = corpo["rotulo"] as string | undefined;
          venda.suspensao = { em: AGORA, rotulo: rotulo === "" ? undefined : rotulo };
          return json(200, this.#apresentar(venda));
        },
      ],
      [
        "POST",
        "/api/vendas/:id/retomar",
        (_corpo, [id]) => {
          const venda = this.#venda(id);
          venda.suspensao = undefined;
          return json(200, this.#apresentar(venda));
        },
      ],
      [
        "POST",
        "/api/vendas/:id/cancelar",
        (corpo, [id]) => {
          const venda = this.#venda(id);
          const concluida = venda.status === "FINALIZADA";
          if (
            concluida &&
            !this.operador.permissoes.includes("venda:cancelar") &&
            liberou(corpo) !== true
          ) {
            return recusa(
              403,
              "AUTORIZACAO_NECESSARIA",
              "Para cancelar uma venda concluída, chame o supervisor.",
            );
          }
          venda.status = "CANCELADA";
          venda.cancelamento = { em: AGORA, motivo: String(corpo["motivo"]) };
          return json(200, {
            venda: this.#apresentar(venda),
            estornada: concluida,
            estornos: concluida
              ? venda.pagamentos.map((pagamento) => ({
                  forma: pagamento.forma,
                  valor: pagamento.valor,
                }))
              : [],
          });
        },
      ],
      [
        "POST",
        "/api/vendas/:id/finalizar",
        (_corpo, [id]) => {
          const venda = this.#venda(id);
          const apresentada = this.#apresentar(venda);
          if (apresentada.faltaPagar !== "0") {
            return recusa(422, "PAGAMENTO_INCOMPLETO", "Ainda falta receber.");
          }
          venda.status = "FINALIZADA";
          venda.finalizadaEm = AGORA;
          return json(200, this.#apresentar(venda));
        },
      ],
    ];
  }

  #contexto(): Record<string, unknown> {
    return {
      modo: this.modo,
      operador: {
        id: this.operador.id,
        nome: this.operador.nome,
        matricula: this.operador.matricula,
        papel: this.operador.papel,
        permissoes: this.operador.permissoes,
        limites:
          this.limiteDescontoBps === null
            ? {}
            : {
                descontoMaximoItemBps: this.limiteDescontoBps,
                descontoMaximoVendaBps: 300,
              },
      },
      loja: { nome: "Padaria Pão Quente", endereco: "Rua das Flores, 10 - Centro" },
      configuracao: this.configuracao,
      integracoes: [],
    };
  }

  #nova(estacaoId: string): VendaInterna {
    this.#numero += 1;
    const venda: VendaInterna = {
      id: ID(1000 + this.#numero),
      numero: this.#numero,
      status: "ABERTA",
      estacaoId,
      abertaEm: AGORA,
      itens: [],
      proximoItem: 1,
      descontoVenda: 0n,
      pagamentos: [],
      devolvido: new Map(),
    };
    this.vendas.set(venda.id, venda);

    return venda;
  }

  #importar(aberta: VendaNoFio): void {
    this.vendas.set(aberta.id, {
      id: aberta.id,
      numero: aberta.numero,
      status: aberta.status,
      estacaoId: aberta.estacaoId,
      clienteId: aberta.clienteId,
      abertaEm: aberta.abertaEm,
      itens: aberta.itens.map((item) => ({
        numero: item.numero,
        produto: this.produtos.find((produto) => produto.id === item.produtoId) ?? REFRI,
        milesimos: BigInt(item.quantidade.milesimos),
        desconto: BigInt(item.desconto),
      })),
      proximoItem: aberta.itens.length + 1,
      descontoVenda: BigInt(aberta.descontoVenda),
      pagamentos: [...aberta.pagamentos],
      suspensao: aberta.suspensao,
      devolvido: new Map(),
    });
    this.#numero = Math.max(this.#numero, aberta.numero);
  }

  #venda(id: string | undefined): VendaInterna {
    const venda = this.vendas.get(id ?? "");
    if (venda === undefined) throw new Error(`venda falsa ausente: ${String(id)}`);

    return venda;
  }

  #adicionarItem(venda: VendaInterna, corpo: Record<string, unknown>): Response {
    const codigo = String(corpo["codigo"]);
    const produto = this.produtos.find(
      (atual) => atual.sku === codigo || atual.codigoBarras === codigo,
    );

    if (produto === undefined) {
      return recusa(
        404,
        "PRODUTO_NAO_ENCONTRADO",
        "Produto não encontrado. Confira o código ou procure pelo nome.",
        { codigo },
      );
    }

    const quantidade = corpo["quantidade"] as
      { milesimos: string; unidade?: string } | undefined;
    let milesimos: bigint;

    if (quantidade === undefined) {
      if (produto.tipo === "PESAVEL") {
        return recusa(
          422,
          "PRODUTO_EXIGE_PESO",
          `Informe o peso de ${produto.descricao}.`,
          {
            produto: {
              id: produto.id,
              codigo: produto.sku,
              descricao: produto.descricao,
              precoVenda: produto.precoVenda,
              unidade: produto.unidade,
            },
          },
        );
      }
      milesimos = 1000n;
    } else if (quantidade.unidade === "G") {
      milesimos = BigInt(quantidade.milesimos) / 1000n;
    } else {
      milesimos = BigInt(quantidade.milesimos);
      if (produto.unidade === "UN" && milesimos % 1000n !== 0n) {
        return recusa(
          422,
          "QUANTIDADE_NAO_FRACIONAVEL",
          `${produto.descricao} é vendido por unidade inteira.`,
        );
      }
    }

    if (
      produto.saldo !== undefined &&
      BigInt(produto.saldo) < milesimos &&
      liberou(corpo) !== true
    ) {
      return recusa(
        403,
        "AUTORIZACAO_NECESSARIA",
        "Este produto está sem estoque. A venda precisa de autorização do supervisor.",
      );
    }

    const existente =
      produto.tipo === "UNITARIO"
        ? venda.itens.find((item) => item.produto.id === produto.id)
        : undefined;

    if (existente !== undefined) {
      existente.milesimos += milesimos;
      return json(201, {
        item: this.#apresentarItem(existente),
        somado: true,
        venda: this.#apresentar(venda),
      });
    }

    const item: ItemInterno = {
      numero: venda.proximoItem,
      produto,
      milesimos,
      desconto: 0n,
    };
    venda.proximoItem += 1;
    venda.itens.push(item);

    return json(201, {
      item: this.#apresentarItem(item),
      somado: false,
      venda: this.#apresentar(venda),
    });
  }

  #descontar(venda: VendaInterna, corpo: Record<string, unknown>): Response {
    const numeroItem = corpo["numeroItem"] as number | undefined;
    const item = venda.itens.find((atual) => atual.numero === numeroItem);
    const base =
      item === undefined
        ? this.#apresentar(venda).itens.reduce(
            (soma, atual) => soma + BigInt(atual.totalBruto) - BigInt(atual.desconto),
            0n,
          )
        : BigInt(this.#apresentarItem(item).totalBruto);
    const bps = corpo["percentualBps"] as number | undefined;
    const valor =
      bps === undefined ? BigInt(String(corpo["valor"])) : (base * BigInt(bps)) / 10_000n;

    const limite = this.limiteDescontoBps;
    if (
      limite !== null &&
      base > 0n &&
      (valor * 10_000n) / base > BigInt(limite) &&
      liberou(corpo) !== true
    ) {
      return recusa(
        403,
        "AUTORIZACAO_NECESSARIA",
        "Desconto acima do seu limite de 5% no item.",
      );
    }

    if (item === undefined) venda.descontoVenda = valor;
    else item.desconto = valor;

    return json(200, this.#apresentar(venda));
  }

  #pagar(venda: VendaInterna, corpo: Record<string, unknown>): Response {
    const chave = corpo["chave"] as string | undefined;
    const repetido = venda.pagamentos.find(
      (pagamento) => chave !== undefined && pagamento.chave === chave,
    );
    const forma = String(corpo["forma"]);

    if (repetido === undefined) {
      if (forma === "CREDIARIO" && venda.clienteId === undefined) {
        return recusa(
          422,
          "CREDIARIO_SEM_CLIENTE",
          "Para vender fiado, identifique o cliente.",
        );
      }

      const falta = BigInt(this.#apresentar(venda).faltaPagar);
      const valor = BigInt(String(corpo["valor"]));
      if (forma !== "DINHEIRO" && valor > falta) {
        return recusa(
          422,
          "PAGAMENTO_ACIMA_DO_TOTAL",
          "Só o dinheiro pode passar do valor da venda.",
        );
      }

      venda.pagamentos.push({
        indice: venda.pagamentos.length,
        forma,
        descricao: forma,
        valor: valor.toString(),
        parcelas: (corpo["parcelas"] as number | undefined) ?? 1,
        autorizacao: corpo["autorizacao"] as string | undefined,
        confirmacao:
          (corpo["confirmacao"] as PagamentoNoFio["confirmacao"] | undefined) ?? "MANUAL",
        chave,
      });
    }

    const apresentada = this.#apresentar(venda);
    const pagamento = repetido ?? venda.pagamentos.at(-1);

    return json(201, {
      pagamento,
      faltaPagar: apresentada.faltaPagar,
      troco: apresentada.troco,
      venda: apresentada,
    });
  }

  #apresentarItem(item: ItemInterno): ItemNoFio {
    const bruto = meioParaCima(BigInt(item.produto.precoVenda) * item.milesimos, 1000n);

    return {
      numero: item.numero,
      produtoId: item.produto.id,
      descricao: item.produto.descricao,
      quantidade: { milesimos: item.milesimos.toString(), unidade: item.produto.unidade },
      precoUnitario: item.produto.precoVenda,
      totalBruto: bruto.toString(),
      desconto: item.desconto.toString(),
      descontoRateado: "0",
      total: (bruto - item.desconto).toString(),
    };
  }

  #apresentar(venda: VendaInterna): VendaNoFio {
    const itens = venda.itens.map((item) => this.#apresentarItem(item));
    const subtotal = itens.reduce((soma, item) => soma + BigInt(item.totalBruto), 0n);
    const descontoItens = itens.reduce((soma, item) => soma + BigInt(item.desconto), 0n);
    const descontoTotal = descontoItens + venda.descontoVenda;
    const total = subtotal - descontoTotal;
    const pago = venda.pagamentos.reduce(
      (soma, pagamento) => soma + BigInt(pagamento.valor),
      0n,
    );

    return {
      id: venda.id,
      numero: venda.numero,
      status: venda.status,
      estacaoId: venda.estacaoId,
      operadorId: this.operador.id,
      clienteId: venda.clienteId,
      abertaEm: venda.abertaEm,
      finalizadaEm: venda.finalizadaEm,
      subtotal: subtotal.toString(),
      descontoItens: descontoItens.toString(),
      descontoVenda: venda.descontoVenda.toString(),
      descontoTotal: descontoTotal.toString(),
      total: total.toString(),
      totalPago: pago.toString(),
      faltaPagar: (total > pago ? total - pago : 0n).toString(),
      troco: (pago > total ? pago - total : 0n).toString(),
      suspensao: venda.suspensao,
      cancelamento: venda.cancelamento,
      itens,
      pagamentos: venda.pagamentos.map(({ chave: _chave, ...pagamento }) => pagamento),
    };
  }
}

export const CONFERENCIA_QUE_BATE: Conferencia = {
  fundoTroco: "10000",
  recebidoEmDinheiro: "5000",
  trocoDevolvido: "750",
  suprimentos: "2000",
  sangrias: "3000",
  esperadoEmDinheiro: "13250",
  contadoEmDinheiro: "13250",
  divergenciaEmDinheiro: "0",
  totalVendido: "12000",
  totalAReceber: "1500",
  quantidadeVendas: 4,
  descontos: "200",
  cancelamentos: { quantidade: 1, total: "990" },
  devolucoes: { quantidade: 1, total: "500" },
  devolvidoEmDinheiro: "500",
  porForma: [
    { forma: "DINHEIRO", esperado: "4250" },
    { forma: "PIX", esperado: "3000" },
    { forma: "CARTAO_DEBITO", esperado: "2500" },
  ],
};

function liberou(corpo: Record<string, unknown>): boolean | undefined {
  const supervisor = corpo["supervisor"] as
    { matricula?: string; pin?: string } | undefined;
  if (supervisor === undefined) return undefined;

  return (
    supervisor.matricula === CREDENCIAL.matricula && supervisor.pin === CREDENCIAL.pin
  );
}

function meioParaCima(dividendo: bigint, divisor: bigint): bigint {
  return (dividendo * 2n + divisor) / (divisor * 2n);
}

function paraExpressao(padrao: string): RegExp {
  return new RegExp(`^${padrao.replace(/:[a-z]+/gi, "([^/]+)")}$`);
}

function paraBalcao(produto: ProdutoFalso): Record<string, unknown> {
  return {
    id: produto.id,
    sku: produto.sku,
    descricao: produto.descricao,
    descricaoCompleta: `${produto.descricao} (completo)`,
    tipo: produto.tipo,
    unidade: produto.unidade,
    precoVenda: produto.precoVenda,
    codigoBarras: produto.codigoBarras,
    categoriaId: produto.categoriaId,
    imagemId: produto.imagemId,
    botaoRapido: produto.botaoRapido === true,
    saldo: produto.saldo,
  };
}

// ── Montagem ─────────────────────────────────────────────────────────────

export interface Balcao {
  readonly servidor: ServidorFalso;
  readonly usuario: UserEvent;
}

/** A orientação da primeira vez só aparece no teste que fala dela. */
export function pularOrientacao(): void {
  globalThis.localStorage.setItem("erp.pdv.orientacao-vista", "sim");
}

export function montar(
  opcoes: OpcoesServidor = {},
  servidor = new ServidorFalso(opcoes),
): Balcao {
  const cliente = new ClienteApi(
    new Sessao(),
    "",
    servidor.buscar as unknown as typeof fetch,
  );

  function Envolvido(): ReactNode {
    return (
      <ProvedorSessao contexto="PDV" cliente={cliente}>
        <App />
      </ProvedorSessao>
    );
  }

  render(<Envolvido />);

  return { servidor, usuario: userEvent.setup() };
}

export async function campoDeCodigo(): Promise<HTMLElement> {
  return waitFor(() => screen.getByLabelText(/Código do produto/));
}

/** Bipa como o leitor: os dígitos e o Enter. */
export async function bipar(usuario: UserEvent, codigo: string): Promise<void> {
  const campo = await campoDeCodigo();
  await usuario.type(campo, `${codigo}{Enter}`);
}

export async function totalDaVenda(valor: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText("Total da venda")).toHaveTextContent(valor);
  });
}

// ── Agente Local ─────────────────────────────────────────────────────────

export type AgenteFalso = {
  readonly [Metodo in keyof ClienteAgente]: ReturnType<typeof vi.fn>;
};

/** O Agente da estação instalada, com tudo funcionando — sobrescreva o que o teste exige. */
export function instalarAgente(
  sobrescritas: Partial<Record<keyof ClienteAgente, unknown>> = {},
): AgenteFalso {
  const vendaLocal: VendaNoAgente = {
    id: "local-1",
    offline: true,
    total: "0",
    faltaPagar: "0",
    itens: [],
  };

  const agente = {
    disponivel: vi.fn().mockResolvedValue(true),
    estado: vi.fn().mockResolvedValue({ tipo: "CONECTADO", pendentes: 0 }),
    iniciarVenda: vi.fn().mockResolvedValue(vendaLocal),
    adicionarItem: vi.fn(),
    registrarPagamento: vi.fn().mockResolvedValue({ tipo: "OK", faltaPagar: "0" }),
    finalizar: vi.fn().mockResolvedValue({ tipo: "OK", troco: "0" }),
    cancelar: vi.fn().mockResolvedValue(undefined),
    sincronizar: vi.fn(),
    imprimirCupom: vi.fn().mockResolvedValue(undefined),
    abrirGaveta: vi.fn().mockResolvedValue(undefined),
    ...sobrescritas,
  };

  definirAgenteParaTeste(agente as unknown as ClienteAgente);

  return agente as unknown as AgenteFalso;
}

/** Venda aberta pronta, para os testes de recuperação e de vendas guardadas. */
export function vendaAberta(
  dados: Partial<VendaNoFio> & { readonly numero: number },
): VendaNoFio {
  return {
    id: ID(5000 + dados.numero),
    status: "ABERTA",
    estacaoId: ID(9),
    operadorId: OPERADOR.id,
    abertaEm: AGORA,
    subtotal: "990",
    descontoItens: "0",
    descontoVenda: "0",
    descontoTotal: "0",
    total: "990",
    totalPago: "0",
    faltaPagar: "990",
    troco: "0",
    itens: [
      {
        numero: 1,
        produtoId: REFRI.id,
        descricao: REFRI.descricao,
        quantidade: { milesimos: "1000", unidade: "UN" },
        precoUnitario: "990",
        totalBruto: "990",
        desconto: "0",
        descontoRateado: "0",
        total: "990",
      },
    ],
    pagamentos: [],
    ...dados,
  };
}
