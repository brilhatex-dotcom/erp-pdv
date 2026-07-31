import {
  CredencialHash,
  Identificador,
  Matricula,
  Papel,
  papelPadrao,
  type TentativaRecusada,
  TENTATIVAS_ATE_BLOQUEIO,
  Usuario,
} from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import { Autenticar } from "./Autenticar.js";
import { RenovarSessao } from "./RenovarSessao.js";

const OPERADOR_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fe001").unwrap();
const SUPERVISOR_ID = Identificador.criar(
  "018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fe002",
).unwrap();
const PAPEL_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fe003").unwrap();
const DISPOSITIVO = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fe004").unwrap();
const AGORA = new Date("2026-07-31T09:00:00.000Z");

/** O `HasherFalso` guarda `falso:<texto>` — previsível e instantâneo. */
function hashDe(texto: string): CredencialHash {
  return CredencialHash.criar(`falso:${texto}`, "falso").unwrap();
}

let segredos = 0;
function geradorSegredo(): string {
  segredos += 1;
  return `refresh-${String(segredos)}`;
}

function montar() {
  const ambiente = montarAmbiente(AGORA);

  ambiente.usuarios.adicionar(
    Usuario.criar({
      id: OPERADOR_ID,
      matricula: Matricula.criar("42").unwrap(),
      nome: "Maria da Silva",
      papel: Papel.criar(papelPadrao("OPERADOR_CAIXA", PAPEL_ID)).unwrap(),
      hashPin: hashDe("419273"),
    }).unwrap(),
  );

  ambiente.usuarios.adicionar(
    Usuario.criar({
      id: SUPERVISOR_ID,
      matricula: Matricula.criar("7").unwrap(),
      nome: "João Souza",
      papel: Papel.criar(papelPadrao("SUPERVISOR", PAPEL_ID)).unwrap(),
      hashPin: hashDe("860412"),
      hashSenha: hashDe("cavalo bateria grampo"),
    }).unwrap(),
  );

  return {
    ...ambiente,
    autenticar: new Autenticar(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
      ambiente.hasher,
      geradorSegredo,
    ),
    renovar: new RenovarSessao(
      ambiente.unitOfWork,
      ambiente.relogio,
      ambiente.geradorId,
      ambiente.hasher,
      geradorSegredo,
    ),
  };
}

let sistema: ReturnType<typeof montar>;

beforeEach(() => {
  sistema = montar();
});

describe("Login no PDV", () => {
  it("🔑 abre a sessão com matrícula e PIN corretos", async () => {
    const saida = (
      await sistema.autenticar.executar({
        matricula: "42",
        segredo: "419273",
        contexto: "PDV",
        dispositivoId: DISPOSITIVO,
      })
    ).unwrap();

    expect(saida.usuario.id.equals(OPERADOR_ID)).toBe(true);
    expect(saida.sessao.contexto).toBe("PDV");
    expect(saida.sessao.estaValida(AGORA)).toBe(true);
    // A primeira sessão da cadeia é a própria família.
    expect(saida.sessao.familiaId.equals(saida.sessao.id)).toBe(true);
    expect(saida.refreshEmClaro).toMatch(/^refresh-/);
  });

  it("aceita matrícula com zeros à esquerda", async () => {
    const saida = await sistema.autenticar.executar({
      matricula: "0042",
      segredo: "419273",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    expect(saida.isOk()).toBe(true);
  });

  it("🔑 dá a mesma resposta para matrícula inexistente e PIN errado", async () => {
    // Distingui-las seria conveniente para o operador e ainda mais conveniente
    // para quem está testando matrículas.
    const inexistente = await sistema.autenticar.executar({
      matricula: "999",
      segredo: "419273",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    const pinErrado = await sistema.autenticar.executar({
      matricula: "42",
      segredo: "000111",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    expect(inexistente.isErr()).toBe(true);
    expect(pinErrado.isErr()).toBe(true);
    if (inexistente.isErr() && pinErrado.isErr()) {
      expect(inexistente.error.codigo).toBe(pinErrado.error.codigo);
      expect(inexistente.error.mensagem).toBe(pinErrado.error.mensagem);
    }
  });

  it("🔑 gasta o mesmo tempo quando a matrícula não existe", async () => {
    // Sem isso, o tempo de resposta vira um oráculo que diz quais matrículas
    // estão cadastradas — e a lista resultante é o que se ataca depois.
    await sistema.autenticar.executar({
      matricula: "999",
      segredo: "419273",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    expect(sistema.hasher.tempoGastoEmVao).toBe(1);
  });

  it("gasta o tempo também quando a matrícula é inválida", async () => {
    await sistema.autenticar.executar({
      matricula: "não-numérica",
      segredo: "419273",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    expect(sistema.hasher.tempoGastoEmVao).toBe(1);
  });

  it("🔑 recusa senha de retaguarda em quem só tem PIN", async () => {
    const resultado = await sistema.autenticar.executar({
      matricula: "42",
      segredo: "419273",
      contexto: "RETAGUARDA",
      dispositivoId: DISPOSITIVO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("CREDENCIAL_INVALIDA");
    expect(sistema.hasher.tempoGastoEmVao).toBe(1);
  });

  it("o supervisor entra nos dois contextos, com credenciais diferentes", async () => {
    const noPdv = await sistema.autenticar.executar({
      matricula: "7",
      segredo: "860412",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    const naRetaguarda = await sistema.autenticar.executar({
      matricula: "7",
      segredo: "cavalo bateria grampo",
      contexto: "RETAGUARDA",
      dispositivoId: DISPOSITIVO,
    });

    expect(noPdv.isOk()).toBe(true);
    expect(naRetaguarda.isOk()).toBe(true);
  });

  it("registra tentativa falha na auditoria", async () => {
    await sistema.autenticar.executar({
      matricula: "42",
      segredo: "000111",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    const evento = sistema.outbox.eventos[0] as TentativaRecusada;
    expect(evento.tipo).toBe("TentativaDeAcessoRecusada");
    expect(evento.matricula).toBe("42");
  });

  it("🔑 bloqueia depois de cinco erros e diz quanto falta", async () => {
    for (let i = 0; i < TENTATIVAS_ATE_BLOQUEIO; i += 1) {
      await sistema.autenticar.executar({
        matricula: "42",
        segredo: "000111",
        contexto: "PDV",
        dispositivoId: DISPOSITIVO,
      });
    }

    const bloqueado = await sistema.autenticar.executar({
      matricula: "42",
      segredo: "419273",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    expect(bloqueado.isErr()).toBe(true);
    if (bloqueado.isErr()) {
      // Mensagem específica de propósito: quem está bloqueado já provou
      // conhecer a matrícula, e "credencial inválida" geraria chamado.
      expect(bloqueado.error.codigo).toBe("USUARIO_BLOQUEADO");
      expect(bloqueado.error.mensagem).toContain("Chame o supervisor");
    }
  });

  it("🔑 não gasta Argon2id em quem está bloqueado", async () => {
    for (let i = 0; i < TENTATIVAS_ATE_BLOQUEIO; i += 1) {
      await sistema.autenticar.executar({
        matricula: "42",
        segredo: "000111",
        contexto: "PDV",
        dispositivoId: DISPOSITIVO,
      });
    }

    const antes = sistema.hasher.tempoGastoEmVao;

    await sistema.autenticar.executar({
      matricula: "42",
      segredo: "419273",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    // Nenhum trabalho de hash: a verificação de bloqueio veio antes.
    expect(sistema.hasher.tempoGastoEmVao).toBe(antes);
  });

  it("recusa usuário desativado", async () => {
    const usuario = (await sistema.usuarios.porId(OPERADOR_ID))!;
    usuario.desativar();

    const resultado = await sistema.autenticar.executar({
      matricula: "42",
      segredo: "419273",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("USUARIO_INATIVO");
  });
});

describe("Renovação de sessão", () => {
  async function logar() {
    return (
      await sistema.autenticar.executar({
        matricula: "42",
        segredo: "419273",
        contexto: "PDV",
        dispositivoId: DISPOSITIVO,
      })
    ).unwrap();
  }

  it("🔑 troca o refresh por um par novo, mantendo a família", async () => {
    const inicial = await logar();

    const renovada = (
      await sistema.renovar.executar({
        sessaoId: inicial.sessao.id,
        refreshEmClaro: inicial.refreshEmClaro,
      })
    ).unwrap();

    expect(renovada.sessao.id.equals(inicial.sessao.id)).toBe(false);
    expect(renovada.sessao.familiaId.equals(inicial.sessao.familiaId)).toBe(true);
    expect(renovada.refreshEmClaro).not.toBe(inicial.refreshEmClaro);

    // A anterior ficou gasta e aponta para a sucessora.
    expect(inicial.sessao.jaFoiUsada).toBe(true);
    expect(inicial.sessao.sucessoraId?.equals(renovada.sessao.id)).toBe(true);
  });

  it("🔑 reúso de refresh derruba a família inteira", async () => {
    // Um refresh já gasto que reaparece só tem duas explicações — roubo ou
    // clone — e nas duas a resposta é derrubar ladrão e dono junto.
    const inicial = await logar();

    const renovada = (
      await sistema.renovar.executar({
        sessaoId: inicial.sessao.id,
        refreshEmClaro: inicial.refreshEmClaro,
      })
    ).unwrap();

    const reuso = await sistema.renovar.executar({
      sessaoId: inicial.sessao.id,
      refreshEmClaro: inicial.refreshEmClaro,
    });

    expect(reuso.isErr()).toBe(true);
    if (reuso.isErr()) expect(reuso.error.codigo).toBe("SESSAO_REUSO_DETECTADO");

    // A sessão nova, que o ladrão poderia estar usando, também caiu.
    expect(renovada.sessao.estaRevogada).toBe(true);

    const alerta = sistema.outbox.eventos.find(
      (evento) => evento.tipo === "FamiliaDeSessaoRevogada",
    );
    expect(alerta).toBeDefined();
  });

  it("🔑 refresh errado não derruba sessão alheia", async () => {
    // Sem conferir o refresh antes de reagir, quem conhecesse só o id da
    // sessão — que trafega no cookie — derrubaria a sessão de outro de propósito.
    const inicial = await logar();

    const resultado = await sistema.renovar.executar({
      sessaoId: inicial.sessao.id,
      refreshEmClaro: "chute",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SESSAO_INVALIDA");
    expect(inicial.sessao.estaRevogada).toBe(false);
    expect(inicial.sessao.jaFoiUsada).toBe(false);
  });

  it("recusa sessão inexistente sem revelar nada", async () => {
    const resultado = await sistema.renovar.executar({
      sessaoId: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4fe099").unwrap(),
      refreshEmClaro: "qualquer",
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SESSAO_INVALIDA");
  });

  it("recusa sessão expirada", async () => {
    const inicial = await logar();
    // 12 h + 1 min.
    sistema.relogio.avancar(12 * 60 * 60 * 1000 + 60_000);

    const resultado = await sistema.renovar.executar({
      sessaoId: inicial.sessao.id,
      refreshEmClaro: inicial.refreshEmClaro,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SESSAO_EXPIRADA");
  });

  it("🔑 desativar o usuário derruba as sessões dele na hora", async () => {
    const inicial = await logar();
    const usuario = (await sistema.usuarios.porId(OPERADOR_ID))!;
    usuario.desativar();

    const resultado = await sistema.renovar.executar({
      sessaoId: inicial.sessao.id,
      refreshEmClaro: inicial.refreshEmClaro,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("USUARIO_INATIVO");
    expect(inicial.sessao.estaRevogada).toBe(true);
  });

  it("recusa renovar sessão revogada", async () => {
    const inicial = await logar();
    inicial.sessao.revogar(AGORA);

    const resultado = await sistema.renovar.executar({
      sessaoId: inicial.sessao.id,
      refreshEmClaro: inicial.refreshEmClaro,
    });

    expect(resultado.isErr()).toBe(true);
    if (resultado.isErr()) expect(resultado.error.codigo).toBe("SESSAO_REVOGADA");
  });
});

describe("O que precisa sobreviver ao rollback", () => {
  // Regressão de um defeito real: devolver `err` de dentro da transação
  // provoca ROLLBACK, e as duas gravações abaixo eram desfeitas junto com o
  // erro que as motivou. O bloqueio nunca chegava à quinta tentativa e a
  // revogação por reúso era anulada no mesmo instante em que era decidida.
  // Só apareceu contra o Postgres — o dublê em memória não desfaz nada.

  it("🔑 a tentativa falha é gravada, e a transação NÃO é desfeita", async () => {
    await sistema.autenticar.executar({
      matricula: "42",
      segredo: "000111",
      contexto: "PDV",
      dispositivoId: DISPOSITIVO,
    });

    expect(sistema.unitOfWork.desfeitas).toBe(0);

    const usuario = (await sistema.usuarios.porId(OPERADOR_ID))!;
    expect(usuario.tentativasFalhas).toBe(1);
  });

  it("🔑 o contador de falhas acumula até bloquear de verdade", async () => {
    for (let i = 0; i < TENTATIVAS_ATE_BLOQUEIO; i += 1) {
      await sistema.autenticar.executar({
        matricula: "42",
        segredo: "000111",
        contexto: "PDV",
        dispositivoId: DISPOSITIVO,
      });
    }

    const usuario = (await sistema.usuarios.porId(OPERADOR_ID))!;
    expect(usuario.estaBloqueado(AGORA)).toBe(true);
  });

  it("🔑 a revogação por reúso não é desfeita pelo erro que a acompanha", async () => {
    const inicial = (
      await sistema.autenticar.executar({
        matricula: "42",
        segredo: "419273",
        contexto: "PDV",
        dispositivoId: DISPOSITIVO,
      })
    ).unwrap();

    const renovada = (
      await sistema.renovar.executar({
        sessaoId: inicial.sessao.id,
        refreshEmClaro: inicial.refreshEmClaro,
      })
    ).unwrap();

    sistema.unitOfWork.desfeitas = 0;

    await sistema.renovar.executar({
      sessaoId: inicial.sessao.id,
      refreshEmClaro: inicial.refreshEmClaro,
    });

    expect(sistema.unitOfWork.desfeitas).toBe(0);
    expect(renovada.sessao.estaRevogada).toBe(true);
  });
});
