import { ErroValidacao } from "../shared/DomainError.js";
import { Entity } from "../shared/Entity.js";
import type { Identificador } from "../shared/Identificador.js";
import { err, ok, type Result } from "../shared/Result.js";
import type { Dinheiro } from "../valores/Dinheiro.js";

import { ehPermissao, type Permissao } from "./Permissao.js";

/** Cem por cento, em pontos-base. */
export const BASE_PERCENTUAL = 10_000;

/**
 * Limites numéricos do papel.
 *
 * Percentual é **inteiro em pontos-base** — 500 = 5% — pela mesma razão que
 * dinheiro é inteiro em centavos: `0.1 + 0.2` não é `0.3`, e um desconto que
 * erra na terceira casa vira divergência no fechamento do caixa.
 *
 * `undefined` significa **sem limite**, e não "zero". A distinção importa: o
 * gerente com sangria ilimitada e o operador que não pode sangrar precisam ser
 * representáveis, e confundir os dois liberaria o caixa para quem não deveria.
 */
export interface LimitesPapel {
  /** Desconto máximo em um item, em pontos-base. */
  readonly descontoMaximoItemBps?: number | undefined;
  /** Desconto máximo sobre a venda inteira, em pontos-base. */
  readonly descontoMaximoVendaBps?: number | undefined;
  readonly valorMaximoSangria?: Dinheiro | undefined;
  /** Janela para cancelar uma venda já finalizada, em minutos. */
  readonly minutosParaCancelarVenda?: number | undefined;
  readonly estornoMaximoEmDinheiro?: Dinheiro | undefined;
}

export interface DadosPapel {
  readonly id: Identificador;
  /** Estável e legível — é o que aparece em log e auditoria. */
  readonly codigo: string;
  readonly nome: string;
  readonly permissoes: readonly Permissao[];
  readonly limites?: LimitesPapel | undefined;
  /**
   * Papel de fábrica. Pode ser copiado, não excluído: apagar o papel do
   * operador de caixa deixaria a loja sem quem vende.
   */
  readonly padrao?: boolean | undefined;
}

/**
 * Papel — o conjunto de permissões e limites de um usuário.
 *
 * Papel puro não basta num ERP: "pode dar desconto" precisa responder
 * **quanto**. Por isso o papel carrega permissões *e* limites por valor
 * (ARQUITETURA.md §9.1).
 *
 * Papéis são **personalizáveis**. Os de fábrica cobrem o comércio típico, mas
 * uma loja com um funcionário que vende e repõe estoque cria o papel dela em
 * vez de receber uma resposta de que o sistema não faz isso.
 */
export class Papel extends Entity {
  readonly #codigo: string;
  readonly #nome: string;
  readonly #permissoes: ReadonlySet<Permissao>;
  readonly #limites: LimitesPapel;
  readonly #padrao: boolean;

  private constructor(dados: DadosPapel, codigo: string, nome: string) {
    super(dados.id);
    this.#codigo = codigo;
    this.#nome = nome;
    this.#permissoes = new Set(dados.permissoes);
    this.#limites = dados.limites ?? {};
    this.#padrao = dados.padrao ?? false;
  }

  static criar(dados: DadosPapel): Result<Papel, ErroValidacao[]> {
    const erros: ErroValidacao[] = [];

    const codigo = dados.codigo.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(codigo)) {
      erros.push(
        new ErroValidacao(
          "PAPEL_CODIGO_INVALIDO",
          "O código do papel deve começar por letra e usar apenas letras, números e sublinhado.",
          { codigo: dados.codigo },
        ),
      );
    }

    const nome = dados.nome.trim();
    if (nome === "") {
      erros.push(new ErroValidacao("PAPEL_NOME_VAZIO", "Informe o nome do papel."));
    }

    for (const permissao of dados.permissoes) {
      if (!ehPermissao(permissao)) {
        erros.push(
          new ErroValidacao(
            "PAPEL_PERMISSAO_DESCONHECIDA",
            "Este papel referencia uma permissão que não existe mais.",
            { permissao },
          ),
        );
      }
    }

    erros.push(...validarLimites(dados.limites ?? {}));

    if (erros.length > 0) {
      return err(erros);
    }

    return ok(new Papel(dados, codigo, nome));
  }

  /** Uso exclusivo do repositório. Ver `Produto.reconstituir` sobre não revalidar. */
  static reconstituir(dados: DadosPapel): Papel {
    return new Papel(dados, dados.codigo.trim().toUpperCase(), dados.nome.trim());
  }

  get codigo(): string {
    return this.#codigo;
  }

  get nome(): string {
    return this.#nome;
  }

  get permissoes(): ReadonlySet<Permissao> {
    return this.#permissoes;
  }

  get limites(): LimitesPapel {
    return this.#limites;
  }

  get ehPadrao(): boolean {
    return this.#padrao;
  }

  /**
   * Verifica se o papel concede a permissão.
   *
   * **Nega por padrão**: permissão ausente é permissão negada. É isso que
   * impede que uma funcionalidade nova abra acesso por esquecimento.
   */
  concede(permissao: Permissao): boolean {
    return this.#permissoes.has(permissao);
  }
}

function validarLimites(limites: LimitesPapel): ErroValidacao[] {
  const erros: ErroValidacao[] = [];

  const percentuais = [
    ["descontoMaximoItemBps", limites.descontoMaximoItemBps],
    ["descontoMaximoVendaBps", limites.descontoMaximoVendaBps],
  ] as const;

  for (const [campo, valor] of percentuais) {
    if (valor === undefined) continue;

    if (!Number.isInteger(valor) || valor < 0 || valor > BASE_PERCENTUAL) {
      erros.push(
        new ErroValidacao(
          "PAPEL_LIMITE_PERCENTUAL_INVALIDO",
          "O limite de desconto deve estar entre 0% e 100%.",
          { campo, valor },
        ),
      );
    }
  }

  const { minutosParaCancelarVenda } = limites;
  if (
    minutosParaCancelarVenda !== undefined &&
    (!Number.isInteger(minutosParaCancelarVenda) || minutosParaCancelarVenda < 0)
  ) {
    erros.push(
      new ErroValidacao(
        "PAPEL_JANELA_CANCELAMENTO_INVALIDA",
        "A janela de cancelamento deve ser um número de minutos não negativo.",
        { minutos: minutosParaCancelarVenda },
      ),
    );
  }

  const valores = [
    ["valorMaximoSangria", limites.valorMaximoSangria],
    ["estornoMaximoEmDinheiro", limites.estornoMaximoEmDinheiro],
  ] as const;

  for (const [campo, valor] of valores) {
    if (valor !== undefined && valor.ehNegativo()) {
      erros.push(
        new ErroValidacao("PAPEL_LIMITE_NEGATIVO", "O limite não pode ser negativo.", {
          campo,
        }),
      );
    }
  }

  return erros;
}
