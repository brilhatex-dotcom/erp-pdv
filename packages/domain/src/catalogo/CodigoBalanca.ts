import { apenasDigitos } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import type { CodigoUnidade } from "../valores/UnidadeMedida.js";
import { temDigitoVerificadorValido } from "./CodigoBarras.js";

/**
 * O que a balança embutiu no código de barras.
 *
 * Balança de açougue, padaria e hortifruti imprime uma etiqueta cujo EAN-13
 * carrega **o código do produto e o valor** — peso ou preço já calculado. O
 * operador bipa e o item entra pronto no carrinho, sem digitar nada.
 *
 * Qual dos dois vem embutido depende de como a balança foi configurada na loja,
 * e as duas formas existem na prática. Por isso é configuração, não constante.
 */
export type ConteudoBalanca = "PESO" | "PRECO";

/**
 * Layout do código gerado pela balança.
 *
 * **Deliberadamente configurável por loja.** Marcas e modelos usam prefixos e
 * repartições diferentes, e o mesmo cliente pode trocar de balança. Fixar isso
 * no código transformaria cada instalação nova numa alteração de versão — o
 * oposto do que o custo de suporte exige (CLAUDE.md §2).
 */
export interface LayoutBalanca {
  /** Prefixos reservados a pesáveis. No Brasil, normalmente `2`. */
  readonly prefixos: readonly string[];
  /** Quantos dígitos, após o prefixo, identificam o produto. */
  readonly tamanhoCodigoProduto: number;
  /** Se o valor embutido é peso ou preço. */
  readonly conteudo: ConteudoBalanca;
  /** Casas decimais do valor embutido: 3 para peso em gramas, 2 para preço. */
  readonly casasDecimais: number;
}

/** Layout mais comum no varejo brasileiro: `2` + 6 dígitos + peso em gramas. */
export const LAYOUT_BALANCA_PADRAO: LayoutBalanca = {
  prefixos: ["2"],
  tamanhoCodigoProduto: 6,
  conteudo: "PESO",
  casasDecimais: 3,
};

/** Resultado da leitura de uma etiqueta de balança. */
export interface LeituraBalanca {
  /** Código interno do produto, como cadastrado na balança. */
  readonly codigoProduto: string;
  /** Peso lido, quando o layout embute peso. */
  readonly peso?: Quantidade;
  /** Preço total lido, quando o layout embute preço. */
  readonly preco?: Dinheiro;
}

/** Indica se o código tem a cara de uma etiqueta de balança. */
export function ehCodigoDeBalanca(valor: string, layout: LayoutBalanca): boolean {
  const digitos = apenasDigitos(valor);

  return (
    digitos.length === 13 &&
    layout.prefixos.some((prefixo) => digitos.startsWith(prefixo))
  );
}

/**
 * Interpreta uma etiqueta de balança.
 *
 * Estrutura de um EAN-13 de pesável com o layout padrão:
 *
 * ```
 * 2 PPPPPP VVVVV D
 * │ │      │     └── dígito verificador GS1
 * │ │      └──────── valor: peso em gramas ou preço em centavos
 * │ └─────────────── código do produto na balança
 * └───────────────── prefixo de pesável
 * ```
 *
 * O dígito verificador **é conferido**: leitura ruim de etiqueta amassada ou
 * suja acontece o tempo todo no balcão, e registrar 9,8 kg de picanha no lugar
 * de 0,98 kg é um prejuízo que ninguém percebe na hora.
 */
export function interpretarCodigoBalanca(
  valor: string,
  layout: LayoutBalanca,
  unidadePeso: CodigoUnidade = "KG",
): Result<LeituraBalanca, ErroValidacao> {
  const digitos = apenasDigitos(valor);

  if (digitos.length !== 13) {
    return err(
      new ErroValidacao("BALANCA_TAMANHO_INVALIDO", "Etiqueta de balança inválida.", {
        codigo: digitos,
        tamanho: digitos.length,
      }),
    );
  }

  const prefixo = layout.prefixos.find((atual) => digitos.startsWith(atual));

  if (prefixo === undefined) {
    return err(
      new ErroValidacao("BALANCA_PREFIXO_INVALIDO", "Etiqueta de balança inválida.", {
        codigo: digitos,
        prefixosAceitos: layout.prefixos,
      }),
    );
  }

  const inicioValor = prefixo.length + layout.tamanhoCodigoProduto;
  const tamanhoValor = 12 - inicioValor;

  if (tamanhoValor <= 0) {
    return err(
      new ErroValidacao("BALANCA_LAYOUT_INVALIDO", "Configuração da balança inválida.", {
        inicioValor,
        tamanhoValor,
      }),
    );
  }

  if (!temDigitoVerificadorValido(digitos)) {
    return err(
      new ErroValidacao(
        "BALANCA_DIGITO_INVALIDO",
        "Não foi possível ler a etiqueta. Passe novamente.",
        { codigo: digitos },
      ),
    );
  }

  const codigoProduto = digitos.slice(prefixo.length, inicioValor);
  const valorBruto = digitos.slice(inicioValor, 12);

  return layout.conteudo === "PESO"
    ? montarPeso(codigoProduto, valorBruto, layout, unidadePeso)
    : montarPreco(codigoProduto, valorBruto, layout);
}

// `map` em vez de verificar o erro e reembalar: a propagação fica implícita e
// não sobra um ramo `if` que, no caso do preço, nenhum código de 13 dígitos
// consegue alcançar — seria código morto disfarçado de cuidado.
function montarPeso(
  codigoProduto: string,
  valorBruto: string,
  layout: LayoutBalanca,
  unidadePeso: CodigoUnidade,
): Result<LeituraBalanca, ErroValidacao> {
  // O valor vem sem separador: "01250" com 3 casas são 1,250 kg.
  return Quantidade.deMilesimos(
    BigInt(valorBruto) * escalaPara(layout.casasDecimais),
    unidadePeso,
  ).map((peso) => ({ codigoProduto, peso }));
}

function montarPreco(
  codigoProduto: string,
  valorBruto: string,
  layout: LayoutBalanca,
): Result<LeituraBalanca, ErroValidacao> {
  return Dinheiro.deCentavos(
    BigInt(valorBruto) * escalaParaCentavos(layout.casasDecimais),
  ).map((preco) => ({ codigoProduto, preco }));
}

/** Converte o valor bruto para milésimos, conforme as casas do layout. */
function escalaPara(casasDecimais: number): bigint {
  return 10n ** BigInt(Math.max(0, 3 - casasDecimais));
}

/** Converte o valor bruto para centavos, conforme as casas do layout. */
function escalaParaCentavos(casasDecimais: number): bigint {
  return 10n ** BigInt(Math.max(0, 2 - casasDecimais));
}
