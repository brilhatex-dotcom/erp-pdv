import {
  type ConfiguracaoLoja,
  type DomainError,
  ehCodigoDeBalanca,
  err,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  type Identificador,
  interpretarCodigoBalanca,
  type LayoutBalanca,
  ok,
  type Produto,
  Quantidade,
  type Result,
  type Venda,
  type VendaItem,
} from "@erp/domain";

import { auditar } from "../../auditoria/RegistroAuditoria.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { ProdutoRepository } from "../../portas/repositorios/Repositorios.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";
import type {
  AutorizarOperacao,
  CredencialSupervisor,
} from "../acesso/AutorizarOperacao.js";
import {
  carregarVenda,
  configuracaoDaLoja,
  custoNoMomento,
  quantidadeNaVenda,
} from "./apoio.js";

export interface EntradaAdicionarItem {
  readonly vendaId: Identificador;
  /** Quem está no balcão agora — é quem pede a liberação, se for preciso. */
  readonly operadorId: Identificador;
  /** O que o operador bipou, digitou ou tocou num botão. */
  readonly codigo: string;
  /**
   * Informada quando o operador digita (3 × código) ou pesa à mão. Pode vir em
   * gramas para produto vendido por quilo: a conversão é feita aqui, com
   * inteiros. Etiqueta de balança traz a sua e ignora esta.
   */
  readonly quantidade?: Quantidade | undefined;
  /** Só na segunda tentativa, depois de `AUTORIZACAO_NECESSARIA`. */
  readonly credencialSupervisor?: CredencialSupervisor | undefined;
  /**
   * `IMPORTACAO` remonta uma venda que a estação fez offline.
   *
   * Ela **já aconteceu**: o cliente levou a mercadoria e pagou. Por isso não
   * passa pela regra de venda sem estoque — recusar agora não desfaz nada, só
   * perde o registro — e entra linha a linha como no comprovante que o
   * cliente levou, sem somar leituras repetidas.
   */
  readonly origem?: "BALCAO" | "IMPORTACAO" | undefined;
}

export interface SaidaAdicionarItem {
  readonly venda: Venda;
  readonly item: VendaItem;
  /** A leitura somou a um item que já estava na venda. */
  readonly somado: boolean;
}

/**
 * Registra uma leitura do balcão — o caminho mais percorrido do sistema.
 *
 * Trata os fluxos do balcão:
 *
 * - **Etiqueta de balança**: o código traz produto e peso (ou preço) embutidos,
 *   e o item entra pronto, sem o operador digitar nada. Cada etiqueta é uma
 *   linha, porque cada uma é uma embalagem.
 * - **Código comum**: barras, código interno ou referência. A quantidade é um,
 *   salvo indicação; reler o mesmo produto soma na mesma linha
 *   (`Venda.registrarLeitura`).
 * - **Pesagem à mão**: o código do produto pesável com a quantidade que o
 *   operador leu na balança — em quilos ou em gramas.
 *
 * O layout da etiqueta e a regra de venda sem estoque vêm da configuração da
 * loja, lida a cada chamada: trocar a balança não pode exigir reiniciar o
 * servidor no meio do expediente.
 */
export class AdicionarItemPorCodigo {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
    private readonly autorizar: AutorizarOperacao,
  ) {}

  async executar(
    entrada: EntradaAdicionarItem,
  ): Promise<Result<SaidaAdicionarItem, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const carregada = await carregarVenda(repositorios, entrada.vendaId);
      if (carregada.isErr()) return err(carregada.error);

      const venda = carregada.unwrap();
      const configuracao = await configuracaoDaLoja(repositorios, this.geradorId);

      const localizado = await localizar(
        repositorios.produtos,
        entrada,
        configuracao.layoutBalanca,
      );
      if (localizado.isErr()) return err(localizado.error);

      const { produto, quantidade } = localizado.unwrap();

      if (!produto.ativo) {
        return err(
          new ErroRegraNegocio(
            "PRODUTO_INATIVO",
            `${produto.descricao} está inativo e não pode ser vendido.`,
            { produtoId: produto.id.valor },
          ),
        );
      }

      const importacao = entrada.origem === "IMPORTACAO";

      if (!importacao) {
        const estoque = await this.#conferirEstoque(
          repositorios,
          configuracao,
          venda,
          produto,
          quantidade,
          entrada,
        );
        if (estoque.isErr()) return err(estoque.error);
      }

      const dados = {
        produtoId: produto.id,
        descricao: produto.descricaoPdv,
        quantidade,
        precoUnitario: produto.precoVenda,
        custoUnitario: await custoNoMomento(repositorios, produto),
      };

      const leitura = importacao
        ? venda.adicionarItem(dados).map((item) => ({ item, somado: false }))
        : venda.registrarLeitura(dados);

      if (leitura.isErr()) return err(leitura.error);

      await repositorios.vendas.salvar(venda);

      const { item, somado } = leitura.unwrap();

      return ok({ venda, item, somado });
    });
  }

  /**
   * Aplica a regra da loja para produto sem saldo.
   *
   * Confere a quantidade **somada** ao que a venda já tem do produto: com três
   * no estoque, a quarta bipada é a que falta, mesmo que cada uma isolada
   * coubesse.
   */
  async #conferirEstoque(
    repositorios: Repositorios,
    configuracao: ConfiguracaoLoja,
    venda: Venda,
    produto: Produto,
    quantidade: Quantidade,
    entrada: EntradaAdicionarItem,
  ): Promise<Result<void, DomainError>> {
    // Permitir é o padrão, e é silencioso: a padaria que não controla o pão
    // de hoje veria o aviso a cada bipada — e aprenderia a ignorar avisos.
    if (configuracao.vendaSemEstoque === "PERMITIR") return ok(undefined);

    const saldo = await repositorios.estoque.saldo(
      produto.id,
      produto.unidadeBase.codigo,
    );
    const pedido = quantidadeNaVenda(venda, produto.id) + quantidade.milesimos;

    if (saldo.milesimos >= pedido) return ok(undefined);

    const disponivel = saldo.milesimos > 0n ? saldo.quantidade.formatar() : "nada";

    if (configuracao.vendaSemEstoque === "BLOQUEAR") {
      return err(
        new ErroRegraNegocio(
          "ESTOQUE_INSUFICIENTE",
          `Não há estoque de ${produto.descricaoPdv} para esta venda (disponível: ${disponivel}).`,
          { produtoId: produto.id.valor, disponivel: saldo.milesimos.toString() },
        ),
      );
    }

    const autorizacao = await this.autorizar.executar(repositorios, {
      solicitanteId: entrada.operadorId,
      acao: { tipo: "VENDA_SEM_ESTOQUE" },
      descricao: `Venda de ${produto.descricaoPdv} sem estoque na venda ${String(venda.numero)}`,
      credencialSupervisor: entrada.credencialSupervisor,
    });

    if (autorizacao.isErr()) return err(autorizacao.error);

    await auditar(repositorios, this.geradorId, {
      ocorridoEm: this.relogio.agora(),
      acao: "VENDA_SEM_ESTOQUE",
      usuarioId: entrada.operadorId,
      autorizadoPorId: autorizacao.unwrap().autorizadoPorId,
      descricao: `Venda de ${quantidade.formatar()} de ${produto.descricaoPdv} sem estoque (disponível: ${disponivel}) na venda ${String(venda.numero)}`,
      entidade: "venda",
      entidadeId: venda.id,
      dados: { produtoId: produto.id.valor, disponivel: saldo.milesimos.toString() },
    });

    return ok(undefined);
  }
}

/** Descobre o produto e a quantidade a partir do que foi lido. */
async function localizar(
  produtos: ProdutoRepository,
  entrada: EntradaAdicionarItem,
  layout: LayoutBalanca,
): Promise<Result<{ produto: Produto; quantidade: Quantidade }, DomainError>> {
  if (ehCodigoDeBalanca(entrada.codigo, layout)) {
    return localizarPorBalanca(produtos, entrada.codigo, layout);
  }

  const produto = await produtos.porCodigo(entrada.codigo);

  if (produto === undefined) {
    return err(
      new ErroNaoEncontrado(
        "PRODUTO_NAO_ENCONTRADO",
        "Produto não encontrado. Confira o código ou procure pelo nome.",
        { codigo: entrada.codigo },
      ),
    );
  }

  const unidade = produto.unidadeBase.codigo;

  if (entrada.quantidade === undefined) {
    // Pesável sem peso entraria como 1 kg — o queijo de 350 g cobrado por um
    // quilo inteiro. A tela recebe o produto junto com a recusa e abre o campo
    // de peso já com o nome e o preço por quilo. A venda offline importada é
    // a exceção: ela já aconteceu, com a quantidade que a estação registrou.
    if (produto.tipo === "PESAVEL" && entrada.origem !== "IMPORTACAO") {
      return err(
        new ErroRegraNegocio(
          "PRODUTO_EXIGE_PESO",
          `Informe o peso de ${produto.descricaoPdv}.`,
          {
            produto: {
              id: produto.id.valor,
              codigo: produto.sku,
              descricao: produto.descricaoPdv,
              precoVenda: produto.precoVenda.centavos.toString(),
              unidade,
            },
          },
        ),
      );
    }

    return ok({
      produto,
      quantidade: Quantidade.de("1", unidade).unwrapOr(Quantidade.zero(unidade)),
    });
  }

  // 350 g de um produto vendido por quilo viram 0,350 kg aqui, e não na tela:
  // a conta que decide quanto o cliente paga não pode depender do navegador.
  const convertida = entrada.quantidade.converterMedida(unidade);

  if (convertida.isErr()) {
    return err(
      new ErroRegraNegocio(
        "PRODUTO_UNIDADE_INCOMPATIVEL",
        `${produto.descricaoPdv} é vendido em ${produto.unidadeBase.descricao.toLowerCase()}.`,
        { esperada: unidade, recebida: entrada.quantidade.unidade.codigo },
      ),
    );
  }

  return ok({ produto, quantidade: convertida.unwrap() });
}

async function localizarPorBalanca(
  produtos: ProdutoRepository,
  codigo: string,
  layout: LayoutBalanca,
): Promise<Result<{ produto: Produto; quantidade: Quantidade }, DomainError>> {
  const leitura = interpretarCodigoBalanca(codigo, layout);
  if (leitura.isErr()) return err(leitura.error);

  const { codigoProduto, peso, preco } = leitura.unwrap();
  const produto = await produtos.porCodigoBalanca(codigoProduto);

  if (produto === undefined) {
    return err(
      new ErroNaoEncontrado(
        "PRODUTO_NAO_ENCONTRADO",
        "Produto da etiqueta não encontrado. Confira o cadastro da balança.",
        { codigoBalanca: codigoProduto },
      ),
    );
  }

  if (peso !== undefined) {
    const convertido = peso.converterMedida(produto.unidadeBase.codigo);
    if (convertido.isErr()) return err(convertido.error);

    return ok({ produto, quantidade: convertido.unwrap() });
  }

  // Layout que embute o preço total: a quantidade é deduzida dividindo pelo
  // preço unitário. Sem preço não há como deduzir, e adivinhar seria pior do
  // que recusar — cobrar errado é o defeito mais caro do balcão.
  if (preco === undefined || !produto.precoVenda.ehPositivo()) {
    return err(
      new ErroRegraNegocio(
        "BALANCA_QUANTIDADE_INDETERMINADA",
        "Não foi possível calcular a quantidade da etiqueta. Registre o item manualmente.",
        { codigoBalanca: codigoProduto },
      ),
    );
  }

  const milesimos = (preco.centavos * 1000n) / produto.precoVenda.centavos;

  const quantidade = Quantidade.deMilesimos(milesimos, produto.unidadeBase.codigo);

  if (quantidade.isErr()) return err(quantidade.error);

  return ok({ produto, quantidade: quantidade.unwrap() });
}
