import {
  type CredencialHash,
  type DomainError,
  err,
  ErroRegraNegocio,
  interpretarCodigoBalanca,
  LAYOUT_BALANCA_PADRAO,
  Matricula,
  ok,
  Papel,
  papelPadrao,
  type Result,
  Usuario,
} from "@erp/domain";
import { describe, expect, it } from "vitest";

import { HasherFalso, montarAmbiente } from "../../testes/dubles.js";

import { type BancoDeTreinamento, LojaDeTreinamento } from "./LojaDeTreinamento.js";
import {
  CLIENTES_DE_TREINO,
  exemplosDeCodigo,
  PESSOAS_DE_TREINO,
  PRODUTOS_DE_TREINO,
} from "./lojaDeTreino.js";

type Ambiente = ReturnType<typeof montarAmbiente>;

/** O banco de treino dos dublês: esvaziar é limpar o que a loja grava. */
class BancoEmMemoria implements BancoDeTreinamento {
  esvaziamentos = 0;
  recusa: DomainError | undefined;

  constructor(private readonly ambiente: Ambiente) {}

  conferir(): Promise<Result<void, DomainError>> {
    return Promise.resolve(this.recusa === undefined ? ok(undefined) : err(this.recusa));
  }

  esvaziar(): Promise<Result<void, DomainError>> {
    if (this.recusa !== undefined) return Promise.resolve(err(this.recusa));

    this.esvaziamentos += 1;
    const { ambiente } = this;
    ambiente.usuarios.itens.clear();
    ambiente.papeis.itens.clear();
    ambiente.produtos.itens.clear();
    ambiente.categorias.itens.clear();
    ambiente.clientes.itens.clear();
    ambiente.vendas.itens.clear();
    ambiente.estoque.movimentos.length = 0;
    ambiente.configuracao.configuracao = undefined;

    return Promise.resolve(ok(undefined));
  }
}

function montar(ambiente: Ambiente = montarAmbiente()): {
  readonly ambiente: Ambiente;
  readonly banco: BancoEmMemoria;
  readonly loja: LojaDeTreinamento;
} {
  const banco = new BancoEmMemoria(ambiente);

  return {
    ambiente,
    banco,
    loja: new LojaDeTreinamento(
      ambiente.unitOfWork,
      banco,
      ambiente.geradorId,
      ambiente.hasher,
      ambiente.relogio,
    ),
  };
}

/** Uma pessoa cadastrada por fora da loja de treino. */
async function alguemJaCadastrado(ambiente: Ambiente): Promise<void> {
  const papel = Papel.criar(papelPadrao("ADMIN", ambiente.geradorId.proximo())).unwrap();
  await ambiente.papeis.salvar(papel);
  await ambiente.usuarios.salvar(
    Usuario.criar({
      id: ambiente.geradorId.proximo(),
      matricula: Matricula.criar("1").unwrap(),
      nome: "Dona da loja",
      papel,
      hashSenha: await ambiente.hasher.hash("uma senha qualquer"),
    }).unwrap(),
  );
}

describe("LojaDeTreinamento — montar a loja", () => {
  it("🔑 no banco vazio, monta a loja inteira: pessoas, produtos, estoque e clientes", async () => {
    const { ambiente, loja } = montar();

    expect((await loja.preparar()).unwrap()).toBe(true);

    for (const pessoa of PESSOAS_DE_TREINO) {
      const usuario = await ambiente.usuarios.porMatricula(
        Matricula.criar(pessoa.matricula).unwrap(),
      );

      expect(usuario?.nome).toBe(pessoa.nome);
      expect(usuario?.papel.codigo).toBe(pessoa.papel);
      // O PIN de treino vale de cara: ninguém é obrigado a trocá-lo.
      expect(usuario?.precisaTrocarCredencial).toBe(false);
      expect(usuario?.hashPin?.valor).toBe(`falso:${pessoa.pin}`);
    }
    expect(ambiente.papeis.itens.size).toBe(3);

    const empresa = await ambiente.empresa.atual();
    expect(empresa?.exibicao).toBe("Loja de Treinamento");

    const configuracao = await ambiente.configuracao.atual();
    expect(configuracao?.segmento).toBe("MISTO");
    expect(configuracao?.impressaoComprovante).toBe("SOB_PEDIDO");
    expect(configuracao?.recursos).toEqual(
      expect.arrayContaining(["VENDA_POR_PESO", "FIADO", "BOTOES_RAPIDOS"]),
    );

    expect(ambiente.categorias.itens.size).toBe(5);
    expect(ambiente.produtos.itens.size).toBe(PRODUTOS_DE_TREINO.length);

    const pao = await ambiente.produtos.porSku("T-PAO");
    expect(pao?.tipo).toBe("PESAVEL");
    expect(pao?.precoVenda.centavos).toBe(1890n);
    expect(pao?.codigoBalanca).toBe("000001");
    expect(pao?.botaoRapido).toBe(true);
    expect(pao?.categoriaId).toBeDefined();

    const refrigerante = await ambiente.produtos.porCodigoBarras("7890000000017");
    expect(refrigerante?.descricao).toBe("Refrigerante cola 2 L");

    // O estoque inicial entra como movimento, com custo e responsável — o
    // mesmo caminho da loja de verdade, e não um saldo escrito à mão.
    expect(ambiente.estoque.movimentos).toHaveLength(PRODUTOS_DE_TREINO.length);
    const saldoDoPao = await ambiente.estoque.saldo(
      pao?.id ?? ambiente.geradorId.proximo(),
      "KG",
    );
    expect(saldoDoPao.milesimos).toBe(30_000n);
    const gerente = await ambiente.usuarios.porMatricula(Matricula.criar("903").unwrap());
    expect(
      ambiente.estoque.movimentos.every(
        (movimento) => movimento.usuarioId.valor === gerente?.id.valor,
      ),
    ).toBe(true);

    expect(ambiente.clientes.itens.size).toBe(CLIENTES_DE_TREINO.length);
    const doFiado = [...ambiente.clientes.itens.values()].find(
      (cliente) => cliente.apelido === "Dona Maria",
    );
    expect(doFiado?.limiteCredito.centavos).toBe(20_000n);
  });

  it("depois de montada, não monta de novo", async () => {
    const { ambiente, loja } = montar();
    await loja.preparar();

    expect((await loja.preparar()).unwrap()).toBe(false);
    expect(ambiente.usuarios.itens.size).toBe(PESSOAS_DE_TREINO.length);
    expect(ambiente.produtos.itens.size).toBe(PRODUTOS_DE_TREINO.length);
  });

  it("banco que já tem gente não recebe a loja de treino", async () => {
    const { ambiente, loja } = montar();
    await alguemJaCadastrado(ambiente);

    expect((await loja.preparar()).unwrap()).toBe(false);
    expect(ambiente.produtos.itens.size).toBe(0);
    expect(ambiente.usuarios.itens.size).toBe(1);
  });

  it("🔑 duas estações abrindo o treino juntas: a loja é montada uma vez só", async () => {
    const { ambiente, loja } = montar();

    const resultados = await Promise.all([loja.preparar(), loja.preparar()]);

    expect(resultados.map((resultado) => resultado.unwrap())).toEqual([true, false]);
    expect(ambiente.usuarios.itens.size).toBe(PESSOAS_DE_TREINO.length);
    expect(ambiente.produtos.itens.size).toBe(PRODUTOS_DE_TREINO.length);
  });

  it("outro servidor que montou no meio do caminho: esta montagem desiste", async () => {
    const ambiente = montarAmbiente();

    // O hash é calculado fora da transação; é a janela em que um segundo
    // processo, que não passa pela fila deste, consegue chegar antes.
    class HasherComConcorrente extends HasherFalso {
      #primeiro = true;

      override async hash(textoEmClaro: string): Promise<CredencialHash> {
        if (this.#primeiro) {
          this.#primeiro = false;
          await alguemJaCadastrado(ambiente);
        }

        return super.hash(textoEmClaro);
      }
    }

    const loja = new LojaDeTreinamento(
      ambiente.unitOfWork,
      new BancoEmMemoria(ambiente),
      ambiente.geradorId,
      new HasherComConcorrente(),
      ambiente.relogio,
    );

    expect((await loja.preparar()).unwrap()).toBe(false);
    expect(ambiente.produtos.itens.size).toBe(0);
  });

  it("🔑 banco que não é o de treino não recebe a loja, nem vazio", async () => {
    const { ambiente, banco, loja } = montar();
    banco.recusa = new ErroRegraNegocio(
      "BANCO_NAO_E_DE_TREINO",
      "Este banco não é o do treinamento.",
    );

    const resultado = await loja.preparar();

    expect(resultado.isErr() && resultado.error.codigo).toBe("BANCO_NAO_E_DE_TREINO");
    expect(ambiente.usuarios.itens.size).toBe(0);
    expect(ambiente.produtos.itens.size).toBe(0);
  });

  it("banco fora do ar: devolve o erro, sem montar nada", async () => {
    const { ambiente, loja } = montar();
    ambiente.unitOfWork.falharAoConfirmar = true;

    const resultado = await loja.preparar();

    expect(resultado.isErr() && resultado.error.codigo).toBe("TRANSACAO_FALHOU");
    expect(ambiente.usuarios.itens.size).toBe(0);
  });

  it("uma montagem que estoura não trava as seguintes", async () => {
    const ambiente = montarAmbiente();

    class HasherQueFalhaUmaVez extends HasherFalso {
      #falhou = false;

      override hash(textoEmClaro: string): Promise<CredencialHash> {
        if (!this.#falhou) {
          this.#falhou = true;
          return Promise.reject(new Error("hash indisponível"));
        }

        return super.hash(textoEmClaro);
      }
    }

    const loja = new LojaDeTreinamento(
      ambiente.unitOfWork,
      new BancoEmMemoria(ambiente),
      ambiente.geradorId,
      new HasherQueFalhaUmaVez(),
      ambiente.relogio,
    );

    await expect(loja.preparar()).rejects.toThrow("hash indisponível");
    expect((await loja.preparar()).unwrap()).toBe(true);
  });
});

describe("LojaDeTreinamento — recomeçar", () => {
  it("🔑 apaga o que o treino produziu e monta a loja de novo", async () => {
    const { ambiente, banco, loja } = montar();
    await loja.preparar();
    const pessoasAntes = [...ambiente.usuarios.itens.keys()];

    expect((await loja.recomecar()).isOk()).toBe(true);

    expect(banco.esvaziamentos).toBe(1);
    expect(ambiente.usuarios.itens.size).toBe(PESSOAS_DE_TREINO.length);
    expect(ambiente.produtos.itens.size).toBe(PRODUTOS_DE_TREINO.length);
    // Gente nova, com os mesmos PINs: a sessão de antes não vale mais.
    expect(pessoasAntes.some((id) => ambiente.usuarios.itens.has(id))).toBe(false);
  });

  it("🔑 banco que se recusa a esvaziar: nada é apagado nem montado", async () => {
    const { ambiente, banco, loja } = montar();
    await alguemJaCadastrado(ambiente);
    banco.recusa = new ErroRegraNegocio(
      "BANCO_NAO_E_DE_TREINO",
      "Este banco não é o do treinamento.",
    );

    const resultado = await loja.recomecar();

    expect(resultado.isErr() && resultado.error.codigo).toBe("BANCO_NAO_E_DE_TREINO");
    expect(ambiente.usuarios.itens.size).toBe(1);
    expect(ambiente.produtos.itens.size).toBe(0);
  });

  it("esvaziou, mas a montagem falhou: devolve o erro da montagem", async () => {
    const { ambiente, loja } = montar();
    await loja.preparar();
    ambiente.unitOfWork.falharAoConfirmar = true;

    const resultado = await loja.recomecar();

    expect(resultado.isErr() && resultado.error.codigo).toBe("TRANSACAO_FALHOU");
  });

  it("recomeçar durante uma montagem espera ela terminar", async () => {
    const { ambiente, banco, loja } = montar();

    const [preparada, recomecada] = await Promise.all([
      loja.preparar(),
      loja.recomecar(),
    ]);

    expect(preparada.unwrap()).toBe(true);
    expect(recomecada.isOk()).toBe(true);
    expect(banco.esvaziamentos).toBe(1);
    expect(ambiente.usuarios.itens.size).toBe(PESSOAS_DE_TREINO.length);
    expect(ambiente.produtos.itens.size).toBe(PRODUTOS_DE_TREINO.length);
  });
});

describe("loja de treino — os dados", () => {
  it("cada pessoa tem matrícula própria e um PIN que a política aceita", async () => {
    const matriculas = PESSOAS_DE_TREINO.map((pessoa) => pessoa.matricula);
    expect(new Set(matriculas).size).toBe(matriculas.length);

    // A montagem inteira passa por `Pin.criar`: se algum fosse recusado, ela
    // estouraria aqui.
    const { loja } = montar();
    expect((await loja.preparar()).isOk()).toBe(true);
  });

  it("os códigos de exemplo levam a produtos da loja de treino", () => {
    const exemplos = exemplosDeCodigo();
    expect(exemplos.length).toBeGreaterThan(0);

    for (const exemplo of exemplos) {
      const porBarras = PRODUTOS_DE_TREINO.find(
        (produto) => produto.codigoBarras === exemplo.codigo,
      );

      if (porBarras !== undefined) {
        expect(exemplo.descricao).toBe(porBarras.descricao);
        continue;
      }

      const leitura = interpretarCodigoBalanca(
        exemplo.codigo,
        LAYOUT_BALANCA_PADRAO,
      ).unwrap();
      const pesado = PRODUTOS_DE_TREINO.find(
        (produto) => produto.codigoBalanca === leitura.codigoProduto,
      );

      expect(pesado?.tipo).toBe("PESAVEL");
      expect(exemplo.descricao.startsWith(pesado?.descricao ?? "?")).toBe(true);
      expect(leitura.peso?.milesimos).toBeGreaterThan(0n);
    }
  });

  it("a etiqueta do pão traz os 350 g do exemplo de conferência", () => {
    const etiqueta = exemplosDeCodigo().find((exemplo) =>
      exemplo.descricao.includes("350 g"),
    );

    const leitura = interpretarCodigoBalanca(
      etiqueta?.codigo ?? "",
      LAYOUT_BALANCA_PADRAO,
    ).unwrap();

    expect(leitura.codigoProduto).toBe("000001");
    expect(leitura.peso?.milesimos).toBe(350n);
  });
});
