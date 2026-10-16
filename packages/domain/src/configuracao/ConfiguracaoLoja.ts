import {
  LAYOUT_BALANCA_PADRAO,
  type LayoutBalanca,
  validarLayoutBalanca,
} from "../catalogo/CodigoBalanca.js";
import { AggregateRoot } from "../shared/AggregateRoot.js";
import { ErroValidacao } from "../shared/DomainError.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";

/**
 * O tipo de loja.
 *
 * Não é rótulo de cadastro: decide **o que aparece** no balcão. A padaria vê
 * os pães em botões grandes e vende fiado; a frutaria vê o preço do quilo em
 * destaque e não tem caderneta. Mostrar tudo a todos faria cada loja conviver
 * com botões que nunca usa — o oposto de "parece simples por fora"
 * (`CLAUDE.md` §2).
 *
 * `MISTO` é o mercadinho com padaria e hortifruti dentro, que é a regra nos
 * bairros e não a exceção.
 */
export type Segmento = "PADARIA" | "MERCADINHO" | "FRUTARIA" | "MISTO";

export const SEGMENTOS: readonly Segmento[] = [
  "PADARIA",
  "MERCADINHO",
  "FRUTARIA",
  "MISTO",
];

export function ehSegmento(valor: string): valor is Segmento {
  return (SEGMENTOS as readonly string[]).includes(valor);
}

/**
 * Recurso que a loja liga ou desliga.
 *
 * Só entra aqui o que **existe** e muda a tela. Recurso planejado ganha a sua
 * chave no dia em que for construído — chave sem funcionalidade atrás é a
 * opção na tela de configuração que não faz nada, e vira chamado.
 */
export type Recurso =
  /** Campo de peso no balcão e etiqueta de balança. */
  | "VENDA_POR_PESO"
  /** Venda a prazo, a caderneta. */
  | "FIADO"
  /** Botões com os produtos de sempre: pão, frutas, verduras. */
  | "BOTOES_RAPIDOS";

export const RECURSOS: readonly Recurso[] = ["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"];

export function ehRecurso(valor: string): valor is Recurso {
  return (RECURSOS as readonly string[]).includes(valor);
}

/**
 * O que fazer quando o produto não tem saldo.
 *
 * Padaria e frutaria raramente têm estoque exato do pão de hoje ou da banana
 * que chegou sem nota — bloquear ali pararia a venda por um número que todo
 * mundo sabe que está errado. Mercado com estoque conferido pode querer o
 * contrário. Por isso é escolha da loja, e o padrão é **permitir**: nenhuma
 * regra de estoque vale uma fila parada (`CLAUDE.md` §4, princípio 1).
 */
export type RegraVendaSemEstoque = "PERMITIR" | "AUTORIZAR" | "BLOQUEAR";

export const REGRAS_VENDA_SEM_ESTOQUE: readonly RegraVendaSemEstoque[] = [
  "PERMITIR",
  "AUTORIZAR",
  "BLOQUEAR",
];

export function ehRegraVendaSemEstoque(valor: string): valor is RegraVendaSemEstoque {
  return (REGRAS_VENDA_SEM_ESTOQUE as readonly string[]).includes(valor);
}

/** Largura do papel da impressora térmica, em milímetros. */
export type LarguraCupom = 58 | 80;

export function ehLarguraCupom(valor: number): valor is LarguraCupom {
  return valor === 58 || valor === 80;
}

/**
 * Quando o comprovante sai.
 *
 * A padaria que imprime cupom para cada pão gasta papel e tempo com um papel
 * que o cliente joga fora no balcão. `SOB_PEDIDO` deixa o botão à mão para
 * quem pede.
 */
export type ImpressaoComprovante = "SEMPRE" | "SOB_PEDIDO";

export function ehImpressaoComprovante(valor: string): valor is ImpressaoComprovante {
  return valor === "SEMPRE" || valor === "SOB_PEDIDO";
}

export interface DadosConfiguracaoLoja {
  readonly id: Identificador;
  readonly segmento: Segmento;
  readonly recursos: readonly Recurso[];
  readonly vendaSemEstoque: RegraVendaSemEstoque;
  readonly larguraCupom: LarguraCupom;
  readonly impressaoComprovante: ImpressaoComprovante;
  readonly layoutBalanca: LayoutBalanca;
  /** Imagem do logotipo, mostrada no PDV e no comprovante impresso pelo navegador. */
  readonly logoId?: Identificador | undefined;
}

/**
 * O que a tela de configuração pode mudar. O `id` não muda.
 *
 * Campo ausente é "manter". O logotipo aceita também `null`, que é "tirar":
 * sem essa distinção, não haveria como voltar à loja sem logotipo.
 */
export type AlteracaoConfiguracaoLoja = Partial<
  Omit<DadosConfiguracaoLoja, "id" | "logoId">
> & { readonly logoId?: Identificador | null | undefined };

interface Predefinicao {
  readonly recursos: readonly Recurso[];
  readonly impressaoComprovante: ImpressaoComprovante;
}

/**
 * O ponto de partida de cada segmento.
 *
 * Tirado da matriz de `docs/ANALISE-SEGMENTOS.md` §2: hortifruti não usa
 * crediário, padaria e mercadinho usam. A loja ajusta depois — a predefinição
 * existe para que a primeira venda aconteça sem a configuração inteira lida.
 */
const PREDEFINICOES: Readonly<Record<Segmento, Predefinicao>> = {
  PADARIA: {
    recursos: ["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"],
    impressaoComprovante: "SOB_PEDIDO",
  },
  MERCADINHO: {
    recursos: ["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"],
    impressaoComprovante: "SEMPRE",
  },
  FRUTARIA: {
    recursos: ["VENDA_POR_PESO", "BOTOES_RAPIDOS"],
    impressaoComprovante: "SOB_PEDIDO",
  },
  MISTO: {
    recursos: ["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"],
    impressaoComprovante: "SEMPRE",
  },
};

/**
 * Configuração da operação da loja — uma por instalação, como a empresa
 * (ADR-0024).
 *
 * Separada do cadastro da `Empresa` de propósito: a empresa é quem emite (CNPJ,
 * endereço, regime) e muda quase nunca; a configuração é **como a loja vende**,
 * e o gerente mexe nela na primeira semana até acertar. Juntar as duas faria
 * a permissão de mudar o tamanho do cupom vir junto com a de mudar o CNPJ.
 */
export class ConfiguracaoLoja extends AggregateRoot {
  #segmento: Segmento;
  #recursos: ReadonlySet<Recurso>;
  #vendaSemEstoque: RegraVendaSemEstoque;
  #larguraCupom: LarguraCupom;
  #impressaoComprovante: ImpressaoComprovante;
  #layoutBalanca: LayoutBalanca;
  #logoId: Identificador | undefined;

  private constructor(dados: DadosConfiguracaoLoja) {
    super(dados.id);
    this.#segmento = dados.segmento;
    this.#recursos = new Set(dados.recursos);
    this.#vendaSemEstoque = dados.vendaSemEstoque;
    this.#larguraCupom = dados.larguraCupom;
    this.#impressaoComprovante = dados.impressaoComprovante;
    this.#layoutBalanca = dados.layoutBalanca;
    this.#logoId = dados.logoId;
  }

  /**
   * A configuração de fábrica de um segmento.
   *
   * É também o que vale **antes** de a loja configurar qualquer coisa: um
   * mercadinho misto, que mostra todos os recursos. Melhor sobrar um botão no
   * primeiro dia do que faltar a balança na hora da primeira pesagem.
   */
  static padrao(id: Identificador, segmento: Segmento = "MISTO"): ConfiguracaoLoja {
    const predefinicao = PREDEFINICOES[segmento];

    return new ConfiguracaoLoja({
      id,
      segmento,
      recursos: predefinicao.recursos,
      vendaSemEstoque: "PERMITIR",
      larguraCupom: 80,
      impressaoComprovante: predefinicao.impressaoComprovante,
      layoutBalanca: LAYOUT_BALANCA_PADRAO,
    });
  }

  static criar(dados: DadosConfiguracaoLoja): Result<ConfiguracaoLoja, ErroValidacao[]> {
    const erros = validar(dados);
    if (erros.length > 0) return err(erros);

    return ok(new ConfiguracaoLoja(dados));
  }

  /** Uso exclusivo do repositório. Não revalida — ver `Produto.reconstituir`. */
  static reconstituir(dados: DadosConfiguracaoLoja): ConfiguracaoLoja {
    return new ConfiguracaoLoja(dados);
  }

  get segmento(): Segmento {
    return this.#segmento;
  }

  /** Em ordem fixa, para a resposta da API não mudar a cada leitura. */
  get recursos(): readonly Recurso[] {
    return RECURSOS.filter((recurso) => this.#recursos.has(recurso));
  }

  get vendaSemEstoque(): RegraVendaSemEstoque {
    return this.#vendaSemEstoque;
  }

  get larguraCupom(): LarguraCupom {
    return this.#larguraCupom;
  }

  get impressaoComprovante(): ImpressaoComprovante {
    return this.#impressaoComprovante;
  }

  get layoutBalanca(): LayoutBalanca {
    return this.#layoutBalanca;
  }

  get logoId(): Identificador | undefined {
    return this.#logoId;
  }

  temRecurso(recurso: Recurso): boolean {
    return this.#recursos.has(recurso);
  }

  /**
   * Aplica o que a tela mandou — tudo ou nada.
   *
   * Trocar o segmento **não** reescreve os recursos sozinho: quem mudou de
   * padaria para mista e já tinha desligado o fiado não quer vê-lo religado
   * por efeito colateral. A tela oferece "usar o padrão do segmento" como ação
   * explícita, que manda os recursos junto.
   */
  alterar(alteracao: AlteracaoConfiguracaoLoja): Result<void, ErroValidacao[]> {
    const proxima: DadosConfiguracaoLoja = {
      id: this.id,
      segmento: alteracao.segmento ?? this.#segmento,
      recursos: alteracao.recursos ?? this.recursos,
      vendaSemEstoque: alteracao.vendaSemEstoque ?? this.#vendaSemEstoque,
      larguraCupom: alteracao.larguraCupom ?? this.#larguraCupom,
      impressaoComprovante: alteracao.impressaoComprovante ?? this.#impressaoComprovante,
      layoutBalanca: alteracao.layoutBalanca ?? this.#layoutBalanca,
      logoId: alteracao.logoId === null ? undefined : (alteracao.logoId ?? this.#logoId),
    };

    const erros = validar(proxima);
    if (erros.length > 0) return err(erros);

    this.#segmento = proxima.segmento;
    this.#recursos = new Set(proxima.recursos);
    this.#vendaSemEstoque = proxima.vendaSemEstoque;
    this.#larguraCupom = proxima.larguraCupom;
    this.#impressaoComprovante = proxima.impressaoComprovante;
    this.#layoutBalanca = proxima.layoutBalanca;
    this.#logoId = proxima.logoId;

    return ok(undefined);
  }
}

/** Recursos de fábrica de um segmento — o "usar o padrão" da tela. */
export function recursosDoSegmento(segmento: Segmento): readonly Recurso[] {
  return PREDEFINICOES[segmento].recursos;
}

function validar(dados: DadosConfiguracaoLoja): ErroValidacao[] {
  const erros: ErroValidacao[] = [];

  // Os tipos já fecham estes valores para quem compila; a conferência existe
  // para o que chega da rede e do banco, onde o tipo é uma promessa.
  if (!ehSegmento(dados.segmento)) {
    erros.push(
      new ErroValidacao("CONFIGURACAO_SEGMENTO_INVALIDO", "Escolha o tipo da loja.", {
        segmento: dados.segmento,
      }),
    );
  }

  for (const recurso of dados.recursos) {
    if (!ehRecurso(recurso)) {
      erros.push(
        new ErroValidacao(
          "CONFIGURACAO_RECURSO_DESCONHECIDO",
          "A configuração pede um recurso que não existe.",
          { recurso },
        ),
      );
    }
  }

  if (!ehRegraVendaSemEstoque(dados.vendaSemEstoque)) {
    erros.push(
      new ErroValidacao(
        "CONFIGURACAO_REGRA_ESTOQUE_INVALIDA",
        "Escolha o que fazer com produto sem estoque.",
      ),
    );
  }

  if (!ehLarguraCupom(dados.larguraCupom)) {
    erros.push(
      new ErroValidacao(
        "CONFIGURACAO_LARGURA_INVALIDA",
        "O papel do comprovante deve ser de 58 mm ou 80 mm.",
        { largura: dados.larguraCupom },
      ),
    );
  }

  if (!ehImpressaoComprovante(dados.impressaoComprovante)) {
    erros.push(
      new ErroValidacao(
        "CONFIGURACAO_IMPRESSAO_INVALIDA",
        "Escolha quando o comprovante é impresso.",
      ),
    );
  }

  erros.push(...validarLayoutBalanca(dados.layoutBalanca));

  return erros;
}
