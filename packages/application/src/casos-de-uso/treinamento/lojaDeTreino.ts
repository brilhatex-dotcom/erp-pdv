import {
  type CodigoPapelPadrao,
  type CodigoUnidade,
  gerarEtiquetaBalanca,
  LAYOUT_BALANCA_PADRAO,
  type TipoProduto,
} from "@erp/domain";

/**
 * A loja do treinamento (ADR-0026).
 *
 * Pequena de propósito: dá para treinar tudo o que o balcão faz — bipar,
 * pesar, ler a etiqueta da balança, dar desconto, vender fiado, devolver — sem
 * o operador se perder num catálogo de mil itens. E com cara de loja de
 * verdade: preço de padaria, de hortifrúti, de mercearia.
 *
 * Os códigos de barras são EAN-13 válidos, do prefixo do Brasil, e não
 * existem em produto nenhum à venda: bipar um produto real da loja no treino
 * dá "não encontrado", e não o produto errado.
 */

/** Quem treina entra com estas pessoas. O PIN é público: elas só existem no banco de treino. */
export interface PessoaDeTreino {
  readonly matricula: string;
  readonly nome: string;
  readonly papel: Extract<CodigoPapelPadrao, "OPERADOR_CAIXA" | "SUPERVISOR" | "GERENTE">;
  readonly pin: string;
  /** Para quem treina escolher com quem entrar — e com quem liberar. */
  readonly oQueFaz: string;
}

export const PESSOAS_DE_TREINO: readonly PessoaDeTreino[] = [
  {
    matricula: "901",
    nome: "Operador de treino",
    papel: "OPERADOR_CAIXA",
    pin: "121212",
    oQueFaz: "Abre o caixa, vende, dá desconto pequeno e fecha o caixa.",
  },
  {
    matricula: "902",
    nome: "Supervisor de treino",
    papel: "SUPERVISOR",
    pin: "232323",
    oQueFaz: "Libera desconto maior, cancela venda, faz devolução e sangria.",
  },
  {
    matricula: "903",
    nome: "Gerente de treino",
    papel: "GERENTE",
    pin: "343434",
    oQueFaz: "Faz tudo o que o supervisor faz, com limites maiores.",
  },
];

export interface CategoriaDeTreino {
  readonly chave: string;
  readonly nome: string;
  readonly icone: string;
}

export const CATEGORIAS_DE_TREINO: readonly CategoriaDeTreino[] = [
  { chave: "PADARIA", nome: "Padaria", icone: "🍞" },
  { chave: "HORTIFRUTI", nome: "Hortifrúti", icone: "🥬" },
  { chave: "FRIOS", nome: "Frios", icone: "🧀" },
  { chave: "BEBIDAS", nome: "Bebidas", icone: "🥤" },
  { chave: "MERCEARIA", nome: "Mercearia", icone: "🛒" },
];

export interface ProdutoDeTreino {
  readonly sku: string;
  readonly descricao: string;
  readonly categoria: string;
  readonly tipo: TipoProduto;
  readonly unidade: CodigoUnidade;
  /** Em reais, como se digita: "18,90". Por quilo, no pesável. */
  readonly preco: string;
  readonly custo: string;
  readonly codigoBarras?: string;
  /** O código do produto dentro da etiqueta da balança. */
  readonly codigoBalanca?: string;
  readonly botaoRapido?: boolean;
  /** O estoque inicial, na unidade do produto. */
  readonly estoque: string;
}

export const PRODUTOS_DE_TREINO: readonly ProdutoDeTreino[] = [
  {
    sku: "T-PAO",
    descricao: "Pão francês",
    categoria: "PADARIA",
    tipo: "PESAVEL",
    unidade: "KG",
    preco: "18,90",
    custo: "9,50",
    codigoBalanca: "000001",
    botaoRapido: true,
    estoque: "30",
  },
  {
    sku: "T-PAOQUEIJO",
    descricao: "Pão de queijo",
    categoria: "PADARIA",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "1,50",
    custo: "0,60",
    botaoRapido: true,
    estoque: "200",
  },
  {
    sku: "T-SONHO",
    descricao: "Sonho de creme",
    categoria: "PADARIA",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "4,50",
    custo: "1,80",
    botaoRapido: true,
    estoque: "40",
  },
  {
    sku: "T-BOLO",
    descricao: "Bolo de fubá",
    categoria: "PADARIA",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "22,00",
    custo: "9,00",
    estoque: "10",
  },
  {
    sku: "T-BANANA",
    descricao: "Banana prata",
    categoria: "HORTIFRUTI",
    tipo: "PESAVEL",
    unidade: "KG",
    preco: "6,99",
    custo: "3,20",
    codigoBalanca: "000002",
    botaoRapido: true,
    estoque: "50",
  },
  {
    sku: "T-TOMATE",
    descricao: "Tomate",
    categoria: "HORTIFRUTI",
    tipo: "PESAVEL",
    unidade: "KG",
    preco: "8,49",
    custo: "4,10",
    codigoBalanca: "000003",
    estoque: "40",
  },
  {
    sku: "T-QUEIJO",
    descricao: "Queijo muçarela",
    categoria: "FRIOS",
    tipo: "PESAVEL",
    unidade: "KG",
    preco: "49,90",
    custo: "31,00",
    codigoBalanca: "000004",
    estoque: "15",
  },
  {
    sku: "T-REFRI",
    descricao: "Refrigerante cola 2 L",
    categoria: "BEBIDAS",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "9,90",
    custo: "6,50",
    codigoBarras: "7890000000017",
    estoque: "60",
  },
  {
    sku: "T-AGUA",
    descricao: "Água mineral 500 ml",
    categoria: "BEBIDAS",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "2,50",
    custo: "0,90",
    codigoBarras: "7890000000024",
    estoque: "120",
  },
  {
    sku: "T-ARROZ",
    descricao: "Arroz tipo 1 5 kg",
    categoria: "MERCEARIA",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "27,90",
    custo: "21,00",
    codigoBarras: "7890000000031",
    estoque: "25",
  },
  {
    sku: "T-FEIJAO",
    descricao: "Feijão carioca 1 kg",
    categoria: "MERCEARIA",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "8,99",
    custo: "6,20",
    codigoBarras: "7890000000048",
    estoque: "40",
  },
  {
    sku: "T-CAFE",
    descricao: "Café torrado 500 g",
    categoria: "MERCEARIA",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "17,50",
    custo: "12,40",
    codigoBarras: "7890000000055",
    estoque: "30",
  },
  {
    sku: "T-LEITE",
    descricao: "Leite integral 1 L",
    categoria: "MERCEARIA",
    tipo: "UNITARIO",
    unidade: "UN",
    preco: "5,49",
    custo: "3,90",
    codigoBarras: "7890000000062",
    estoque: "80",
  },
];

export interface ClienteDeTreino {
  readonly nome: string;
  readonly apelido: string;
  /** O teto do fiado, em reais. */
  readonly limite: string;
}

export const CLIENTES_DE_TREINO: readonly ClienteDeTreino[] = [
  { nome: "Maria Aparecida Souza", apelido: "Dona Maria", limite: "200,00" },
  { nome: "João Batista Lima", apelido: "Seu João", limite: "100,00" },
];

/** Um código para digitar no campo do caixa, e o que ele é. */
export interface ExemploDeCodigo {
  readonly descricao: string;
  readonly codigo: string;
}

/**
 * Códigos para treinar a leitura, para quem treina sem o leitor ou sem os
 * produtos na mão: digitados no campo, valem como a bipada.
 *
 * A etiqueta da balança sai do formato de fábrica — o mesmo que a loja de
 * treino usa —, com o peso dentro: é o que a balança imprimiria.
 */
export function exemplosDeCodigo(): readonly ExemploDeCodigo[] {
  const etiqueta = (codigoProduto: string, gramas: bigint): string =>
    gerarEtiquetaBalanca(LAYOUT_BALANCA_PADRAO, codigoProduto, gramas).unwrap();

  return [
    { descricao: "Refrigerante cola 2 L", codigo: "7890000000017" },
    { descricao: "Leite integral 1 L", codigo: "7890000000062" },
    {
      descricao: "Pão francês — etiqueta da balança, 350 g",
      codigo: etiqueta("000001", 350n),
    },
    {
      descricao: "Banana prata — etiqueta da balança, 1,250 kg",
      codigo: etiqueta("000002", 1250n),
    },
  ];
}
