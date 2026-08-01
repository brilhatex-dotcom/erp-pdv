import {
  CredencialHash,
  Dinheiro,
  Identificador,
  Matricula,
  Papel,
  papelPadrao,
  SessaoCaixa,
  Usuario,
} from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import { AutorizarOperacao } from "../acesso/AutorizarOperacao.js";
import { RegistrarSangria, RegistrarSuprimento } from "./MovimentarCaixa.js";

/**
 * Dinheiro saindo da gaveta é a operação de maior risco do balcão. O que se
 * verifica aqui não é a aritmética — o domínio já a cobre — é **quem pode**.
 */

const ESTACAO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e530001").unwrap();
const OUTRA_ESTACAO = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e530002",
).unwrap();
const OPERADOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e530003").unwrap();
const SUPERVISOR = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e530004").unwrap();
const GERENTE = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e530007").unwrap();
const CAIXA = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e530005").unwrap();
const PAPEL = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e530006").unwrap();
const AGORA = new Date("2026-08-01T10:00:00.000Z");

const PIN_SUPERVISOR = "860412";
const PIN_GERENTE = "573914";

function reais(valor: string): Dinheiro {
  return Dinheiro.deReais(valor).unwrap();
}

function hashDe(texto: string): CredencialHash {
  return CredencialHash.criar(`falso:${texto}`, "falso").unwrap();
}

function montar(fundo = "1000,00") {
  const ambiente = montarAmbiente(AGORA);

  for (const pessoa of [
    {
      id: OPERADOR,
      matricula: "42",
      nome: "Maria",
      papel: "OPERADOR_CAIXA",
      pin: "419273",
    },
    {
      id: SUPERVISOR,
      matricula: "7",
      nome: "João",
      papel: "SUPERVISOR",
      pin: PIN_SUPERVISOR,
    },
    { id: GERENTE, matricula: "1", nome: "Ana", papel: "GERENTE", pin: PIN_GERENTE },
  ] as const) {
    ambiente.usuarios.adicionar(
      Usuario.criar({
        id: pessoa.id,
        matricula: Matricula.criar(pessoa.matricula).unwrap(),
        nome: pessoa.nome,
        papel: Papel.criar(papelPadrao(pessoa.papel, PAPEL)).unwrap(),
        hashPin: hashDe(pessoa.pin),
      }).unwrap(),
    );
  }

  ambiente.caixas.adicionar(
    SessaoCaixa.abrir({
      id: CAIXA,
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      fundoTroco: reais(fundo),
      abertaEm: AGORA,
    }).unwrap(),
  );

  const autorizar = new AutorizarOperacao(ambiente.relogio, ambiente.hasher);

  return {
    ...ambiente,
    sangrar: new RegistrarSangria(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
      autorizar,
    ),
    suprir: new RegistrarSuprimento(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
    ),
  };
}

let sistema: ReturnType<typeof montar>;

beforeEach(() => {
  sistema = montar();
});

describe("Sangria", () => {
  it("🔑 o operador de caixa não sangra sozinho", async () => {
    // O papel não tem `caixa:sangria`. A recusa acontece no servidor, não na
    // interface — esconder o botão é experiência, não segurança.
    const resultado = await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      valor: reais("100,00"),
      motivo: "Depósito bancário",
    });

    expect(resultado.isErr()).toBe(true);
    const sessao = await sistema.unitOfWork.repositorios.caixas.abertaNaEstacao(ESTACAO);
    expect(sessao?.sangrias.centavos).toBe(0n);
  });

  it("🔑 nem a credencial de um supervisor faz o operador sangrar", () => {
    // O domínio é explícito: sem a permissão base, limite nem se discute. O
    // operador **chama** o supervisor, que executa com a própria conta — o que
    // mantém a auditoria dizendo quem de fato tirou o dinheiro.
    return sistema.sangrar
      .executar({
        estacaoId: ESTACAO,
        operadorId: OPERADOR,
        valor: reais("100,00"),
        motivo: "Depósito bancário",
        credencialSupervisor: { matricula: "7", pin: PIN_SUPERVISOR },
      })
      .then((resultado) => {
        expect(resultado.isErr()).toBe(true);
      });
  });

  it("o supervisor sangra sem pedir liberação a ninguém", async () => {
    const resultado = await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("100,00"),
      motivo: "Depósito bancário",
    });

    expect(resultado.isOk()).toBe(true);
  });

  it("🔑 não é possível tirar mais do que há na gaveta", async () => {
    // Aceitar tornaria o fechamento acusar uma falta inventada pelo próprio
    // registro — o sistema criando a divergência que ele existe para detectar.
    const resultado = await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("1500,00"),
      motivo: "Depósito bancário",
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("estação sem caixa aberto recusa com mensagem de operador", async () => {
    const resultado = await sistema.sangrar.executar({
      estacaoId: OUTRA_ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("10,00"),
      motivo: "Depósito bancário",
    });

    expect(resultado.isErr()).toBe(true);
    if (!resultado.isErr()) return;
    expect(resultado.error.mensagem).toContain("caixa aberto");
  });

  it("🔑 acima do teto do supervisor, o gerente precisa liberar", async () => {
    // O teto do supervisor é R$ 500. Acima disso a decisão não é "não pode" —
    // é "não pode sozinho", e a interface precisa distinguir as duas para
    // saber que existe caminho adiante.
    const semLiberacao = await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("600,00"),
      motivo: "Depósito bancário",
    });

    expect(semLiberacao.isErr()).toBe(true);
    if (!semLiberacao.isErr()) return;
    expect(semLiberacao.error.codigo).toBe("AUTORIZACAO_NECESSARIA");

    const comGerente = await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("600,00"),
      motivo: "Depósito bancário",
      credencialSupervisor: { matricula: "1", pin: PIN_GERENTE },
    });

    expect(comGerente.isOk()).toBe(true);
  });

  it("🔑 a sangria liberada fica no nome de quem a executou", async () => {
    // Se ela passasse a ser do gerente, o rastro do que realmente aconteceu se
    // perderia — quem tirou o dinheiro foi o supervisor.
    const resultado = await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("600,00"),
      motivo: "Depósito bancário",
      credencialSupervisor: { matricula: "1", pin: PIN_GERENTE },
    });

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().usuarioId.equals(SUPERVISOR)).toBe(true);
  });

  it("credencial de liberação errada não passa", async () => {
    const resultado = await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("600,00"),
      motivo: "Depósito bancário",
      credencialSupervisor: { matricula: "1", pin: "000000" },
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("a liberação vira evento de auditoria", async () => {
    await sistema.sangrar.executar({
      estacaoId: ESTACAO,
      operadorId: SUPERVISOR,
      valor: reais("600,00"),
      motivo: "Depósito bancário",
      credencialSupervisor: { matricula: "1", pin: PIN_GERENTE },
    });

    const tipos = sistema.outbox.eventos.map((evento) => evento.tipo);
    expect(tipos).toContain("OperacaoAutorizadaPorSupervisor");
  });
});

describe("Suprimento", () => {
  it("🔑 o operador põe dinheiro sem pedir liberação", async () => {
    // Suprimento não tira nada da gaveta: exigir supervisor para acrescentar
    // troco pararia o caixa por uma operação que ninguém usa para fraudar.
    const resultado = await sistema.suprir.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      valor: reais("50,00"),
      motivo: "Troco do cofre",
    });

    expect(resultado.isOk()).toBe(true);
    expect(resultado.unwrap().tipo).toBe("SUPRIMENTO");
  });

  it("suprimento aumenta o esperado na gaveta", async () => {
    await sistema.suprir.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      valor: reais("50,00"),
      motivo: "Troco do cofre",
    });

    const sessao = await sistema.unitOfWork.repositorios.caixas.abertaNaEstacao(ESTACAO);

    expect(sessao?.esperadoEmDinheiro.formatar()).toBe("R$ 1.050,00");
  });

  it("estação sem caixa aberto recusa", async () => {
    const resultado = await sistema.suprir.executar({
      estacaoId: OUTRA_ESTACAO,
      operadorId: OPERADOR,
      valor: reais("50,00"),
      motivo: "Troco do cofre",
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("valor inválido é recusado pelo domínio", async () => {
    const resultado = await sistema.suprir.executar({
      estacaoId: ESTACAO,
      operadorId: OPERADOR,
      valor: reais("0,00"),
      motivo: "Troco do cofre",
    });

    expect(resultado.isErr()).toBe(true);
  });
});
