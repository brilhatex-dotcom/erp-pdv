import { ErroValidacao } from "../shared/DomainError.js";
import { err, ok, type Result } from "../shared/Result.js";
import { Dinheiro } from "../valores/Dinheiro.js";

import { ILIMITADO, LimitesPapel, PERCENTUAL_TOTAL } from "./LimitesPapel.js";
import { ehPermissao, type Permissao, PERMISSOES } from "./Permissao.js";

/**
 * Papel — um conjunto de permissões e limites, com nome.
 *
 * Identificado por **código natural** (`OPERADOR_CAIXA`), não por UUID. A razão
 * do ADR-0008 para o UUID é permitir criar o registro offline, sem consultar o
 * banco; papel não é criado no balcão nem offline, é configurado uma vez na
 * retaguarda. Em troca, o código aparece legível no log de auditoria, na
 * configuração e na conversa com o suporte — que é onde ele é realmente lido.
 * Mesmo raciocínio do ADR-0017 para as tabelas filhas.
 *
 * Os sete papéis de fábrica (§9.2) são **ponto de partida, não camisa de
 * força**: a empresa cria os seus combinando permissões. Um mercadinho com três
 * funcionários usa os padrões; uma casa de construção com conferente e
 * orçamentista precisa de papéis que ninguém previu aqui.
 */

const FORMATO_CODIGO = /^[A-Z][A-Z0-9_]{1,29}$/;

export interface DadosPapel {
  readonly codigo: string;
  readonly nome: string;
  readonly permissoes: readonly Permissao[];
  readonly limites: LimitesPapel;
}

export class Papel {
  readonly #codigo: string;
  readonly #nome: string;
  readonly #permissoes: ReadonlySet<Permissao>;
  readonly #limites: LimitesPapel;

  private constructor(dados: DadosPapel) {
    this.#codigo = dados.codigo;
    this.#nome = dados.nome;
    this.#permissoes = new Set(dados.permissoes);
    this.#limites = dados.limites;
  }

  static criar(dados: DadosPapel): Result<Papel, ErroValidacao> {
    const codigo = dados.codigo.trim().toUpperCase();

    if (!FORMATO_CODIGO.test(codigo)) {
      return err(
        new ErroValidacao(
          "PAPEL_CODIGO_INVALIDO",
          "O código do papel deve ter de 2 a 30 letras, números ou sublinhado, começando por letra.",
          { valorRecebido: dados.codigo },
        ),
      );
    }

    const nome = dados.nome.trim();

    if (nome === "") {
      return err(new ErroValidacao("PAPEL_SEM_NOME", "Informe o nome do papel."));
    }

    return ok(new Papel({ ...dados, codigo, nome }));
  }

  /**
   * Reconstrói a partir do banco, descartando permissão desconhecida.
   *
   * Permissão que o código não conhece acontece de verdade: a base ficou numa
   * versão à frente da aplicação, ou uma permissão foi removida do produto.
   * Descartar é a escolha segura — negar por padrão (§9.5). Confiar no texto
   * abriria acesso a partir de uma linha de banco.
   */
  static reconstituir(dados: {
    readonly codigo: string;
    readonly nome: string;
    readonly permissoes: readonly string[];
    readonly limites: LimitesPapel;
  }): Result<Papel, ErroValidacao> {
    return Papel.criar({
      ...dados,
      permissoes: dados.permissoes.filter(ehPermissao),
    });
  }

  get codigo(): string {
    return this.#codigo;
  }

  get nome(): string {
    return this.#nome;
  }

  get permissoes(): readonly Permissao[] {
    return [...this.#permissoes];
  }

  get limites(): LimitesPapel {
    return this.#limites;
  }

  concede(permissao: Permissao): boolean {
    return this.#permissoes.has(permissao);
  }

  equals(outro: Papel): boolean {
    return this.#codigo === outro.#codigo;
  }
}

/**
 * Os sete papéis de fábrica.
 *
 * Instalados no primeiro acesso. Cada "não pode" da tabela do §9.2 aparece aqui
 * como **ausência** de permissão, nunca como negação explícita: com negar por
 * padrão, funcionalidade nova jamais abre acesso por esquecimento.
 */
export function papeisDeFabrica(): Papel[] {
  return [
    montar({
      codigo: "OPERADOR_CAIXA",
      nome: "Operador de caixa",
      // Repare no que falta: `venda:cancelar`, `produto:ver_custo` e
      // `venda:consultar_todas`. São exatamente os três vetores de furto interno
      // mapeados no §7.1.
      permissoes: [
        "venda:criar",
        "venda:desconto",
        "venda:consultar_propria",
        "caixa:abrir",
        "caixa:fechar",
        "fiscal:emitir",
      ],
      limites: {
        descontoItem: 500,
        descontoVenda: 300,
        sangria: Dinheiro.zero(),
        estornoEmDinheiro: Dinheiro.zero(),
        cancelarVendaAteMinutos: 0,
      },
    }),

    montar({
      codigo: "SUPERVISOR",
      nome: "Supervisor",
      permissoes: [
        "venda:criar",
        "venda:cancelar",
        "venda:desconto",
        "venda:desconto_acima_limite",
        "venda:consultar_propria",
        "venda:consultar_todas",
        "caixa:abrir",
        "caixa:fechar",
        "caixa:sangria",
        "fiscal:emitir",
        "fiscal:cancelar",
        "relatorio:vendas",
      ],
      limites: {
        descontoItem: 1_500,
        descontoVenda: 1_000,
        sangria: reais("500.00"),
        estornoEmDinheiro: reais("200.00"),
        cancelarVendaAteMinutos: 30,
      },
    }),

    montar({
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
      limites: {
        descontoItem: 0,
        descontoVenda: 0,
        sangria: Dinheiro.zero(),
        estornoEmDinheiro: Dinheiro.zero(),
        cancelarVendaAteMinutos: 0,
      },
    }),

    montar({
      codigo: "FINANCEIRO",
      nome: "Financeiro",
      permissoes: [
        "financeiro:ver",
        "financeiro:lancar",
        "financeiro:conciliar",
        "relatorio:financeiro",
        "venda:consultar_todas",
      ],
      limites: {
        descontoItem: 0,
        descontoVenda: 0,
        sangria: Dinheiro.zero(),
        estornoEmDinheiro: Dinheiro.zero(),
        cancelarVendaAteMinutos: 0,
      },
    }),

    montar({
      codigo: "GERENTE",
      nome: "Gerente",
      // Sem `config:fiscal` nem `usuario:editar_permissoes`: configuração fiscal
      // errada gera passivo com o fisco, e quem edita permissões pode se
      // promover. Ambas ficam com o ADMIN.
      permissoes: [
        "venda:criar",
        "venda:cancelar",
        "venda:desconto",
        "venda:desconto_acima_limite",
        "venda:consultar_propria",
        "venda:consultar_todas",
        "produto:criar",
        "produto:editar",
        "produto:alterar_preco",
        "produto:ver_custo",
        "estoque:entrada",
        "estoque:ajuste",
        "estoque:inventario",
        "caixa:abrir",
        "caixa:fechar",
        "caixa:sangria",
        "caixa:reabrir",
        "fiscal:emitir",
        "fiscal:cancelar",
        "financeiro:ver",
        "relatorio:vendas",
        "relatorio:financeiro",
        "relatorio:margem",
        "usuario:criar",
        "config:empresa",
      ],
      limites: {
        descontoItem: 3_000,
        descontoVenda: 2_500,
        sangria: ILIMITADO,
        estornoEmDinheiro: ILIMITADO,
        cancelarVendaAteMinutos: ILIMITADO,
      },
    }),

    montar({
      codigo: "CONTADOR",
      nome: "Contador",
      // Somente leitura, por definição: o contador precisa ver e exportar, e
      // qualquer escrita dele seria feita sem conhecer a operação da loja.
      permissoes: [
        "venda:consultar_todas",
        "financeiro:ver",
        "relatorio:vendas",
        "relatorio:financeiro",
        "produto:ver_custo",
      ],
      limites: {
        descontoItem: 0,
        descontoVenda: 0,
        sangria: Dinheiro.zero(),
        estornoEmDinheiro: Dinheiro.zero(),
        cancelarVendaAteMinutos: 0,
      },
    }),

    montar({
      codigo: "ADMIN",
      nome: "Administrador",
      permissoes: [...PERMISSOES],
      limites: {
        descontoItem: PERCENTUAL_TOTAL,
        descontoVenda: PERCENTUAL_TOTAL,
        sangria: ILIMITADO,
        estornoEmDinheiro: ILIMITADO,
        cancelarVendaAteMinutos: ILIMITADO,
      },
    }),
  ];
}

/**
 * Constrói papel de fábrica.
 *
 * O `unwrap` é intencional: dados de fábrica inválidos são bug de programação, e
 * o teste que percorre `papeisDeFabrica()` o pega antes de qualquer instalação.
 */
function montar(dados: {
  readonly codigo: string;
  readonly nome: string;
  readonly permissoes: readonly Permissao[];
  readonly limites: Parameters<typeof LimitesPapel.criar>[0];
}): Papel {
  return Papel.criar({
    codigo: dados.codigo,
    nome: dados.nome,
    permissoes: dados.permissoes,
    limites: LimitesPapel.criar(dados.limites).unwrap(),
  }).unwrap();
}

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}
