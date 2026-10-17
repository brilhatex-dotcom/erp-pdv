import {
  Categoria,
  Cliente,
  CNPJ,
  CodigoBarras,
  ConfiguracaoLoja,
  type CredencialHash,
  Dinheiro,
  type DomainError,
  Empresa,
  Endereco,
  err,
  type Identificador,
  Matricula,
  ok,
  Papel,
  papelPadrao,
  Pin,
  Produto,
  Quantidade,
  type Result,
  Usuario,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Hasher } from "../../portas/infraestrutura/Hasher.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { Repositorios } from "../../portas/repositorios/Repositorios.js";
import { movimentar } from "../estoque/movimentar.js";

import {
  CATEGORIAS_DE_TREINO,
  CLIENTES_DE_TREINO,
  PESSOAS_DE_TREINO,
  PRODUTOS_DE_TREINO,
} from "./lojaDeTreino.js";

/**
 * O banco do treinamento, visto pela aplicação.
 *
 * É porta porque esvaziar um banco inteiro é infraestrutura — e porque a trava
 * que impede de esvaziar o banco da loja precisa morar onde o banco é
 * conhecido: só ele sabe o próprio nome.
 */
export interface BancoDeTreinamento {
  /**
   * Confere que este é o banco de treino, e recusa quando não é.
   *
   * Vem antes de montar a loja: num banco de loja recém-instalado, ainda sem
   * ninguém cadastrado, a montagem gravaria um gerente com PIN público.
   */
  conferir(): Promise<Result<void, DomainError>>;

  /**
   * Apaga tudo o que o treino produziu, deixando as tabelas vazias.
   *
   * Recusa — com erro, sem apagar nada — quando o banco não é o de treino.
   */
  esvaziar(): Promise<Result<void, DomainError>>;
}

/**
 * A loja de demonstração do modo treinamento (ADR-0026): montá-la quando o
 * banco de treino está vazio, e recomeçá-la do zero quando quem treina pede.
 *
 * ### Uma operação por vez
 *
 * Duas estações abrindo o treino no mesmo segundo veriam as duas o banco vazio
 * e montariam a loja duas vezes — e a segunda esbarraria na matrícula da
 * primeira. Recomeçar no meio de uma montagem apagaria metade dela. A fila
 * deste objeto põe uma depois da outra; o servidor da loja é um processo só.
 *
 * ### O banco vazio é o sinal
 *
 * Sem pessoas cadastradas, não há treino possível — é o que define "vazio".
 * Não existe marca de "já montado" para ficar desencontrada do conteúdo: quem
 * apaga o banco por fora recebe a loja de volta na próxima abertura do treino.
 */
export class LojaDeTreinamento {
  /** A operação em curso. Nunca rejeita: a fila anda mesmo depois de uma falha. */
  #vez: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly banco: BancoDeTreinamento,
    private readonly geradorId: GeradorId,
    private readonly hasher: Hasher,
    private readonly relogio: Relogio,
  ) {}

  /** Monta a loja se o banco estiver vazio. Devolve `true` quando montou agora. */
  preparar(): Promise<Result<boolean, DomainError>> {
    return this.#naVez(() => this.#preparar());
  }

  /** Apaga tudo o que o treino produziu e monta a loja de novo. */
  recomecar(): Promise<Result<void, DomainError>> {
    return this.#naVez(async () => {
      const esvaziado = await this.banco.esvaziar();
      if (esvaziado.isErr()) return err(esvaziado.error);

      const preparado = await this.#preparar();

      return preparado.isErr() ? err(preparado.error) : ok(undefined);
    });
  }

  #naVez<T>(trabalho: () => Promise<T>): Promise<T> {
    const minha = this.#vez.then(trabalho);
    this.#vez = minha.then(
      () => undefined,
      () => undefined,
    );

    return minha;
  }

  async #preparar(): Promise<Result<boolean, DomainError>> {
    const conferido = await this.banco.conferir();
    if (conferido.isErr()) return err(conferido.error);

    const vazio = await this.unitOfWork.transacao(async (repositorios) =>
      ok((await repositorios.usuarios.quantidade()) === 0),
    );

    if (vazio.isErr()) return err(vazio.error);
    if (!vazio.unwrap()) return ok(false);

    // Fora da transação: o Argon2id é lento de propósito, e uma transação
    // aberta enquanto ele calcula seguraria uma conexão do pool à toa.
    const pins = new Map<string, CredencialHash>();
    for (const pessoa of PESSOAS_DE_TREINO) {
      pins.set(
        pessoa.matricula,
        await this.hasher.hash(Pin.criar(pessoa.pin).unwrap().valorEmClaro),
      );
    }

    return this.unitOfWork.transacao(async (repositorios) => {
      // De novo, dentro da transação: a fila acima vale para este processo, e
      // um segundo servidor apontado para o mesmo banco não passa por ela.
      if ((await repositorios.usuarios.quantidade()) > 0) return ok(false);

      await montarLoja(repositorios, this.geradorId, this.relogio.agora(), pins);

      return ok(true);
    });
  }
}

/**
 * Grava a loja de demonstração.
 *
 * Os dados são constantes deste módulo: um que não passe na validação é
 * defeito de programação, e o `unwrap` que estoura é o certo (princípio 7) —
 * a transação desfaz o que já tinha entrado.
 */
async function montarLoja(
  repositorios: Repositorios,
  geradorId: GeradorId,
  agora: Date,
  pins: ReadonlyMap<string, CredencialHash>,
): Promise<void> {
  const papeis = new Map<string, Papel>();
  for (const codigo of new Set(PESSOAS_DE_TREINO.map((pessoa) => pessoa.papel))) {
    const papel = Papel.criar(papelPadrao(codigo, geradorId.proximo())).unwrap();
    await repositorios.papeis.salvar(papel);
    papeis.set(codigo, papel);
  }

  let responsavel: Identificador | undefined;
  for (const pessoa of PESSOAS_DE_TREINO) {
    const usuario = Usuario.criar({
      id: geradorId.proximo(),
      matricula: Matricula.criar(pessoa.matricula).unwrap(),
      nome: pessoa.nome,
      papel: exigir(papeis.get(pessoa.papel), `papel ${pessoa.papel}`),
      hashPin: exigir(pins.get(pessoa.matricula), `PIN da matrícula ${pessoa.matricula}`),
      // O PIN é público e fica: trocá-lo no primeiro acesso deixaria o
      // próximo aluno sem conseguir entrar.
      precisaTrocarCredencial: false,
    }).unwrap();

    await repositorios.usuarios.salvar(usuario);
    if (pessoa.papel === "GERENTE") responsavel = usuario.id;
  }

  const empresa = Empresa.criar({
    id: geradorId.proximo(),
    razaoSocial: "Loja de Treinamento",
    nomeFantasia: "Loja de Treinamento",
    cnpj: CNPJ.criar("11222333000181").unwrap(),
    regimeTributario: "SIMPLES_NACIONAL",
    endereco: Endereco.criar({
      logradouro: "Rua do Treinamento",
      numero: "100",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01001000",
    }).unwrap(),
  }).unwrap();
  await repositorios.empresa.salvar(empresa);

  const configuracao = ConfiguracaoLoja.padrao(geradorId.proximo(), "MISTO");
  // Sob pedido: o treino imprime quando quem treina pede, e não gasta uma
  // bobina inteira de vendas de mentira.
  configuracao.alterar({ impressaoComprovante: "SOB_PEDIDO" }).unwrap();
  await repositorios.configuracao.salvar(configuracao);

  const categorias = new Map<string, Identificador>();
  for (const dados of CATEGORIAS_DE_TREINO) {
    const categoria = Categoria.criar({
      id: geradorId.proximo(),
      nome: dados.nome,
      icone: dados.icone,
    }).unwrap();

    await repositorios.categorias.salvar(categoria);
    categorias.set(dados.chave, categoria.id);
  }

  const gerente = exigir(responsavel, "o gerente de treino");
  for (const dados of PRODUTOS_DE_TREINO) {
    const produto = Produto.criar({
      id: geradorId.proximo(),
      sku: dados.sku,
      descricao: dados.descricao,
      tipo: dados.tipo,
      unidadeBase: dados.unidade,
      precoVenda: Dinheiro.deReais(dados.preco).unwrap(),
      custo: Dinheiro.deReais(dados.custo).unwrap(),
      codigoBarras:
        dados.codigoBarras === undefined
          ? undefined
          : CodigoBarras.criar(dados.codigoBarras).unwrap(),
      codigoBalanca: dados.codigoBalanca,
      categoriaId: exigir(
        categorias.get(dados.categoria),
        `categoria ${dados.categoria}`,
      ),
      botaoRapido: dados.botaoRapido,
    }).unwrap();

    await repositorios.produtos.salvar(produto);

    (
      await movimentar(repositorios, geradorId, produto, {
        tipo: "ENTRADA",
        quantidade: Quantidade.de(dados.estoque, dados.unidade).unwrap(),
        custoUnitario: produto.custo,
        observacao: "Estoque inicial do treinamento",
        usuarioId: gerente,
        origem: { tipo: "MANUAL" },
        ocorridoEm: agora,
      })
    ).unwrap();
  }

  for (const dados of CLIENTES_DE_TREINO) {
    const cliente = Cliente.criar({
      id: geradorId.proximo(),
      nome: dados.nome,
      apelido: dados.apelido,
      tipoPessoa: "FISICA",
      limiteCredito: Dinheiro.deReais(dados.limite).unwrap(),
    }).unwrap();

    await repositorios.clientes.salvar(cliente);
  }
}

/** O valor que os dados constantes garantem existir — ou o defeito, com nome. */
function exigir<T>(valor: T | undefined, oQue: string): T {
  /* v8 ignore next -- inalcançável: os dados constantes garantem cada valor */
  if (valor === undefined) throw new Error(`Loja de treino incompleta: falta ${oQue}.`);

  return valor;
}
