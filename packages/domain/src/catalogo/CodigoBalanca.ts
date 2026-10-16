import { apenasDigitos } from "@erp/utils";

import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import { Quantidade } from "../valores/Quantidade.js";
import type { CodigoUnidade } from "../valores/UnidadeMedida.js";
import { calcularDigitoVerificador, temDigitoVerificadorValido } from "./CodigoBarras.js";

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

/**
 * Confere um layout antes de a loja passar a depender dele.
 *
 * Layout errado não dá erro na configuração — dá **cobrança errada** no balcão:
 * um dígito a mais no código do produto desloca o peso uma casa, e 0,98 kg vira
 * 9,8 kg. Recusar aqui, com a explicação, é o único ponto em que o defeito
 * ainda é barato.
 */
export function validarLayoutBalanca(layout: LayoutBalanca): ErroValidacao[] {
  const erros: ErroValidacao[] = [];

  if (layout.prefixos.length === 0 || layout.prefixos.length > 5) {
    erros.push(
      new ErroValidacao(
        "BALANCA_PREFIXOS_INVALIDOS",
        "Informe de 1 a 5 prefixos de etiqueta de balança (normalmente só o 2).",
      ),
    );
  }

  for (const prefixo of layout.prefixos) {
    if (!/^\d{1,2}$/.test(prefixo)) {
      erros.push(
        new ErroValidacao(
          "BALANCA_PREFIXO_FORMATO",
          `O prefixo "${prefixo}" deve ter 1 ou 2 números.`,
          { prefixo },
        ),
      );
    }
  }

  if (new Set(layout.prefixos).size !== layout.prefixos.length) {
    erros.push(
      new ErroValidacao("BALANCA_PREFIXO_REPETIDO", "Há prefixo repetido na lista."),
    );
  }

  if (
    !Number.isInteger(layout.tamanhoCodigoProduto) ||
    layout.tamanhoCodigoProduto < 4 ||
    layout.tamanhoCodigoProduto > 6
  ) {
    erros.push(
      new ErroValidacao(
        "BALANCA_TAMANHO_CODIGO_INVALIDO",
        "O código do produto na etiqueta deve ter de 4 a 6 números.",
        { tamanho: layout.tamanhoCodigoProduto },
      ),
    );
  }

  const casasMaximas = layout.conteudo === "PESO" ? 3 : 2;

  if (
    !Number.isInteger(layout.casasDecimais) ||
    layout.casasDecimais < 0 ||
    layout.casasDecimais > casasMaximas
  ) {
    erros.push(
      new ErroValidacao(
        "BALANCA_CASAS_INVALIDAS",
        layout.conteudo === "PESO"
          ? "O peso da etiqueta usa de 0 a 3 casas decimais (3 = gramas)."
          : "O preço da etiqueta usa de 0 a 2 casas decimais (2 = centavos).",
        { casasDecimais: layout.casasDecimais },
      ),
    );
  }

  // O valor ocupa o que sobra dos 12 dígitos antes do verificador. Menos de 4
  // não comporta nem 9,999 kg; mais de 6 só acontece com código curto demais.
  for (const prefixo of layout.prefixos) {
    const tamanhoValor = 12 - prefixo.length - layout.tamanhoCodigoProduto;

    if (tamanhoValor < 4 || tamanhoValor > 6) {
      erros.push(
        new ErroValidacao(
          "BALANCA_LAYOUT_SEM_ESPACO",
          "Com esse prefixo e esse tamanho de código, o valor da etiqueta fica com espaço errado. Confira no manual da balança.",
          { prefixo, tamanhoValor },
        ),
      );
    }
  }

  return erros;
}

/**
 * Monta a etiqueta que a balança imprimiria — para a tela de configuração.
 *
 * O lojista configura o layout, imprime uma etiqueta de teste na balança e
 * compara com o exemplo daqui. Se os dois números baterem, a configuração está
 * certa; é a validação que dispensa um técnico na loja.
 *
 * `valor` é inteiro na escala do layout: com peso em 3 casas, `350` são 350 g.
 */
export function gerarEtiquetaBalanca(
  layout: LayoutBalanca,
  codigoProduto: string,
  valor: bigint,
): Result<string, ErroValidacao> {
  const prefixo = layout.prefixos[0] ?? "";
  const tamanhoValor = 12 - prefixo.length - layout.tamanhoCodigoProduto;
  const codigo = apenasDigitos(codigoProduto);

  if (codigo === "" || codigo.length > layout.tamanhoCodigoProduto) {
    return err(
      new ErroValidacao(
        "BALANCA_CODIGO_NAO_CABE",
        `O código do produto deve ter até ${String(layout.tamanhoCodigoProduto)} números.`,
        { codigo },
      ),
    );
  }

  const texto = valor.toString();

  if (valor < 0n || tamanhoValor < 1 || texto.length > tamanhoValor) {
    return err(
      new ErroValidacao(
        "BALANCA_VALOR_NAO_CABE",
        "Esse valor não cabe na etiqueta com o layout configurado.",
        { valor: texto, tamanhoValor },
      ),
    );
  }

  const semVerificador =
    prefixo +
    codigo.padStart(layout.tamanhoCodigoProduto, "0") +
    texto.padStart(tamanhoValor, "0");

  return ok(semVerificador + String(calcularDigitoVerificador(semVerificador)));
}

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
