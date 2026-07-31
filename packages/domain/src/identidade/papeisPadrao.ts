import type { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";

import type { DadosPapel, LimitesPapel } from "./Papel.js";
import type { Permissao } from "./Permissao.js";

/**
 * Papéis de fábrica.
 *
 * São o ponto de partida da instalação, não uma camisa de força: a loja copia e
 * ajusta. Existem porque a alternativa — instalar sem papel algum e pedir que o
 * dono monte a matriz de permissões antes da primeira venda — é exatamente o
 * tipo de configuração inicial que vira chamado de suporte.
 *
 * Os valores vêm de `docs/ARQUITETURA.md` §9.2 e §9.4.
 */
export type CodigoPapelPadrao =
  | "OPERADOR_CAIXA"
  | "SUPERVISOR"
  | "ESTOQUISTA"
  | "FINANCEIRO"
  | "GERENTE"
  | "CONTADOR"
  | "ADMIN";

interface ModeloPapel {
  readonly codigo: CodigoPapelPadrao;
  readonly nome: string;
  readonly permissoes: readonly Permissao[];
  readonly limites: LimitesPapel;
}

function reais(valor: string): Dinheiro {
  // Literais fixos e válidos; `unwrapOr` fecha o tipo sem um ramo inalcançável.
  return Dinheiro.deReais(valor).unwrapOr(Dinheiro.zero());
}

const OPERADOR_CAIXA: ModeloPapel = {
  codigo: "OPERADOR_CAIXA",
  nome: "Operador de caixa",
  permissoes: [
    "venda:criar",
    "venda:desconto",
    "venda:consultar_propria",
    "caixa:abrir",
    "caixa:fechar",
    "fiscal:emitir",
  ],
  limites: {
    descontoMaximoItemBps: 500,
    descontoMaximoVendaBps: 300,
    // Sem `caixa:sangria` e sem `venda:cancelar`: a decisão nem chega aos
    // limites, é negada na permissão.
  },
};

const SUPERVISOR: ModeloPapel = {
  codigo: "SUPERVISOR",
  nome: "Supervisor",
  permissoes: [
    ...OPERADOR_CAIXA.permissoes,
    "venda:cancelar",
    "venda:desconto_acima_limite",
    "venda:consultar_todas",
    "caixa:sangria",
    "produto:alterar_preco",
    "fiscal:cancelar",
    "relatorio:vendas",
  ],
  limites: {
    descontoMaximoItemBps: 1500,
    descontoMaximoVendaBps: 1000,
    valorMaximoSangria: reais("500,00"),
    minutosParaCancelarVenda: 30,
    estornoMaximoEmDinheiro: reais("200,00"),
  },
};

const ESTOQUISTA: ModeloPapel = {
  codigo: "ESTOQUISTA",
  nome: "Estoquista",
  permissoes: [
    "produto:criar",
    "produto:editar",
    "produto:ver_custo",
    "estoque:entrada",
    "estoque:ajuste",
    "estoque:inventario",
  ],
  limites: {},
};

const FINANCEIRO: ModeloPapel = {
  codigo: "FINANCEIRO",
  nome: "Financeiro",
  permissoes: [
    "financeiro:ver",
    "financeiro:lancar",
    "financeiro:conciliar",
    "relatorio:financeiro",
    "relatorio:vendas",
    "venda:consultar_todas",
  ],
  limites: {},
};

const GERENTE: ModeloPapel = {
  codigo: "GERENTE",
  nome: "Gerente",
  permissoes: [
    ...SUPERVISOR.permissoes,
    ...ESTOQUISTA.permissoes,
    ...FINANCEIRO.permissoes,
    "caixa:reabrir",
    "relatorio:margem",
    "config:empresa",
  ],
  limites: {
    descontoMaximoItemBps: 3000,
    descontoMaximoVendaBps: 2500,
    // Sangria, cancelamento e estorno sem teto.
  },
};

const CONTADOR: ModeloPapel = {
  codigo: "CONTADOR",
  nome: "Contador",
  // Somente leitura: nenhuma permissão de escrita, nem sequer fiscal.
  permissoes: ["venda:consultar_todas", "relatorio:vendas", "relatorio:financeiro"],
  limites: {},
};

const ADMIN: ModeloPapel = {
  codigo: "ADMIN",
  nome: "Administrador",
  permissoes: [
    ...GERENTE.permissoes,
    "fiscal:inutilizar",
    "fiscal:configurar",
    "usuario:criar",
    "usuario:editar_permissoes",
    "config:fiscal",
    "config:backup",
  ],
  limites: {},
};

export const MODELOS_PAPEL_PADRAO: readonly ModeloPapel[] = [
  OPERADOR_CAIXA,
  SUPERVISOR,
  ESTOQUISTA,
  FINANCEIRO,
  GERENTE,
  CONTADOR,
  ADMIN,
];

/**
 * Monta os dados de um papel de fábrica, com o identificador que o chamador
 * gerou.
 *
 * O identificador vem de fora porque é UUIDv7 gerado no cliente (ADR-0008), e
 * o domínio não conhece nem relógio nem entropia.
 */
export function papelPadrao(codigo: CodigoPapelPadrao, id: Identificador): DadosPapel {
  const modelo = MODELOS_PAPEL_PADRAO.find((atual) => atual.codigo === codigo);

  /* v8 ignore next -- inalcançável: `codigo` é união fechada sobre esta lista */
  if (modelo === undefined) throw new Error(`Papel padrão desconhecido: ${codigo}`);

  return {
    id,
    codigo: modelo.codigo,
    nome: modelo.nome,
    // A união remove a duplicação vinda da composição de papéis acima.
    permissoes: [...new Set(modelo.permissoes)],
    limites: modelo.limites,
    padrao: true,
  };
}
